import { pool } from "~~/server/utils/db";

type QueryExecutor = {
  query: (sql: string, values?: any) => Promise<any>;
};

export interface SemesterRuleExceptionWindow {
  id?: number;
  rule_id?: number;
  slot_order: number;
  transfer_min: number;
  transfer_max: number;
  allowed_overload_credits: number;
  allowed_underload_credits: number;
  default_reason: string | null;
}

export interface SemesterRuleExceptionAllowance {
  slot_order: number;
  allowed_overload_credits: number;
  allowed_underload_credits: number;
  default_reason: string | null;
}

export interface SemesterRuleExceptionWindowValidationIssue {
  code:
    | "missing_window"
    | "invalid_range"
    | "invalid_slot_order"
    | "missing_allowance"
    | "overlap"
    | "slot_role_conflict";
  message: string;
  slot_order?: number;
}

let ensureExceptionWindowsTablePromise: Promise<void> | null = null;

export const normalizeSemesterRuleExceptionWindow = (
  window: SemesterRuleExceptionWindow,
): SemesterRuleExceptionWindow => ({
  id: window.id,
  rule_id: window.rule_id,
  slot_order: Math.max(Number(window.slot_order) || 0, 1),
  transfer_min: Math.max(Number(window.transfer_min) || 0, 0),
  transfer_max: Math.max(
    Number(window.transfer_max) || Number(window.transfer_min) || 0,
    Math.max(Number(window.transfer_min) || 0, 0),
  ),
  allowed_overload_credits: Math.max(
    Number(window.allowed_overload_credits) || 0,
    0,
  ),
  allowed_underload_credits: Math.max(
    Number(window.allowed_underload_credits) || 0,
    0,
  ),
  default_reason: window.default_reason
    ? String(window.default_reason).trim() || null
    : null,
});

export const normalizeSemesterRuleExceptionWindows = (
  windows: SemesterRuleExceptionWindow[],
) =>
  [...windows]
    .map((window) => normalizeSemesterRuleExceptionWindow(window))
    .sort((left, right) => {
      if (left.slot_order !== right.slot_order) {
        return left.slot_order - right.slot_order;
      }

      if (left.transfer_min !== right.transfer_min) {
        return left.transfer_min - right.transfer_min;
      }

      return left.transfer_max - right.transfer_max;
    });

