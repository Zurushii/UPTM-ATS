import { pool } from "~~/server/utils/db";
import { addColumnIfMissing } from "~~/server/utils/mysql-schema";

type QueryExecutor = {
  query: (sql: string, values?: any) => Promise<any>;
};

export interface SemesterEntryBand {
  id: number;
  program_id: number;
  intake_type: string;
  transfer_min: number;
  transfer_max: number;
  entry_semester: number;
  reference_note: string | null;
  credit_transfer?: number;
  is_system_default?: boolean;
}

export interface SemesterEntryBandValidationIssue {
  type: "gap" | "overlap" | "bounds" | "missing";
  message: string;
  from?: number;
  to?: number;
  rule_id?: number;
}

let ensureBandColumnsPromise: Promise<void> | null = null;
let ensureStudentEntryColumnsPromise: Promise<void> | null = null;

const normalizeReferenceNote = (value: unknown) => {
  if (value == null) {
    return null;
  }

  const note = String(value).trim();
  return note.length > 0 ? note : null;
};

const getSystemDefaultSemesterOneBandId = ({
  programId,
  intakeType,
}: {
  programId: number;
  intakeType: string;
}) => {
  let hash = Math.max(Number(programId) || 0, 0) + 1;

  for (const character of String(intakeType || "")) {
    hash = (hash * 31 + character.charCodeAt(0)) % 2147483647;
  }

  return -(hash + 1);
};

const withSystemDefaultSemesterOneBand = <T extends {
  id?: number;
  program_id?: number;
  intake_type?: string;
  transfer_min: number;
  transfer_max: number;
  entry_semester: number;
  reference_note?: string | null;
  credit_transfer?: number;
  is_system_default?: boolean;
}>(
  bands: T[],
): T[] => {
  const normalizedBands = [...bands].sort((left, right) => {
    if (left.transfer_min !== right.transfer_min) {
      return left.transfer_min - right.transfer_min;
    }

    if (left.transfer_max !== right.transfer_max) {
      return left.transfer_max - right.transfer_max;
    }

    return (left.id || 0) - (right.id || 0);
  });

  const hasSemesterOneBand = normalizedBands.some(
    (band) => Number(band.entry_semester) === 1,
  );

  // Keep this helper idempotent. Some callers already pass bands that include
  // the system-generated Semester 1 range, so we should not synthesize it twice.
  if (hasSemesterOneBand) {
    return normalizedBands;
  }

  const firstSemesterTwoBand = normalizedBands
    .filter((band) => Number(band.entry_semester) === 2)
    .sort((left, right) => left.transfer_min - right.transfer_min)[0];

  if (!firstSemesterTwoBand || firstSemesterTwoBand.transfer_min <= 0) {
    return normalizedBands;
  }

  const syntheticBand = {
    ...firstSemesterTwoBand,
    id: getSystemDefaultSemesterOneBandId({
      programId: Number(firstSemesterTwoBand.program_id) || 0,
      intakeType: String(firstSemesterTwoBand.intake_type || ""),
    }),
    transfer_min: 0,
    transfer_max: firstSemesterTwoBand.transfer_min - 1,
    entry_semester: 1,
    credit_transfer: 0,
    reference_note: null,
    is_system_default: true,
  } satisfies T;

  return [syntheticBand, ...normalizedBands].sort((left, right) => {
    if (left.transfer_min !== right.transfer_min) {
      return left.transfer_min - right.transfer_min;
    }

    if (left.transfer_max !== right.transfer_max) {
      return left.transfer_max - right.transfer_max;
    }

    return (left.id || 0) - (right.id || 0);
  });
};