export const ensureSemesterRuleExceptionWindowsTable = async () => {
  if (!ensureExceptionWindowsTablePromise) {
    ensureExceptionWindowsTablePromise = pool
      .query(`
        CREATE TABLE IF NOT EXISTS semester_rule_exception_windows (
          id INT AUTO_INCREMENT PRIMARY KEY,
          rule_id INT NOT NULL,
          slot_order INT NOT NULL,
          transfer_min INT NOT NULL,
          transfer_max INT NOT NULL,
          allowed_overload_credits INT NOT NULL DEFAULT 0,
          allowed_underload_credits INT NOT NULL DEFAULT 0,
          default_reason TEXT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

          CONSTRAINT fk_srew_rule
            FOREIGN KEY (rule_id) REFERENCES semester_entry_rules(id) ON DELETE CASCADE,

          UNIQUE KEY unique_rule_slot_transfer_window (rule_id, slot_order, transfer_min, transfer_max)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
      .then(() => undefined)
      .catch((error) => {
        ensureExceptionWindowsTablePromise = null;
        throw error;
      });
  }

  await ensureExceptionWindowsTablePromise;
};

export const validateSemesterRuleExceptionWindows = ({
  windows,
  bandTransferMin,
  bandTransferMax,
  slotCount,
  slotRolesByOrder,
}: {
  windows: SemesterRuleExceptionWindow[];
  bandTransferMin: number;
  bandTransferMax: number;
  slotCount: number;
  slotRolesByOrder?: Map<number, string>;
}) => {
  const normalizedWindows = normalizeSemesterRuleExceptionWindows(windows);
  const issues: SemesterRuleExceptionWindowValidationIssue[] = [];

  for (const window of normalizedWindows) {
    if (window.transfer_max < window.transfer_min) {
      issues.push({
        code: "invalid_range",
        slot_order: window.slot_order,
        message: "Exception window transfer max must be greater than or equal to transfer min.",
      });
    }

    if (
      window.transfer_min < bandTransferMin ||
      window.transfer_max > bandTransferMax
    ) {
      issues.push({
        code: "invalid_range",
        slot_order: window.slot_order,
        message: `Exception windows must stay within the band coverage (${bandTransferMin}-${bandTransferMax}).`,
      });
    }

    if (window.slot_order < 1 || window.slot_order > slotCount) {
      issues.push({
        code: "invalid_slot_order",
        slot_order: window.slot_order,
        message: `Slot order ${window.slot_order} does not exist in the configured journey.`,
      });
    }

    if (slotRolesByOrder?.get(window.slot_order) === "li") {
      issues.push({
        code: "slot_role_conflict",
        slot_order: window.slot_order,
        message:
          "LI is a fixed long semester for Industrial Training and cannot use exception windows.",
      });
    }

    if (
      window.allowed_overload_credits <= 0 &&
      window.allowed_underload_credits <= 0
    ) {
      issues.push({
        code: "missing_allowance",
        slot_order: window.slot_order,
        message: "Each exception window must allow overload, underload, or both.",
      });
    }
  }

  const windowsBySlot = new Map<number, SemesterRuleExceptionWindow[]>();
  for (const window of normalizedWindows) {
    if (!windowsBySlot.has(window.slot_order)) {
      windowsBySlot.set(window.slot_order, []);
    }
    windowsBySlot.get(window.slot_order)!.push(window);
  }

  for (const [slotOrder, slotWindows] of windowsBySlot.entries()) {
    const ordered = [...slotWindows].sort(
      (left, right) => left.transfer_min - right.transfer_min,
    );
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      if (current.transfer_min <= previous.transfer_max) {
        issues.push({
          code: "overlap",
          slot_order: slotOrder,
          message: `Exception windows for slot ${slotOrder} cannot overlap.`,
        });
        break;
      }
    }
  }

  return {
    issues,
  };
};

export const getSemesterRuleExceptionWindows = async ({
  ruleId,
  executor = pool,
}: {
  ruleId: number;
  executor?: QueryExecutor;
}) => {
  if (!Number.isInteger(ruleId) || ruleId <= 0) {
    return [];
  }

  await ensureSemesterRuleExceptionWindowsTable();

  const [rows] = await executor.query(
    `SELECT id,
            rule_id,
            slot_order,
            transfer_min,
            transfer_max,
            allowed_overload_credits,
            allowed_underload_credits,
            default_reason
     FROM semester_rule_exception_windows
     WHERE rule_id = ?
     ORDER BY slot_order ASC, transfer_min ASC, transfer_max ASC`,
    [ruleId],
  );

  return normalizeSemesterRuleExceptionWindows(
    (rows as any[]).map((row) => ({
      id: Number(row.id),
      rule_id: Number(row.rule_id),
      slot_order: Number(row.slot_order),
      transfer_min: Number(row.transfer_min),
      transfer_max: Number(row.transfer_max),
      allowed_overload_credits: Number(row.allowed_overload_credits) || 0,
      allowed_underload_credits: Number(row.allowed_underload_credits) || 0,
      default_reason: row.default_reason ?? null,
    })),
  );
};

export const replaceSemesterRuleExceptionWindows = async ({
  ruleId,
  windows,
  executor = pool,
}: {
  ruleId: number;
  windows: SemesterRuleExceptionWindow[];
  executor?: QueryExecutor;
}) => {
  if (!Number.isInteger(ruleId) || ruleId <= 0) {
    return;
  }

  await ensureSemesterRuleExceptionWindowsTable();

  const normalizedWindows = normalizeSemesterRuleExceptionWindows(windows);

  await executor.query(
    `DELETE FROM semester_rule_exception_windows WHERE rule_id = ?`,
    [ruleId],
  );

  if (normalizedWindows.length === 0) {
    return;
  }

  const values = normalizedWindows.map((window) => [
    ruleId,
    window.slot_order,
    window.transfer_min,
    window.transfer_max,
    window.allowed_overload_credits,
    window.allowed_underload_credits,
    window.default_reason,
  ]);

  await executor.query(
    `INSERT INTO semester_rule_exception_windows (
      rule_id,
      slot_order,
      transfer_min,
      transfer_max,
      allowed_overload_credits,
      allowed_underload_credits,
      default_reason
    ) VALUES ?`,
    [values],
  );
};

export const getApplicableSemesterRuleExceptionAllowances = ({
  windows,
  transferredCredits,
}: {
  windows: SemesterRuleExceptionWindow[];
  transferredCredits: number;
}) => {
  const allowanceMap = new Map<number, SemesterRuleExceptionAllowance>();
  const normalizedTransferredCredits = Math.max(
    Number(transferredCredits) || 0,
    0,
  );

  for (const window of normalizeSemesterRuleExceptionWindows(windows)) {
    if (
      normalizedTransferredCredits < window.transfer_min ||
      normalizedTransferredCredits > window.transfer_max
    ) {
      continue;
    }

    const existing = allowanceMap.get(window.slot_order);
    if (!existing) {
      allowanceMap.set(window.slot_order, {
        slot_order: window.slot_order,
        allowed_overload_credits: window.allowed_overload_credits,
        allowed_underload_credits: window.allowed_underload_credits,
        default_reason: window.default_reason,
      });
      continue;
    }

    allowanceMap.set(window.slot_order, {
      slot_order: window.slot_order,
      allowed_overload_credits: Math.max(
        existing.allowed_overload_credits,
        window.allowed_overload_credits,
      ),
      allowed_underload_credits: Math.max(
        existing.allowed_underload_credits,
        window.allowed_underload_credits,
      ),
      default_reason: existing.default_reason || window.default_reason,
    });
  }

  return allowanceMap;
};