const backfillSemesterEntryRuleBands = async () => {
  const [rows] = await pool.query(
    `SELECT ser.id,
            ser.program_id,
            ser.intake_type,
            ser.credit_transfer,
            ser.transfer_min,
            ser.transfer_max,
            p.total_credit_required
     FROM semester_entry_rules ser
     JOIN programs p ON p.id = ser.program_id
     ORDER BY ser.program_id ASC,
              ser.intake_type ASC,
              ser.credit_transfer ASC,
              ser.id ASC`,
  );

  const grouped = new Map<string, any[]>();

  for (const row of rows as any[]) {
    const key = `${row.program_id}::${row.intake_type}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(row);
  }

  for (const ruleRows of grouped.values()) {
    if (
      !ruleRows.some(
        (row) => row.transfer_min == null || row.transfer_max == null,
      )
    ) {
      continue;
    }

    for (let index = 0; index < ruleRows.length; index++) {
      const row = ruleRows[index];
      const nextRow = ruleRows[index + 1] || null;
      const transferMin =
        row.transfer_min != null
          ? Number(row.transfer_min)
          : Math.max(Number(row.credit_transfer) || 0, 0);
      const nextTransferMin =
        nextRow != null
          ? nextRow.transfer_min != null
            ? Number(nextRow.transfer_min)
            : Math.max(Number(nextRow.credit_transfer) || 0, 0)
          : transferMin + 1;
      const transferMax =
        row.transfer_max != null
          ? Number(row.transfer_max)
          : Math.max(transferMin, nextTransferMin - 1);
      const finalTransferMax = transferMax;

      await pool.query(
        `UPDATE semester_entry_rules
         SET transfer_min = COALESCE(transfer_min, ?),
             transfer_max = COALESCE(transfer_max, ?)
         WHERE id = ?`,
        [transferMin, finalTransferMax, Number(row.id)],
      );
    }
  }
};

export const ensureSemesterEntryRuleBandColumns = async () => {
  if (!ensureBandColumnsPromise) {
    ensureBandColumnsPromise = (async () => {
      await addColumnIfMissing({
        tableName: "semester_entry_rules",
        columnName: "transfer_min",
        columnDefinition: "INT NULL",
      });
      await addColumnIfMissing({
        tableName: "semester_entry_rules",
        columnName: "transfer_max",
        columnDefinition: "INT NULL",
      });
      await addColumnIfMissing({
        tableName: "semester_entry_rules",
        columnName: "reference_note",
        columnDefinition: "VARCHAR(255) NULL",
      });
      await backfillSemesterEntryRuleBands();
    })().catch((error) => {
      ensureBandColumnsPromise = null;
      throw error;
    });
  }

  await ensureBandColumnsPromise;
};

export const ensureStudentEntrySemesterColumns = async () => {
  if (!ensureStudentEntryColumnsPromise) {
    ensureStudentEntryColumnsPromise = (async () => {
      await addColumnIfMissing({
        tableName: "students",
        columnName: "system_assigned_entry_semester",
        columnDefinition: "INT DEFAULT NULL",
      });
      await addColumnIfMissing({
        tableName: "students",
        columnName: "final_entry_semester",
        columnDefinition: "INT DEFAULT NULL",
      });
      await addColumnIfMissing({
        tableName: "students",
        columnName: "entry_semester_rule_id",
        columnDefinition: "INT DEFAULT NULL",
      });
      await addColumnIfMissing({
        tableName: "students",
        columnName: "entry_semester_assignment_note",
        columnDefinition: "TEXT NULL",
      });
      await addColumnIfMissing({
        tableName: "students",
        columnName: "is_entry_semester_override",
        columnDefinition: "BOOLEAN NOT NULL DEFAULT FALSE",
      });
      await addColumnIfMissing({
        tableName: "students",
        columnName: "entry_semester_override_reason",
        columnDefinition: "TEXT NULL",
      });
      await addColumnIfMissing({
        tableName: "students",
        columnName: "entry_semester_overridden_by",
        columnDefinition: "VARCHAR(36) NULL",
      });
      await addColumnIfMissing({
        tableName: "students",
        columnName: "entry_semester_overridden_at",
        columnDefinition: "TIMESTAMP NULL DEFAULT NULL",
      });
      await addColumnIfMissing({
        tableName: "students",
        columnName: "intake_assessment_needs_fix",
        columnDefinition: "BOOLEAN NOT NULL DEFAULT FALSE",
      });
      await addColumnIfMissing({
        tableName: "students",
        columnName: "intake_assessment_error_reason",
        columnDefinition: "TEXT NULL",
      });
      await pool.query(`
        UPDATE students
        SET system_assigned_entry_semester = COALESCE(system_assigned_entry_semester, starting_semester),
            final_entry_semester = COALESCE(final_entry_semester, starting_semester)
      `);
    })().catch((error) => {
      ensureStudentEntryColumnsPromise = null;
      throw error;
    });
  }

  await ensureStudentEntryColumnsPromise;
};

export const getProgramCreditCeiling = async (
  programId: number,
  executor: QueryExecutor = pool,
) => {
  const [rows] = await executor.query(
    `SELECT total_credit_required
     FROM programs
     WHERE id = ?
     LIMIT 1`,
    [programId],
  );

  const totalCreditRequired = Number((rows as any[])[0]?.total_credit_required);
  return Number.isFinite(totalCreditRequired) && totalCreditRequired >= 0
    ? totalCreditRequired
    : 0;
};

export const getSemesterEntryBands = async (
  programId: number,
  intakeType: string,
  optionsOrExecutor: QueryExecutor | { includeSystemDefault?: boolean } = pool,
  maybeExecutor?: QueryExecutor,
): Promise<SemesterEntryBand[]> => {
  await ensureSemesterEntryRuleBandColumns();

  const includeSystemDefault =
    typeof (optionsOrExecutor as QueryExecutor)?.query === "function"
      ? true
      : (optionsOrExecutor as { includeSystemDefault?: boolean })
            ?.includeSystemDefault !== false;
  const executor =
    typeof (optionsOrExecutor as QueryExecutor)?.query === "function"
      ? (optionsOrExecutor as QueryExecutor)
      : maybeExecutor || pool;

  const [rows] = await executor.query(
    `SELECT id,
            program_id,
            intake_type,
            credit_transfer,
            COALESCE(transfer_min, credit_transfer) AS transfer_min,
            COALESCE(transfer_max, credit_transfer) AS transfer_max,
            entry_semester,
            reference_note
     FROM semester_entry_rules
     WHERE program_id = ? AND intake_type = ?
     ORDER BY COALESCE(transfer_min, credit_transfer) ASC,
              COALESCE(transfer_max, credit_transfer) ASC,
              id ASC`,
    [programId, intakeType],
  );

  const bands = (rows as any[]).map((row) => ({
    id: Number(row.id),
    program_id: Number(row.program_id),
    intake_type: String(row.intake_type),
    credit_transfer: Number(row.credit_transfer) || 0,
    transfer_min: Math.max(Number(row.transfer_min) || 0, 0),
    transfer_max: Math.max(Number(row.transfer_max) || 0, 0),
    entry_semester: Math.max(Number(row.entry_semester) || 0, 0),
    reference_note: normalizeReferenceNote(row.reference_note),
  }));

  return includeSystemDefault ? withSystemDefaultSemesterOneBand(bands) : bands;
};

export const getSemesterEntryRuleById = async ({
  ruleId,
  programId,
  executor = pool,
}: {
  ruleId: number;
  programId?: number | null;
  executor?: QueryExecutor;
}): Promise<SemesterEntryBand | null> => {
  await ensureSemesterEntryRuleBandColumns();

  const params: any[] = [ruleId];
  let sql = `SELECT id,
                    program_id,
                    intake_type,
                    credit_transfer,
                    COALESCE(transfer_min, credit_transfer) AS transfer_min,
                    COALESCE(transfer_max, credit_transfer) AS transfer_max,
                    entry_semester,
                    reference_note
             FROM semester_entry_rules
             WHERE id = ?`;

  if (programId != null) {
    sql += ` AND program_id = ?`;
    params.push(programId);
  }

  sql += ` LIMIT 1`;

  const [rows] = await executor.query(sql, params);
  const row = (rows as any[])[0];

  if (!row) {
    if (ruleId <= 0) {
      if (programId == null) {
        return null;
      }

      const [intakeRows] = await executor.query(
        `SELECT DISTINCT intake_type
         FROM semester_entry_rules
         WHERE program_id = ?
         ORDER BY intake_type ASC`,
        [programId],
      );

      for (const intakeRow of intakeRows as any[]) {
        const intakeType = String(intakeRow.intake_type || "");
        const matchingBand = (
          await getSemesterEntryBands(programId, intakeType, executor)
        ).find((band) => Number(band.id) === Number(ruleId));

        if (matchingBand) {
          return matchingBand;
        }
      }
    }

    return null;
  }

  return {
    id: Number(row.id),
    program_id: Number(row.program_id),
    intake_type: String(row.intake_type),
    credit_transfer: Number(row.credit_transfer) || 0,
    transfer_min: Math.max(Number(row.transfer_min) || 0, 0),
    transfer_max: Math.max(Number(row.transfer_max) || 0, 0),
    entry_semester: Math.max(Number(row.entry_semester) || 0, 0),
    reference_note: normalizeReferenceNote(row.reference_note),
  };
};

export const getCanonicalSemesterEntryRule = async ({
  programId,
  intakeType,
  entrySemester,
  executor = pool,
}: {
  programId: number;
  intakeType: string;
  entrySemester: number;
  executor?: QueryExecutor;
}) => {
  await ensureSemesterEntryRuleBandColumns();

  const [rows] = await executor.query(
    `SELECT id,
            program_id,
            intake_type,
            credit_transfer,
            COALESCE(transfer_min, credit_transfer) AS transfer_min,
            COALESCE(transfer_max, credit_transfer) AS transfer_max,
            entry_semester,
            reference_note
     FROM semester_entry_rules
     WHERE program_id = ?
       AND intake_type = ?
       AND entry_semester = ?
     ORDER BY COALESCE(transfer_min, credit_transfer) ASC, id ASC
     LIMIT 1`,
    [programId, intakeType, entrySemester],
  );

  const row = (rows as any[])[0];

  if (!row) {
    if (entrySemester === 1) {
      const matchingBand = (
        await getSemesterEntryBands(programId, intakeType, executor)
      ).find((band) => Number(band.entry_semester) === 1);

      return matchingBand || null;
    }

    return null;
  }

  return {
    id: Number(row.id),
    program_id: Number(row.program_id),
    intake_type: String(row.intake_type),
    credit_transfer: Number(row.credit_transfer) || 0,
    transfer_min: Math.max(Number(row.transfer_min) || 0, 0),
    transfer_max: Math.max(Number(row.transfer_max) || 0, 0),
    entry_semester: Math.max(Number(row.entry_semester) || 0, 0),
    reference_note: normalizeReferenceNote(row.reference_note),
  } satisfies SemesterEntryBand;
};

export const getSiblingSemesterEntryRuleIds = async ({
  programId,
  intakeType,
  entrySemester,
  executor = pool,
}: {
  programId: number;
  intakeType: string;
  entrySemester: number;
  executor?: QueryExecutor;
}) => {
  await ensureSemesterEntryRuleBandColumns();

  const [rows] = await executor.query(
    `SELECT id
     FROM semester_entry_rules
     WHERE program_id = ?
       AND intake_type = ?
       AND entry_semester = ?`,
    [programId, intakeType, entrySemester],
  );

  return (rows as any[]).map((row) => Number(row.id)).filter((id) => id > 0);
};

export const validateSemesterEntryBands = ({
  bands,
  creditCeiling,
}: {
  bands: Array<
    Pick<
      SemesterEntryBand,
      "id" | "transfer_min" | "transfer_max" | "entry_semester"
    >
  >;
  creditCeiling: number;
}) => {
  const issues: SemesterEntryBandValidationIssue[] = [];
  const normalizedBands = [...bands].sort((left, right) => {
    if (left.transfer_min !== right.transfer_min) {
      return left.transfer_min - right.transfer_min;
    }
    if (left.transfer_max !== right.transfer_max) {
      return left.transfer_max - right.transfer_max;
    }
    return (left.id || 0) - (right.id || 0);
  });
  const effectiveBands = withSystemDefaultSemesterOneBand(normalizedBands);

  if (effectiveBands.length === 0) {
    issues.push({
      type: "missing",
      message:
        "This intake does not have a semester-entry band table yet. Add bands that cover the transferred-credit range you want the system to support.",
    });

    return {
      is_valid: false,
      issues,
    };
  }

  let expectedMin = 0;

  for (const band of effectiveBands) {
    if (
      !Number.isInteger(band.transfer_min) ||
      !Number.isInteger(band.transfer_max) ||
      band.transfer_min < 0 ||
      band.transfer_max < band.transfer_min
    ) {
      issues.push({
        type: "bounds",
        rule_id: band.id,
        message:
          "Each semester-entry band must use whole numbers and the maximum must be greater than or equal to the minimum.",
      });
      continue;
    }

    if (band.transfer_max > creditCeiling) {
      issues.push({
        type: "bounds",
        rule_id: band.id,
        from: band.transfer_min,
        to: band.transfer_max,
        message: `Band ${band.transfer_min}-${band.transfer_max} exceeds the program credit ceiling of ${creditCeiling}.`,
      });
    }

    if (band.transfer_min > expectedMin) {
      issues.push({
        type: "gap",
        from: expectedMin,
        to: band.transfer_min - 1,
        message: `Missing band coverage for ${expectedMin}-${band.transfer_min - 1} transferred credits.`,
      });
    }

    if (band.transfer_min < expectedMin) {
      issues.push({
        type: "overlap",
        rule_id: band.id,
        from: band.transfer_min,
        to: Math.min(band.transfer_max, expectedMin - 1),
        message: `Band ${band.transfer_min}-${band.transfer_max} overlaps an existing range.`,
      });
    }

    expectedMin = Math.max(expectedMin, band.transfer_max + 1);
  }

  return {
    is_valid: issues.length === 0,
    issues,
  };
};

export const resolveSemesterEntryBand = async ({
  programId,
  intakeType,
  transferredCredits,
  executor = pool,
}: {
  programId: number;
  intakeType: string;
  transferredCredits: number;
  executor?: QueryExecutor;
}) => {
  const creditCeiling = await getProgramCreditCeiling(programId, executor);
  const bands = await getSemesterEntryBands(programId, intakeType, executor);
  const validation = validateSemesterEntryBands({
    bands,
    creditCeiling,
  });

  if (!validation.is_valid) {
    return {
      band: null,
      explanation: null,
      creditCeiling,
      validation,
    };
  }

  const normalizedCredits = Math.max(Number(transferredCredits) || 0, 0);
  const band = bands.find(
    (candidate) =>
      normalizedCredits >= candidate.transfer_min &&
      normalizedCredits <= candidate.transfer_max,
  );

  if (!band) {
    return {
      band: null,
      explanation: null,
      creditCeiling,
      validation: {
        is_valid: false,
        issues: [
          {
            type: "missing",
            message: `No semester-entry band matched ${normalizedCredits} transferred credits.`,
          },
        ],
      },
    };
  }

  return {
    band,
    explanation: `${intakeType} + ${normalizedCredits} transferred credits matched the ${band.transfer_min}-${band.transfer_max} band -> Semester ${band.entry_semester}`,
    creditCeiling,
    validation,
  };
};
