import { pool } from "~~/server/utils/db";
import {
  formatIntakeLifecyclePattern,
  getLifecycleSemesterTypeForSlot,
  resolveIntakeLifecyclePattern,
  type IntakeLifecyclePattern,
} from "~~/server/utils/intake-lifecycle";
import {
  getCanonicalSemesterEntryRule,
  getSemesterEntryBands,
  getSemesterEntryRuleById,
  resolveSemesterEntryBand,
  type SemesterEntryBand,
} from "~~/server/utils/semester-entry-bands";
import {
  getJourneyOverflowAllowance,
  getLatestProgramStructureSessionId,
  getProgramSemesterPlanConstraints,
  getSemesterRulePlanCreditExceptions,
  type ProgramSemesterPlanConstraints,
  type SemesterRulePlan,
} from "~~/server/utils/semester-rule-plans";
import {
  getApplicableSemesterRuleExceptionAllowances,
  getSemesterRuleExceptionWindows,
  replaceSemesterRuleExceptionWindows,
  validateSemesterRuleExceptionWindows,
  type SemesterRuleExceptionAllowance,
  type SemesterRuleExceptionWindow,
  type SemesterRuleExceptionWindowValidationIssue,
} from "~~/server/utils/semester-rule-exception-windows";
import { getProgramStructureCourses } from "~~/server/utils/program-structure-courses";

type QueryExecutor = {
  query: (sql: string, values?: any) => Promise<any>;
};

export type SemesterRuleJourneySlotRole =
  | "regular"
  | "fyp1"
  | "fyp2"
  | "li";

export interface SemesterRuleJourneySlot {
  id?: number;
  rule_id?: number;
  slot_order: number;
  semester_type: "L" | "S";
  slot_role: SemesterRuleJourneySlotRole;
}

export interface ResolvedSemesterRuleJourneySlot
  extends SemesterRuleJourneySlot {
  semester_number: number;
  is_li: boolean;
}

export interface SemesterRuleJourneyValidationIssue {
  code:
    | "missing_slots"
    | "slot_order_gap"
    | "duplicate_special_role"
    | "missing_required_role"
    | "fyp_order"
    | "role_type_conflict";
  message: string;
  slot_order?: number;
  slot_role?: SemesterRuleJourneySlotRole;
}

export interface SemesterRuleJourneyPreviewSemester {
  slot_order: number;
  semester_number: number;
  semester_type: "L" | "S";
  slot_role: SemesterRuleJourneySlotRole;
  estimated_credits: number;
  is_credit_exception: boolean;
}

export interface SemesterRuleJourneyPreviewScenario {
  label: "Lowest" | "Middle" | "Highest";
  transferred_credits: number;
  estimated_remaining_credits: number;
  auto_appended_slots: number;
  semesters: SemesterRuleJourneyPreviewSemester[];
}

export interface SemesterRuleJourneyExactPreview {
  transferred_credits: number;
  estimated_remaining_credits: number;
  auto_appended_slots: number;
  semesters: SemesterRuleJourneyPreviewSemester[];
}

export interface ResolvedSemesterRuleJourneyPlanSet {
  rule: SemesterEntryBand | null;
  intake_lifecycle_pattern: IntakeLifecyclePattern;
  intake_lifecycle_source: "configured" | "default";
  journey_slots: ResolvedSemesterRuleJourneySlot[];
  exception_windows: SemesterRuleExceptionWindow[];
  exception_window_suggestions: SemesterRuleExceptionWindow[];
  explanation: string | null;
  exact_preview: SemesterRuleJourneyExactPreview | null;
  preview_scenarios: SemesterRuleJourneyPreviewScenario[];
  validation_issues: Array<
    SemesterRuleJourneyValidationIssue | SemesterRuleExceptionWindowValidationIssue
  >;
}

interface ProgramSpecialSemesterMetadata {
  maxSemester: number;
  semestersByRole: Partial<Record<SemesterRuleJourneySlotRole, number>>;
  roleCredits: Record<SemesterRuleJourneySlotRole, number>;
  requiredRoles: SemesterRuleJourneySlotRole[];
}

const RULES_ONLY_PREVIEW_ROLE_CREDITS: Record<
  SemesterRuleJourneySlotRole,
  number
> = {
  regular: 0,
  fyp1: 0,
  fyp2: 0,
  li: 8,
};

const JOURNEY_ROLE_PRIORITY: SemesterRuleJourneySlotRole[] = [
  "li",
  "fyp2",
  "fyp1",
  "regular",
];

let ensureJourneySlotsTablePromise: Promise<void> | null = null;

const normalizeJourneySlotRole = (
  value: unknown,
): SemesterRuleJourneySlotRole => {
  const normalizedValue = String(value || "")
    .trim()
    .toLowerCase();

  if (normalizedValue === "li") {
    return "li";
  }

  if (normalizedValue === "fyp2") {
    return "fyp2";
  }

  if (normalizedValue === "fyp1") {
    return "fyp1";
  }

  return "regular";
};

const normalizeJourneySlot = (
  slot: SemesterRuleJourneySlot,
): SemesterRuleJourneySlot => {
  const slotRole = normalizeJourneySlotRole(slot.slot_role);
  const semesterType =
    slotRole === "li" || slotRole === "fyp2"
      ? "L"
      : slot.semester_type === "S"
        ? "S"
        : "L";

  return {
    id: slot.id,
    rule_id: slot.rule_id,
    slot_order: Math.max(Number(slot.slot_order) || 0, 1),
    semester_type: semesterType,
    slot_role: slotRole,
  };
};

const applyLifecycleToJourneySlot = ({
  slot,
  lifecyclePattern,
}: {
  slot: SemesterRuleJourneySlot;
  lifecyclePattern: IntakeLifecyclePattern;
}): SemesterRuleJourneySlot => {
  const normalizedSlot = normalizeJourneySlot(slot);

  return {
    ...normalizedSlot,
    semester_type: getLifecycleSemesterTypeForSlot({
      lifecyclePattern,
      slotOrder: normalizedSlot.slot_order,
      slotRole: normalizedSlot.slot_role,
    }),
  };
};

const applyLifecycleToJourneySlots = ({
  slots,
  lifecyclePattern,
}: {
  slots: SemesterRuleJourneySlot[];
  lifecyclePattern: IntakeLifecyclePattern;
}) =>
  [...slots]
    .map((slot) =>
      applyLifecycleToJourneySlot({
        slot,
        lifecyclePattern,
      }),
    )
    .sort((left, right) => left.slot_order - right.slot_order)
    .map((slot, index) => ({
      ...slot,
      slot_order: index + 1,
      semester_type: getLifecycleSemesterTypeForSlot({
        lifecyclePattern,
        slotOrder: index + 1,
        slotRole: slot.slot_role,
      }),
    }));

const areJourneySlotsEquivalent = (
  left: SemesterRuleJourneySlot[],
  right: SemesterRuleJourneySlot[],
) => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((slot, index) => {
    const other = right[index];
    return (
      other &&
      slot.slot_order === other.slot_order &&
      slot.semester_type === other.semester_type &&
      slot.slot_role === other.slot_role
    );
  });
};

const sortJourneySlots = (slots: SemesterRuleJourneySlot[]) =>
  [...slots]
    .map((slot) => normalizeJourneySlot(slot))
    .sort((left, right) => left.slot_order - right.slot_order);

const applyFixedPurposePlacementToJourneySlots = ({
  slots,
  lifecyclePattern,
}: {
  slots: SemesterRuleJourneySlot[];
  lifecyclePattern: IntakeLifecyclePattern;
}) => {
  const baseSlots = sortJourneySlots(slots).map((slot, index) =>
    applyLifecycleToJourneySlot({
      slot: {
        ...slot,
        slot_order: index + 1,
        slot_role: "regular",
      },
      lifecyclePattern,
    }),
  );

  const assignedRoles = Array.from(
    { length: baseSlots.length },
    () => "regular" as SemesterRuleJourneySlotRole,
  );
  const longIndexes = baseSlots
    .map((slot, index) => (slot.semester_type === "L" ? index : -1))
    .filter((index) => index >= 0);
  const liIndex =
    longIndexes.length > 0 ? longIndexes[longIndexes.length - 1] : null;

  if (liIndex != null) {
    assignedRoles[liIndex] = "li";
  }

  const fyp2Index =
    liIndex != null
      ? [...longIndexes].reverse().find((index) => index < liIndex)
      : undefined;

  if (fyp2Index != null) {
    assignedRoles[fyp2Index] = "fyp2";
  }

  const fyp1Index =
    fyp2Index != null && fyp2Index > 0 ? fyp2Index - 1 : undefined;

  if (fyp1Index != null) {
    assignedRoles[fyp1Index] = "fyp1";
  }

  return baseSlots.map((slot, index) =>
    applyLifecycleToJourneySlot({
      slot: {
        ...slot,
        slot_role: assignedRoles[index] || "regular",
      },
      lifecyclePattern,
    }),
  );
};

const getCoverageRangeLabel = (
  rule: Pick<SemesterEntryBand, "transfer_min" | "transfer_max">,
) =>
  Number(rule.transfer_min) === Number(rule.transfer_max)
    ? `${rule.transfer_min}`
    : `${rule.transfer_min}-${rule.transfer_max}`;

const getRoleLabel = (role: SemesterRuleJourneySlotRole) => {
  switch (role) {
    case "li":
      return "LI";
    case "fyp1":
      return "FYP1";
    case "fyp2":
      return "FYP2";
    default:
      return "Regular";
  }
};

const getSlotBounds = (
  semesterType: "L" | "S",
  constraints: ProgramSemesterPlanConstraints,
) =>
  semesterType === "L"
    ? { min: constraints.long_min, max: constraints.long_max }
    : { min: constraints.short_min, max: constraints.short_max };

const DEFAULT_PROGRAM_FINAL_SEMESTER = 9;

const getEffectiveSlotBounds = ({
  semesterType,
  slotOrder,
  allowances,
  constraints,
}: {
  semesterType: "L" | "S";
  slotOrder: number;
  allowances: Map<number, SemesterRuleExceptionAllowance>;
  constraints: ProgramSemesterPlanConstraints;
}) => {
  const bounds = getSlotBounds(semesterType, constraints);
  const allowance = allowances.get(slotOrder);

  return {
    min: Math.max(bounds.min - (allowance?.allowed_underload_credits || 0), 0),
    max: bounds.max + (allowance?.allowed_overload_credits || 0),
  };
};

const getDerivedSemesterNumber = (
  entrySemester: number,
  slotOrder: number,
) => Math.max(Number(entrySemester) || 1, 1) + Math.max(slotOrder - 1, 0);

const toResolvedJourneySlots = ({
  entrySemester,
  slots,
}: {
  entrySemester: number;
  slots: SemesterRuleJourneySlot[];
}): ResolvedSemesterRuleJourneySlot[] =>
  sortJourneySlots(slots).map((slot) => ({
    ...slot,
    semester_number: getDerivedSemesterNumber(entrySemester, slot.slot_order),
    is_li: slot.slot_role === "li",
  }));

const getJourneySummaryText = (
  slots: SemesterRuleJourneySlot[],
  entrySemester: number,
) =>
  toResolvedJourneySlots({
    entrySemester,
    slots,
  })
    .map((slot) => {
      const roleSuffix =
        slot.slot_role === "regular" ? "" : ` (${getRoleLabel(slot.slot_role)})`;
      return `Sem ${slot.semester_number} ${slot.semester_type}${roleSuffix}`;
    })
    .join(" -> ");

const getScenarioCredits = (
  rule: Pick<SemesterEntryBand, "transfer_min" | "transfer_max">,
) => {
  const transferMin = Math.max(Number(rule.transfer_min) || 0, 0);
  const transferMax = Math.max(Number(rule.transfer_max) || 0, transferMin);
  const middle = Math.floor((transferMin + transferMax) / 2);

  const ordered = Array.from(
    new Set([transferMin, middle, transferMax]),
  ).sort((left, right) => left - right);

  const labels: Array<"Lowest" | "Middle" | "Highest"> = [
    "Lowest",
    "Middle",
    "Highest",
  ];

  return ordered.map((transferredCredits, index) => ({
    label: labels[Math.min(index, labels.length - 1)]!,
    transferred_credits: transferredCredits,
  }));
};

const getRolePriorityIndex = (role: SemesterRuleJourneySlotRole) =>
  JOURNEY_ROLE_PRIORITY.indexOf(role);

const groupExactCreditExceptionWindows = (
  windows: SemesterRuleExceptionWindow[],
) => {
  const normalizedWindows = normalizeAndSortExactWindows(windows);
  const grouped: SemesterRuleExceptionWindow[] = [];

  for (const window of normalizedWindows) {
    const previous = grouped.at(-1);
    if (
      previous &&
      previous.slot_order === window.slot_order &&
      previous.allowed_overload_credits === window.allowed_overload_credits &&
      previous.allowed_underload_credits === window.allowed_underload_credits &&
      previous.default_reason === window.default_reason &&
      previous.transfer_max + 1 === window.transfer_min
    ) {
      previous.transfer_max = window.transfer_max;
      continue;
    }

    grouped.push({ ...window });
  }

  return grouped;
};

const normalizeAndSortExactWindows = (windows: SemesterRuleExceptionWindow[]) =>
  [...windows]
    .map((window) => ({
      ...window,
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
    }))
    .filter(
      (window) =>
        window.allowed_overload_credits > 0 ||
        window.allowed_underload_credits > 0,
    )
    .sort((left, right) => {
      if (left.slot_order !== right.slot_order) {
        return left.slot_order - right.slot_order;
      }

      if (left.transfer_min !== right.transfer_min) {
        return left.transfer_min - right.transfer_min;
      }

      return left.transfer_max - right.transfer_max;
    });

const getProgramSpecialSemesterMetadata = async ({
  sessionId,
  entrySemester,
  executor = pool,
}: {
  sessionId: number;
  entrySemester: number;
  executor?: QueryExecutor;
}): Promise<ProgramSpecialSemesterMetadata> => {
  const [courseRows] = await executor.query(
    `SELECT pc.semester, pc.course_type, c.course_name, c.credit_hour
     FROM program_courses pc
     JOIN courses c ON c.id = pc.course_id
     WHERE pc.session_id = ?
     ORDER BY pc.semester ASC, pc.id ASC`,
    [sessionId],
  );

  const roleCredits: Record<SemesterRuleJourneySlotRole, number> = {
    regular: 0,
    fyp1: 0,
    fyp2: 0,
    li: 0,
  };
  const semestersByRole: Partial<Record<SemesterRuleJourneySlotRole, number>> = {};
  const liCreditsBySemester = new Map<number, number>();
  const fypCreditsBySemester = new Map<number, number>();
  let maxSemester = Math.max(Number(entrySemester) || 1, 1);

  for (const row of courseRows as any[]) {
    const semesterNumber = Number(row.semester) || 0;
    if (semesterNumber < entrySemester) {
      continue;
    }

    maxSemester = Math.max(maxSemester, semesterNumber);
    const courseType = String(row.course_type || "");
    const creditHour = Number(row.credit_hour) || 0;

    if (courseType === "Industrial Training") {
      liCreditsBySemester.set(
        semesterNumber,
        (liCreditsBySemester.get(semesterNumber) || 0) + creditHour,
      );
      continue;
    }

    if (courseType === "Final Year Project") {
      fypCreditsBySemester.set(
        semesterNumber,
        (fypCreditsBySemester.get(semesterNumber) || 0) + creditHour,
      );
    }
  }

  const liSemesters = Array.from(liCreditsBySemester.keys()).sort(
    (left, right) => left - right,
  );
  if (liSemesters.length > 0) {
    const liSemester = liSemesters[0]!;
    semestersByRole.li = liSemester;
    roleCredits.li = liCreditsBySemester.get(liSemester) || 0;
  }

  const fypSemesters = Array.from(fypCreditsBySemester.keys()).sort(
    (left, right) => left - right,
  );
  if (fypSemesters.length > 0) {
    const fyp1Semester = fypSemesters[0]!;
    semestersByRole.fyp1 = fyp1Semester;
    roleCredits.fyp1 = fypCreditsBySemester.get(fyp1Semester) || 0;
  }

  if (fypSemesters.length > 1) {
    const fyp2Semester = fypSemesters[1]!;
    semestersByRole.fyp2 = fyp2Semester;
    roleCredits.fyp2 = fypCreditsBySemester.get(fyp2Semester) || 0;
  }

  const requiredRoles = JOURNEY_ROLE_PRIORITY.filter(
    (role) => role !== "regular" && semestersByRole[role] != null,
  );

  return {
    maxSemester,
    semestersByRole,
    roleCredits,
    requiredRoles,
  };
};

const buildRulesOnlyPreviewMetadata = ({
  resolvedSlots,
}: {
  resolvedSlots: ResolvedSemesterRuleJourneySlot[];
}): ProgramSpecialSemesterMetadata => {
  const semestersByRole: Partial<Record<SemesterRuleJourneySlotRole, number>> =
    {};

  for (const slot of resolvedSlots) {
    if (slot.slot_role === "regular") {
      continue;
    }

    if (semestersByRole[slot.slot_role] != null) {
      continue;
    }

    semestersByRole[slot.slot_role] = slot.semester_number;
  }

  return {
    maxSemester:
      resolvedSlots.at(-1)?.semester_number ||
      Math.max(resolvedSlots[0]?.semester_number || 1, 1),
    semestersByRole,
    roleCredits: { ...RULES_ONLY_PREVIEW_ROLE_CREDITS },
    requiredRoles: [],
  };
};

const getPreviewMetadataForJourney = async ({
  resolvedSlots,
  sessionId,
  entrySemester,
  executor = pool,
}: {
  resolvedSlots: ResolvedSemesterRuleJourneySlot[];
  sessionId?: number | null;
  entrySemester: number;
  executor?: QueryExecutor;
}): Promise<ProgramSpecialSemesterMetadata> => {
  if (sessionId) {
    return getProgramSpecialSemesterMetadata({
      sessionId,
      entrySemester,
      executor,
    });
  }

  return buildRulesOnlyPreviewMetadata({
    resolvedSlots,
  });
};

const getStoredJourneyFinalSemesterNumber = async ({
  band,
  executor = pool,
}: {
  band: SemesterEntryBand;
  executor?: QueryExecutor;
}) => {
  const storedSlots = await getSemesterRuleJourneySlots({
    ruleId: band.id,
    executor,
  });

  if (storedSlots.length === 0) {
    return null;
  }

  return getDerivedSemesterNumber(
    Number(band.entry_semester),
    storedSlots.length,
  );
};

const getProgramDurationSemesters = async ({
  programId,
  executor = pool,
}: {
  programId: number;
  executor?: QueryExecutor;
}) => {
  const [rows] = await executor.query(
    `SELECT duration_semesters
       FROM programs
      WHERE id = ?
      LIMIT 1`,
    [programId],
  );

  const durationSemesters = Number(rows?.[0]?.duration_semesters ?? 0);

  return Number.isFinite(durationSemesters) && durationSemesters >= 1
    ? durationSemesters
    : null;
};

const resolveDefaultJourneyFinalSemesterNumber = async ({
  rule,
  programId,
  executor = pool,
}: {
  rule: SemesterEntryBand;
  programId: number;
  executor?: QueryExecutor;
}) => {
  const durationSemesters = await getProgramDurationSemesters({
    programId,
    executor,
  });

  if (durationSemesters != null) {
    return durationSemesters;
  }

  const siblingBands = await getSemesterEntryBands(
    programId,
    rule.intake_type,
    executor,
  );

  let inferredFinalSemester: number | null = null;

  for (const siblingBand of siblingBands) {
    if (Number(siblingBand.id) === Number(rule.id)) {
      continue;
    }

    const siblingFinalSemester = await getStoredJourneyFinalSemesterNumber({
      band: siblingBand,
      executor,
    });

    if (siblingFinalSemester != null) {
      inferredFinalSemester = Math.max(
        inferredFinalSemester ?? siblingFinalSemester,
        siblingFinalSemester,
      );
    }
  }

  if (inferredFinalSemester != null) {
    return inferredFinalSemester;
  }

  const latestSessionId = await getLatestProgramStructureSessionId(
    programId,
    executor,
  );

  if (latestSessionId) {
    const metadata = await getProgramSpecialSemesterMetadata({
      sessionId: latestSessionId,
      entrySemester: 1,
      executor,
    });

    if (metadata.maxSemester >= 1) {
      return metadata.maxSemester;
    }
  }

  return DEFAULT_PROGRAM_FINAL_SEMESTER;
};

const copyJourneySlotsFromSimilarBand = async ({
  rule,
  programId,
  lifecyclePattern,
  executor = pool,
}: {
  rule: SemesterEntryBand;
  programId: number;
  lifecyclePattern: IntakeLifecyclePattern;
  executor?: QueryExecutor;
}) => {
  const siblingBands = (
    await getSemesterEntryBands(programId, rule.intake_type, executor)
  )
    .filter(
      (candidate) =>
        Number(candidate.id) !== Number(rule.id) &&
        Number(candidate.entry_semester) === Number(rule.entry_semester),
    )
    .sort((left, right) => {
      const leftDistance = Math.abs(
        Number(left.transfer_min) - Number(rule.transfer_min),
      );
      const rightDistance = Math.abs(
        Number(right.transfer_min) - Number(rule.transfer_min),
      );

      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      return Number(left.transfer_min) - Number(right.transfer_min);
    });

  for (const siblingBand of siblingBands) {
    const siblingSlots = await getSemesterRuleJourneySlots({
      ruleId: siblingBand.id,
      executor,
    });

    if (siblingSlots.length > 0) {
      return applyLifecycleToJourneySlots({
        slots: siblingSlots,
        lifecyclePattern,
      });
    }
  }

  return [];
};

const buildLifecycleDefaultJourneySlots = async ({
  rule,
  programId,
  lifecyclePattern,
  executor = pool,
}: {
  rule: SemesterEntryBand;
  programId: number;
  lifecyclePattern: IntakeLifecyclePattern;
  executor?: QueryExecutor;
}) => {
  const copiedSlots = await copyJourneySlotsFromSimilarBand({
    rule,
    programId,
    lifecyclePattern,
    executor,
  });

  if (copiedSlots.length > 0) {
    return copiedSlots;
  }

  const finalSemesterNumber = await resolveDefaultJourneyFinalSemesterNumber({
    rule,
    programId,
    executor,
  });
  const slotCount = Math.max(
    1,
    Number(finalSemesterNumber) - Number(rule.entry_semester) + 1,
  );

  return applyFixedPurposePlacementToJourneySlots({
    slots: Array.from({ length: slotCount }, (_, index) =>
      normalizeJourneySlot({
        slot_order: index + 1,
        semester_type: getLifecycleSemesterTypeForSlot({
          lifecyclePattern,
          slotOrder: index + 1,
          slotRole: "regular",
        }),
        slot_role: "regular",
      }),
    ),
    lifecyclePattern,
  });
};

const buildDefaultJourneySlotsForRule = async ({
  rule,
  programId,
  executor = pool,
}: {
  rule: SemesterEntryBand;
  programId: number;
  executor?: QueryExecutor;
}) => {
  const lifecycleConfig = await resolveIntakeLifecyclePattern({
    programId,
    intakeType: rule.intake_type,
    executor,
  });
  const lifecyclePattern = lifecycleConfig.lifecycle_pattern;

  return buildLifecycleDefaultJourneySlots({
    rule,
    programId,
    lifecyclePattern,
    executor,
  });
};

const resolveRuleForJourneyLookup = async ({
  programId,
  intakeType,
  entrySemester,
  transferredCredits,
  ruleId,
  executor = pool,
}: {
  programId: number;
  intakeType: string;
  entrySemester: number;
  transferredCredits?: number | null;
  ruleId?: number | null;
  executor?: QueryExecutor;
}) => {
  if (ruleId != null) {
    const explicitRule = await getSemesterEntryRuleById({
      ruleId,
      programId,
      executor,
    });

    if (
      explicitRule &&
      explicitRule.intake_type === intakeType &&
      Number(explicitRule.entry_semester) === Number(entrySemester)
    ) {
      return explicitRule;
    }
  }

  if (transferredCredits != null) {
    const resolvedBand = await resolveSemesterEntryBand({
      programId,
      intakeType,
      transferredCredits: Number(transferredCredits),
      executor,
    });

    if (
      resolvedBand.band &&
      Number(resolvedBand.band.entry_semester) === Number(entrySemester)
    ) {
      return resolvedBand.band;
    }
  }

  const matchingBands = (
    await getSemesterEntryBands(programId, intakeType, executor)
  )
    .filter((band) => Number(band.entry_semester) === Number(entrySemester))
    .sort((left, right) => left.transfer_min - right.transfer_min);

  if (matchingBands.length > 0) {
    if (transferredCredits != null) {
      const normalizedTransferredCredits = Math.max(
        Number(transferredCredits) || 0,
        0,
      );
      const nearestLowerBand = [...matchingBands]
        .filter((band) => normalizedTransferredCredits >= band.transfer_min)
        .sort((left, right) => right.transfer_min - left.transfer_min)[0];

      if (nearestLowerBand) {
        return nearestLowerBand;
      }
    }

    return matchingBands[0]!;
  }

  return getCanonicalSemesterEntryRule({
    programId,
    intakeType,
    entrySemester,
    executor,
  });
};

export const ensureSemesterRuleJourneySlotsTable = async () => {
  if (!ensureJourneySlotsTablePromise) {
    ensureJourneySlotsTablePromise = pool
      .query(`
        CREATE TABLE IF NOT EXISTS semester_rule_journey_slots (
          id INT AUTO_INCREMENT PRIMARY KEY,
          rule_id INT NOT NULL,
          slot_order INT NOT NULL,
          semester_type ENUM('L', 'S') NOT NULL,
          slot_role ENUM('regular', 'fyp1', 'fyp2', 'li') NOT NULL DEFAULT 'regular',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

          CONSTRAINT fk_srjs_rule
            FOREIGN KEY (rule_id) REFERENCES semester_entry_rules(id) ON DELETE CASCADE,

          UNIQUE KEY unique_rule_slot_order (rule_id, slot_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
      .then(() => undefined)
      .catch((error) => {
        ensureJourneySlotsTablePromise = null;
        throw error;
      });
  }

  await ensureJourneySlotsTablePromise;
};

export const getSemesterRuleJourneySlots = async ({
  ruleId,
  lifecyclePattern,
  executor = pool,
}: {
  ruleId: number;
  lifecyclePattern?: IntakeLifecyclePattern | null;
  executor?: QueryExecutor;
}) => {
  await ensureSemesterRuleJourneySlotsTable();

  const [rows] = await executor.query(
    `SELECT id, rule_id, slot_order, semester_type, slot_role
     FROM semester_rule_journey_slots
     WHERE rule_id = ?
     ORDER BY slot_order ASC`,
    [ruleId],
  );

  const normalizedSlots = sortJourneySlots(
    (rows as any[]).map((row) => ({
      id: Number(row.id),
      rule_id: Number(row.rule_id),
      slot_order: Number(row.slot_order),
      semester_type: row.semester_type as "L" | "S",
      slot_role: normalizeJourneySlotRole(row.slot_role),
    })),
  );

  return lifecyclePattern
    ? applyLifecycleToJourneySlots({
        slots: normalizedSlots,
        lifecyclePattern,
      })
    : normalizedSlots;
};

export const replaceSemesterRuleJourneySlots = async ({
  ruleId,
  slots,
  lifecyclePattern,
  executor = pool,
}: {
  ruleId: number;
  slots: SemesterRuleJourneySlot[];
  lifecyclePattern?: IntakeLifecyclePattern | null;
  executor?: QueryExecutor;
}) => {
  await ensureSemesterRuleJourneySlotsTable();

  const normalizedSlots = (
    lifecyclePattern
      ? applyLifecycleToJourneySlots({
          slots,
          lifecyclePattern,
        })
      : sortJourneySlots(slots)
  ).map((slot, index) => ({
    ...slot,
    slot_order: index + 1,
    semester_type: lifecyclePattern
      ? getLifecycleSemesterTypeForSlot({
          lifecyclePattern,
          slotOrder: index + 1,
          slotRole: slot.slot_role,
        })
      : slot.semester_type,
  }));

  await executor.query(
    `DELETE FROM semester_rule_journey_slots WHERE rule_id = ?`,
    [ruleId],
  );

  if (normalizedSlots.length === 0) {
    return;
  }

  const values = normalizedSlots.map((slot) => [
    ruleId,
    slot.slot_order,
    slot.semester_type,
    slot.slot_role,
  ]);

  await executor.query(
    `INSERT INTO semester_rule_journey_slots (
      rule_id,
      slot_order,
      semester_type,
      slot_role
    ) VALUES ?`,
    [values],
  );
};

export const ensureSemesterRuleJourneySlotsSeeded = async ({
  rule,
  programId,
  executor = pool,
}: {
  rule: SemesterEntryBand;
  programId: number;
  executor?: QueryExecutor;
}) => {
  await ensureSemesterRuleJourneySlotsTable();
  const lifecycleConfig = await resolveIntakeLifecyclePattern({
    programId,
    intakeType: rule.intake_type,
    executor,
  });
  const lifecyclePattern = lifecycleConfig.lifecycle_pattern;

  if (!Number.isInteger(rule.id) || Number(rule.id) <= 0) {
    return buildDefaultJourneySlotsForRule({
      rule,
      programId,
      executor,
    });
  }

  const existingSlots = await getSemesterRuleJourneySlots({
    ruleId: rule.id,
    lifecyclePattern,
    executor,
  });

  if (existingSlots.length > 0) {
    const storedSlots = await getSemesterRuleJourneySlots({
      ruleId: rule.id,
      executor,
    });

    if (!areJourneySlotsEquivalent(storedSlots, existingSlots)) {
      await replaceSemesterRuleJourneySlots({
        ruleId: rule.id,
        slots: existingSlots,
        lifecyclePattern,
        executor,
      });
    }

    return existingSlots;
  }

  const defaultSlots = await buildDefaultJourneySlotsForRule({
    rule,
    programId,
    executor,
  });

  if (defaultSlots.length > 0) {
    await replaceSemesterRuleJourneySlots({
      ruleId: rule.id,
      slots: defaultSlots,
      lifecyclePattern,
      executor,
    });
  }

  return lifecyclePattern
    ? applyLifecycleToJourneySlots({
        slots: defaultSlots,
        lifecyclePattern,
      })
    : defaultSlots;
};

export const validateSemesterRuleJourneySlots = async ({
  slots,
  entrySemester,
}: {
  slots: SemesterRuleJourneySlot[];
  entrySemester: number;
}) => {
  const normalizedSlots = sortJourneySlots(slots);
  const issues: SemesterRuleJourneyValidationIssue[] = [];

  if (normalizedSlots.length === 0) {
    return {
      issues: [
        {
          code: "missing_slots",
          message: "Add at least one journey slot for this band.",
        },
      ],
    };
  }

  for (let index = 0; index < normalizedSlots.length; index++) {
    const slot = normalizedSlots[index]!;
    if (slot.slot_order !== index + 1) {
      issues.push({
        code: "slot_order_gap",
        slot_order: slot.slot_order,
        message:
          "Journey slots must stay in a continuous order without gaps.",
      });
      break;
    }
  }

  const specialRoleCounts = new Map<SemesterRuleJourneySlotRole, number>();
  for (const slot of normalizedSlots) {
    if (slot.slot_role === "regular") {
      continue;
    }

    specialRoleCounts.set(
      slot.slot_role,
      (specialRoleCounts.get(slot.slot_role) || 0) + 1,
    );

    if (slot.slot_role === "li" || slot.slot_role === "fyp2") {
      if (slot.semester_type !== "L") {
        issues.push({
          code: "role_type_conflict",
          slot_order: slot.slot_order,
          slot_role: slot.slot_role,
          message: `${getRoleLabel(slot.slot_role)} must be placed in a long semester.`,
        });
      }
    }
  }

  for (const [slotRole, count] of specialRoleCounts.entries()) {
    if (count > 1) {
      issues.push({
        code: "duplicate_special_role",
        slot_role: slotRole,
        message: `Only one ${getRoleLabel(slotRole)} slot can be configured in a band journey.`,
      });
    }
  }

  const fyp1Slot = normalizedSlots.find((slot) => slot.slot_role === "fyp1");
  const fyp2Slot = normalizedSlots.find((slot) => slot.slot_role === "fyp2");
  if (
    fyp1Slot &&
    fyp2Slot &&
    fyp2Slot.slot_order <= fyp1Slot.slot_order
  ) {
    issues.push({
      code: "fyp_order",
      message: "FYP2 must come after FYP1 in the configured journey.",
    });
  }

  return { issues };
};

const distributePreviewCredits = ({
  baseSemesters,
  remainingCredits,
  constraints,
  lifecyclePattern,
  startingSemester,
  exceptionAllowances,
  allowSuggestedOverflow = false,
}: {
  baseSemesters: SemesterRuleJourneyPreviewSemester[];
  remainingCredits: number;
  constraints: ProgramSemesterPlanConstraints;
  lifecyclePattern: IntakeLifecyclePattern;
  startingSemester: number;
  exceptionAllowances: Map<number, SemesterRuleExceptionAllowance>;
  allowSuggestedOverflow?: boolean;
}) => {
  const semesters = baseSemesters.map((semester) => ({ ...semester }));
  let remaining = remainingCredits;
  let autoAppendedSlots = 0;

  const getAdjustableIndexes = () =>
    semesters
      .map((semester, index) => ({
        index,
        semester,
      }))
      .filter((item) => item.semester.slot_role !== "li");

  const getOverflowCandidates = () =>
    semesters
      .filter((semester) => semester.slot_role !== "li")
      .sort((left, right) => {
        const leftRegular = left.slot_role === "regular" ? 0 : 1;
        const rightRegular = right.slot_role === "regular" ? 0 : 1;
        if (leftRegular !== rightRegular) {
          return leftRegular - rightRegular;
        }

        const leftLong = left.semester_type === "L" ? 0 : 1;
        const rightLong = right.semester_type === "L" ? 0 : 1;
        if (leftLong !== rightLong) {
          return leftLong - rightLong;
        }

        return right.semester_number - left.semester_number;
      });

  const getSoftOverflowMax = (semester: SemesterRuleJourneyPreviewSemester) =>
    getSlotBounds(semester.semester_type, constraints).max +
    (allowSuggestedOverflow
      ? getJourneyOverflowAllowance({
          semesterType: semester.semester_type,
          slotRole: semester.slot_role,
        })
      : 0);

  const ensureExtraSemester = (forceLong = false) => {
    const lastSemesterNumber =
      semesters.at(-1)?.semester_number ?? Math.max(startingSemester - 1, 0);
    const relativeSemester = lastSemesterNumber - startingSemester + 1;
    let semesterType =
      lifecyclePattern[(relativeSemester + 1) % lifecyclePattern.length] || "L";

    if (forceLong && semesterType === "S") {
      semesterType = "L";
    }

    semesters.push({
      slot_order: (semesters.at(-1)?.slot_order || baseSemesters.length) + 1,
      semester_number: lastSemesterNumber + 1,
      semester_type: semesterType,
      slot_role: "regular",
      estimated_credits: 0,
      is_credit_exception: false,
    });
    autoAppendedSlots += 1;
  };

  while (remaining > 0 && getAdjustableIndexes().length === 0) {
    ensureExtraSemester();
  }

  let updated = true;
  while (remaining > 0 && updated) {
    updated = false;

    for (const { semester } of getAdjustableIndexes()) {
      const bounds = getEffectiveSlotBounds({
        semesterType: semester.semester_type,
        slotOrder: semester.slot_order,
        allowances: exceptionAllowances,
        constraints,
      });
      if (semester.estimated_credits >= bounds.min) {
        continue;
      }

      semester.estimated_credits += 1;
      remaining -= 1;
      updated = true;

      if (remaining <= 0) {
        break;
      }
    }
  }

  while (remaining > 0) {
    let progressed = false;

    for (const { semester } of getAdjustableIndexes()) {
      const bounds = getEffectiveSlotBounds({
        semesterType: semester.semester_type,
        slotOrder: semester.slot_order,
        allowances: exceptionAllowances,
        constraints,
      });
      if (semester.estimated_credits >= bounds.max) {
        continue;
      }

      semester.estimated_credits += 1;
      remaining -= 1;
      progressed = true;

      if (remaining <= 0) {
        break;
      }
    }

    if (!progressed) {
      break;
    }
  }

  while (remaining > 0) {
    let progressed = false;

    for (const semester of getOverflowCandidates()) {
      const exceptionMax = getSoftOverflowMax(semester);

      if (semester.estimated_credits >= exceptionMax) {
        continue;
      }

      semester.estimated_credits += 1;
      remaining -= 1;
      progressed = true;

      if (remaining <= 0) {
        break;
      }
    }

    if (!progressed) {
      ensureExtraSemester();
    }
  }

  const exceptions = getSemesterRulePlanCreditExceptions(
    semesters
      .filter((semester) => semester.slot_role !== "li")
      .map(
        (semester): SemesterRulePlan => ({
          semester_number: semester.semester_number,
          semester_type: semester.semester_type,
          is_li: false,
          target_credits: semester.estimated_credits,
          is_credit_exception: false,
          credit_exception_reason: null,
        }),
      )
      .concat(
        semesters
          .filter((semester) => semester.slot_role === "li")
          .map(
            (semester): SemesterRulePlan => ({
              semester_number: semester.semester_number,
              semester_type: "L",
              is_li: true,
              target_credits: semester.estimated_credits,
              is_credit_exception: false,
              credit_exception_reason: null,
            }),
          ),
      ),
    constraints,
  );

  for (const semester of semesters) {
    semester.is_credit_exception = exceptions.some(
      (exception) => exception.semester_number === semester.semester_number,
    );
  }

  return {
    semesters,
    autoAppendedSlots,
  };
};

const buildPreviewBaseSemesters = ({
  resolvedSlots,
  metadata,
}: {
  resolvedSlots: ResolvedSemesterRuleJourneySlot[];
  metadata: ProgramSpecialSemesterMetadata;
}): SemesterRuleJourneyPreviewSemester[] =>
  resolvedSlots.map((slot) => ({
    slot_order: slot.slot_order,
    semester_number: slot.semester_number,
    semester_type: slot.semester_type,
    slot_role: slot.slot_role,
    estimated_credits:
      metadata.roleCredits[slot.slot_role] && slot.slot_role !== "regular"
        ? metadata.roleCredits[slot.slot_role]
        : 0,
    is_credit_exception: false,
  }));

const buildSemesterRuleJourneyExceptionWindowSuggestions = ({
  rule,
  resolvedSlots,
  metadata,
  constraints,
  lifecyclePattern,
  existingWindows,
}: {
  rule: SemesterEntryBand;
  resolvedSlots: ResolvedSemesterRuleJourneySlot[];
  metadata: ProgramSpecialSemesterMetadata;
  constraints: ProgramSemesterPlanConstraints;
  lifecyclePattern: IntakeLifecyclePattern;
  existingWindows?: SemesterRuleExceptionWindow[];
}) => {
  const exactWindows: SemesterRuleExceptionWindow[] = [];
  const ruleTransferMin = Math.max(Number(rule.transfer_min) || 0, 0);
  const ruleTransferMax = Math.max(Number(rule.transfer_max) || ruleTransferMin, ruleTransferMin);
  const normalizedExistingWindows = normalizeAndSortExactWindows(
    existingWindows || [],
  );
  const standardBoundsBySlot = new Map(
    resolvedSlots.map((slot) => [
      slot.slot_order,
      slot.slot_role === "li"
        ? null
        : getSlotBounds(slot.semester_type, constraints),
    ]),
  );
  const baseSpecialCredits = buildPreviewBaseSemesters({
    resolvedSlots,
    metadata,
  }).reduce((sum, semester) => sum + semester.estimated_credits, 0);

  for (
    let transferredCredits = ruleTransferMin;
    transferredCredits <= ruleTransferMax;
    transferredCredits++
  ) {
    const preview = distributePreviewCredits({
      baseSemesters: buildPreviewBaseSemesters({
        resolvedSlots,
        metadata,
      }),
      remainingCredits: Math.max(
        Number(constraints.total_credit_required) - transferredCredits - baseSpecialCredits,
        0,
      ),
      constraints,
      lifecyclePattern,
      startingSemester: Number(rule.entry_semester),
      exceptionAllowances: new Map(),
      allowSuggestedOverflow: true,
    });

    if (preview.autoAppendedSlots > 0) {
      continue;
    }

    for (const semester of preview.semesters) {
      const standardBounds = standardBoundsBySlot.get(semester.slot_order);
      if (!standardBounds) {
        continue;
      }

      const allowedOverload = Math.max(
        semester.estimated_credits - standardBounds.max,
        0,
      );
      const allowedUnderload = Math.max(
        standardBounds.min - semester.estimated_credits,
        0,
      );

      if (allowedOverload <= 0 && allowedUnderload <= 0) {
        continue;
      }

      exactWindows.push({
        slot_order: semester.slot_order,
        transfer_min: transferredCredits,
        transfer_max: transferredCredits,
        allowed_overload_credits: allowedOverload,
        allowed_underload_credits: allowedUnderload,
        default_reason: "Suggested from configured band journey.",
      });
    }
  }

  const uncoveredExactWindows = exactWindows.filter((window) => {
    return !normalizedExistingWindows.some(
      (existingWindow) =>
        existingWindow.slot_order === window.slot_order &&
        window.transfer_min >= existingWindow.transfer_min &&
        window.transfer_max <= existingWindow.transfer_max &&
        existingWindow.allowed_overload_credits >=
          window.allowed_overload_credits &&
        existingWindow.allowed_underload_credits >=
          window.allowed_underload_credits,
    );
  });

  return groupExactCreditExceptionWindows(uncoveredExactWindows);
};

interface PlannerTransferProfileSample {
  student_id: number;
  matric_no: string;
  transferred_credits: number;
  transferred_course_ids: number[];
}

const PLANNER_BACKED_SUGGESTION_REASON =
  "Suggested from planner-backed simulation of matching transfer profiles.";

const getPlannerTransferProfileSamples = async ({
  programId,
  entrySemester,
  transferMin,
  transferMax,
  validCourseIds,
  executor = pool,
}: {
  programId: number;
  entrySemester: number;
  transferMin: number;
  transferMax: number;
  validCourseIds: Set<number>;
  executor?: QueryExecutor;
}) => {
  const [rows] = await executor.query(
    `SELECT s.id AS student_id,
            s.matric_no,
            s.total_credit_transferred,
            stc.course_id
     FROM students s
     LEFT JOIN student_transferred_courses stc ON stc.student_id = s.id
     WHERE s.program_id = ?
       AND COALESCE(
         s.final_entry_semester,
         s.system_assigned_entry_semester,
         s.starting_semester
       ) = ?
       AND s.total_credit_transferred BETWEEN ? AND ?
     ORDER BY s.total_credit_transferred ASC, s.id ASC, stc.course_id ASC`,
    [programId, entrySemester, transferMin, transferMax],
  );

  const profilesByStudent = new Map<number, PlannerTransferProfileSample>();

  for (const row of rows as any[]) {
    const studentId = Number(row.student_id) || 0;
    if (studentId <= 0) {
      continue;
    }

    if (!profilesByStudent.has(studentId)) {
      profilesByStudent.set(studentId, {
        student_id: studentId,
        matric_no: String(row.matric_no || `student-${studentId}`),
        transferred_credits: Math.max(
          Number(row.total_credit_transferred) || 0,
          0,
        ),
        transferred_course_ids: [],
      });
    }

    const courseId = Number(row.course_id) || 0;
    if (courseId > 0 && validCourseIds.has(courseId)) {
      profilesByStudent.get(studentId)!.transferred_course_ids.push(courseId);
    }
  }

  const profilesByCredits = new Map<number, PlannerTransferProfileSample[]>();

  for (const profile of profilesByStudent.values()) {
    const normalizedCourseIds = Array.from(
      new Set(profile.transferred_course_ids),
    ).sort((left, right) => left - right);

    if (
      profile.transferred_credits > 0 &&
      normalizedCourseIds.length === 0
    ) {
      continue;
    }

    const existingProfiles =
      profilesByCredits.get(profile.transferred_credits) || [];
    const signature = normalizedCourseIds.join(",");
    if (
      existingProfiles.some(
        (existing) =>
          existing.transferred_course_ids.join(",") === signature,
      )
    ) {
      continue;
    }

    profilesByCredits.set(profile.transferred_credits, [
      ...existingProfiles,
      {
        ...profile,
        transferred_course_ids: normalizedCourseIds,
      },
    ]);
  }

  return profilesByCredits;
};

const buildExactWindowCoverageKey = ({
  slotOrder,
  transferredCredits,
}: {
  slotOrder: number;
  transferredCredits: number;
}) => `${slotOrder}:${transferredCredits}`;

type PlannerSimulationSpecialRole = "fyp1" | "fyp2" | "li";

const buildPlannerSimulationSpecialRoleMap = (
  courses: Array<{
    course_id: number;
    course_type: string;
    semester: number;
  }>,
) => {
  const roleByCourseId = new Map<number, PlannerSimulationSpecialRole>();

  for (const course of courses) {
    if (course.course_type === "Industrial Training") {
      roleByCourseId.set(course.course_id, "li");
    }
  }

  const fypSemesters = Array.from(
    new Set(
      courses
        .filter((course) => course.course_type === "Final Year Project")
        .map((course) => Number(course.semester))
        .filter((semester) => Number.isInteger(semester) && semester > 0),
    ),
  ).sort((left, right) => left - right);

  const fyp1Semester = fypSemesters[0] ?? null;
  const fyp2Semesters = fypSemesters.slice(1);

  for (const course of courses) {
    if (course.course_type !== "Final Year Project") {
      continue;
    }

    if (fyp1Semester != null && Number(course.semester) === fyp1Semester) {
      roleByCourseId.set(course.course_id, "fyp1");
      continue;
    }

    if (fyp2Semesters.includes(Number(course.semester))) {
      roleByCourseId.set(course.course_id, "fyp2");
    }
  }

  return roleByCourseId;
};

const buildPlannerBackedExceptionWindowSuggestions = async ({
  rule,
  programId,
  sessionId,
  resolvedSlots,
  metadata,
  constraints,
  lifecyclePattern,
  existingWindows,
  executor = pool,
}: {
  rule: SemesterEntryBand;
  programId: number;
  sessionId?: number | null;
  resolvedSlots: ResolvedSemesterRuleJourneySlot[];
  metadata: ProgramSpecialSemesterMetadata;
  constraints: ProgramSemesterPlanConstraints;
  lifecyclePattern: IntakeLifecyclePattern;
  existingWindows?: SemesterRuleExceptionWindow[];
  executor?: QueryExecutor;
}) => {
  const targetSessionId =
    sessionId ?? (await getLatestProgramStructureSessionId(programId, executor));

  if (!targetSessionId || resolvedSlots.length === 0) {
    return [];
  }

  const plannerMetadata =
    sessionId && sessionId === targetSessionId
      ? metadata
      : await getProgramSpecialSemesterMetadata({
          sessionId: targetSessionId,
          entrySemester: Number(rule.entry_semester),
          executor,
        });

  const programCourses = await getProgramStructureCourses({
    sessionId: targetSessionId,
    executor,
  });
  if (programCourses.length === 0) {
    return [];
  }

  const validCourseIds = new Set(
    programCourses.map((course) => Number(course.course_id)).filter((id) => id > 0),
  );
  const transferProfilesByCredits = await getPlannerTransferProfileSamples({
    programId,
    entrySemester: Number(rule.entry_semester),
    transferMin: Math.max(Number(rule.transfer_min) || 0, 0),
    transferMax: Math.max(
      Number(rule.transfer_max) || Number(rule.transfer_min) || 0,
      Math.max(Number(rule.transfer_min) || 0, 0),
    ),
    validCourseIds,
    executor,
  });

  if (transferProfilesByCredits.size === 0) {
    return [];
  }

  const { planAcademicPlanForStudent } = await import(
    "~~/server/utils/academic-plan-planner"
  );
  const baseTimelineMaxSemester = Math.max(
    ...resolvedSlots.map((slot) => Number(slot.semester_number) || 0),
    Number(rule.entry_semester) - 1,
  );
  const creditLimits = {
    long_min: Number(constraints.long_min) || 12,
    long_max: Number(constraints.long_max) || 20,
    short_min: Number(constraints.short_min) || 6,
    short_max: Number(constraints.short_max) || 10,
  };
  const specialRoleByCourseId =
    buildPlannerSimulationSpecialRoleMap(programCourses);
  const courseById = new Map(
    programCourses.map((course) => [Number(course.course_id), course] as const),
  );
  const collectedWindows = new Map<string, SemesterRuleExceptionWindow>();
  const normalizedExistingWindows = normalizeAndSortExactWindows(
    existingWindows || [],
  );

  const runPlannerSimulation = async ({
    transferredCredits,
    transferredCourseIds,
    windows,
  }: {
    transferredCredits: number;
    transferredCourseIds: number[];
    windows: SemesterRuleExceptionWindow[];
  }) => {
    const exactPreview = buildSemesterRuleJourneyPreviewForTransferredCredits({
      resolvedSlots,
      metadata: plannerMetadata,
      constraints,
      lifecyclePattern,
      exceptionWindows: windows,
      entrySemester: Number(rule.entry_semester),
      transferredCredits,
    });

    const planned = await planAcademicPlanForStudent({
      student: {
        student_id: 0,
        matric_no: `rule-suggestion-${transferredCredits}`,
        starting_semester: Number(rule.entry_semester),
        total_credit_transferred: transferredCredits,
        transferred_course_ids: new Set(transferredCourseIds),
      },
      programId,
      sessionId: targetSessionId,
      intakeType: rule.intake_type,
      programCourses,
      lifecyclePattern,
      creditLimits,
      executor,
      resolvedJourneyOverride: {
        journey_slots: resolvedSlots,
        exception_windows: windows,
        exact_preview: exactPreview,
      },
    });

    const highestSemester = Math.max(
      ...planned.semesterConfigs.map(
        (config) => Number(config.semester_number) || 0,
      ),
      Number(rule.entry_semester) - 1,
    );
    const extraSemesterConfigs = planned.semesterConfigs.filter(
      (config) => Number(config.semester_number) > baseTimelineMaxSemester,
    );

    return {
      courseAssignments: planned.courseAssignments,
      semesterConfigs: planned.semesterConfigs,
      highestSemester,
      extraSemesterCount: extraSemesterConfigs.length,
      extraSemesterCredits: extraSemesterConfigs.reduce(
        (sum, config) => sum + (Number(config.target_credits) || 0),
        0,
      ),
    };
  };

  for (const [
    transferredCredits,
    transferredProfiles,
  ] of transferProfilesByCredits.entries()) {
    for (const profile of transferredProfiles) {
      const simulatedWindows = normalizeAndSortExactWindows(existingWindows || []);
      const currentResult = await runPlannerSimulation({
        transferredCredits,
        transferredCourseIds: profile.transferred_course_ids,
        windows: simulatedWindows,
      });
      if (currentResult.highestSemester <= baseTimelineMaxSemester) {
        continue;
      }

      const currentAllowances = getApplicableSemesterRuleExceptionAllowances({
        windows: simulatedWindows,
        transferredCredits,
      });
      const creditsUsedBySemester = new Map<number, number>();
      for (const config of currentResult.semesterConfigs) {
        creditsUsedBySemester.set(
          Number(config.semester_number),
          Number(config.target_credits) || 0,
        );
      }
      const prereqMap = new Map<number, number>();
      for (const course of programCourses) {
        if (course.prerequisite_course_id) {
          prereqMap.set(
            Number(course.course_id),
            Number(course.prerequisite_course_id),
          );
        }
      }

      const extraAssignments = currentResult.courseAssignments
        .filter(
          (assignment) =>
            assignment.status !== "Transferred" &&
            Number(assignment.semester) > baseTimelineMaxSemester,
        )
        .sort((left, right) => Number(right.semester) - Number(left.semester));

      for (const assignment of extraAssignments) {
        const course = courseById.get(Number(assignment.course_id));
        if (!course || specialRoleByCourseId.has(Number(course.course_id))) {
          continue;
        }

        const prereqSatisfiedBySemester = (semesterNumber: number) => {
          const prereqId = prereqMap.get(Number(course.course_id));
          if (!prereqId) {
            return true;
          }

          if (profile.transferred_course_ids.includes(prereqId)) {
            return true;
          }

          return currentResult.courseAssignments.some(
            (candidate) =>
              candidate.status !== "Transferred" &&
              Number(candidate.course_id) === prereqId &&
              Number(candidate.semester) < semesterNumber,
          );
        };

        const breaksDependentOrder = (semesterNumber: number) =>
          currentResult.courseAssignments.some((candidate) => {
            if (
              candidate.status === "Transferred" ||
              Number(candidate.course_id) === Number(course.course_id)
            ) {
              return false;
            }

            const dependentCourse = courseById.get(Number(candidate.course_id));
            return (
              Number(dependentCourse?.prerequisite_course_id) ===
                Number(course.course_id) &&
              Number(candidate.semester) <= semesterNumber
            );
          });

        const bestTargetSlot = resolvedSlots
          .filter(
            (slot) =>
              !slot.is_li &&
              Number(slot.semester_number) >= Number(rule.entry_semester) &&
              Number(slot.semester_number) <= baseTimelineMaxSemester,
          )
          .filter((slot) => {
            const specialRole = specialRoleByCourseId.get(Number(course.course_id));
            if (slot.is_li) {
              return false;
            }

            if (
              (specialRole === "li" || specialRole === "fyp2") &&
              slot.semester_type === "S"
            ) {
              return false;
            }

            return true;
          })
          .filter((slot) =>
            prereqSatisfiedBySemester(Number(slot.semester_number)),
          )
          .filter(
            (slot) => !breaksDependentOrder(Number(slot.semester_number)),
          )
          .map((slot) => {
            const usedCredits =
              creditsUsedBySemester.get(Number(slot.semester_number)) || 0;
            const baseMax =
              slot.semester_type === "L"
                ? creditLimits.long_max
                : creditLimits.short_max;
            const requiredOverload = Math.max(
              usedCredits + (Number(course.credit_hour) || 0) - baseMax,
              0,
            );

            return {
              slot,
              requiredOverload,
              currentOverload:
                currentAllowances.get(Number(slot.slot_order))
                  ?.allowed_overload_credits || 0,
              preferredGap: Math.abs(
                Number(slot.semester_number) - (Number(course.semester) || 0),
              ),
            };
          })
          .filter(
            (candidate) =>
              candidate.requiredOverload > candidate.currentOverload,
          )
          .sort((left, right) => {
            if (left.requiredOverload !== right.requiredOverload) {
              return left.requiredOverload - right.requiredOverload;
            }

            if (left.slot.semester_number !== right.slot.semester_number) {
              return right.slot.semester_number - left.slot.semester_number;
            }

            return left.preferredGap - right.preferredGap;
          })[0];

        if (!bestTargetSlot) {
          continue;
        }

        const candidateWindow: SemesterRuleExceptionWindow = {
          slot_order: Number(bestTargetSlot.slot.slot_order),
          transfer_min: transferredCredits,
          transfer_max: transferredCredits,
          allowed_overload_credits: bestTargetSlot.requiredOverload,
          allowed_underload_credits:
            currentAllowances.get(Number(bestTargetSlot.slot.slot_order))
              ?.allowed_underload_credits || 0,
          default_reason: PLANNER_BACKED_SUGGESTION_REASON,
        };
        const windowKey = buildExactWindowCoverageKey({
          slotOrder: candidateWindow.slot_order,
          transferredCredits,
        });
        const previousWindow = collectedWindows.get(windowKey);
        if (
          !previousWindow ||
          previousWindow.allowed_overload_credits <
            candidateWindow.allowed_overload_credits ||
          previousWindow.allowed_underload_credits <
            candidateWindow.allowed_underload_credits
        ) {
          collectedWindows.set(windowKey, candidateWindow);
        }
      }
    }
  }

  const uncoveredWindows = Array.from(collectedWindows.values()).filter(
    (window) =>
      !normalizedExistingWindows.some(
        (existingWindow) =>
          existingWindow.slot_order === window.slot_order &&
          window.transfer_min >= existingWindow.transfer_min &&
          window.transfer_max <= existingWindow.transfer_max &&
          existingWindow.allowed_overload_credits >=
            window.allowed_overload_credits &&
          existingWindow.allowed_underload_credits >=
            window.allowed_underload_credits,
      ),
  );

  return groupExactCreditExceptionWindows(uncoveredWindows);
};

const buildSemesterRuleJourneyPreviewForTransferredCredits = ({
  resolvedSlots,
  metadata,
  constraints,
  lifecyclePattern,
  exceptionWindows,
  entrySemester,
  transferredCredits,
}: {
  resolvedSlots: ResolvedSemesterRuleJourneySlot[];
  metadata: ProgramSpecialSemesterMetadata;
  constraints: ProgramSemesterPlanConstraints;
  lifecyclePattern: IntakeLifecyclePattern;
  exceptionWindows?: SemesterRuleExceptionWindow[];
  entrySemester: number;
  transferredCredits: number;
}): SemesterRuleJourneyExactPreview => {
  const normalizedTransferredCredits = Math.max(
    Number(transferredCredits) || 0,
    0,
  );
  const baseSemesters = buildPreviewBaseSemesters({
    resolvedSlots,
    metadata,
  });
  const baseSpecialCredits = baseSemesters.reduce(
    (sum, semester) => sum + semester.estimated_credits,
    0,
  );
  const remainingTotalCredits = Math.max(
    Number(constraints.total_credit_required) - normalizedTransferredCredits,
    0,
  );
  const distributableCredits = Math.max(
    remainingTotalCredits - baseSpecialCredits,
    0,
  );
  const distributedPreview = distributePreviewCredits({
    baseSemesters,
    remainingCredits: distributableCredits,
    constraints,
    lifecyclePattern,
    startingSemester: entrySemester,
    exceptionAllowances: getApplicableSemesterRuleExceptionAllowances({
      windows: exceptionWindows || [],
      transferredCredits: normalizedTransferredCredits,
    }),
  });

  return {
    transferred_credits: normalizedTransferredCredits,
    estimated_remaining_credits: remainingTotalCredits,
    auto_appended_slots: distributedPreview.autoAppendedSlots,
    semesters: distributedPreview.semesters,
  };
};

export const buildSemesterRuleJourneyPreviewScenarios = async ({
  rule,
  slots,
  exceptionWindows,
  programId,
  sessionId,
  executor = pool,
}: {
  rule: SemesterEntryBand;
  slots: SemesterRuleJourneySlot[];
  exceptionWindows?: SemesterRuleExceptionWindow[];
  programId: number;
  sessionId?: number | null;
  executor?: QueryExecutor;
}): Promise<SemesterRuleJourneyPreviewScenario[]> => {
  const constraints = await getProgramSemesterPlanConstraints(programId, executor);
  const resolvedSlots = toResolvedJourneySlots({
    entrySemester: Number(rule.entry_semester),
    slots,
  });

  if (!constraints || resolvedSlots.length === 0) {
    return [];
  }

  const metadata = await getPreviewMetadataForJourney({
    resolvedSlots,
    sessionId,
    entrySemester: Number(rule.entry_semester),
    executor,
  });
  const lifecyclePattern = (
    await resolveIntakeLifecyclePattern({
      programId,
      intakeType: rule.intake_type,
      executor,
    })
  ).lifecycle_pattern;
  const scenarios = getScenarioCredits(rule);

  return scenarios.map((scenario) => ({
    label: scenario.label,
    ...buildSemesterRuleJourneyPreviewForTransferredCredits({
      resolvedSlots,
      metadata,
      constraints,
      lifecyclePattern,
      exceptionWindows,
      entrySemester: Number(rule.entry_semester),
      transferredCredits: scenario.transferred_credits,
    }),
  }));
};

export const getJourneySlotRoleRequirements = async ({
  programId,
  entrySemester,
  sessionId,
  executor = pool,
}: {
  programId: number;
  entrySemester: number;
  sessionId?: number | null;
  executor?: QueryExecutor;
}) => {
  const targetSessionId =
    sessionId ?? (await getLatestProgramStructureSessionId(programId, executor));

  if (!targetSessionId) {
    return {
      required_roles: [] as SemesterRuleJourneySlotRole[],
      max_semester: entrySemester,
    };
  }

  const metadata = await getProgramSpecialSemesterMetadata({
    sessionId: targetSessionId,
    entrySemester,
    executor,
  });

  return {
    required_roles: metadata.requiredRoles,
    max_semester: metadata.maxSemester,
  };
};

export const resolveSemesterRuleJourney = async ({
  programId,
  intakeType,
  entrySemester,
  transferredCredits,
  ruleId,
  sessionId,
  executor = pool,
}: {
  programId: number;
  intakeType?: string | null;
  entrySemester: number;
  transferredCredits?: number | null;
  ruleId?: number | null;
  sessionId?: number | null;
  executor?: QueryExecutor;
}): Promise<ResolvedSemesterRuleJourneyPlanSet> => {
  if (!intakeType) {
    return {
      rule: null,
      intake_lifecycle_pattern: ["L", "L", "S"],
      intake_lifecycle_source: "default",
      journey_slots: [],
      exception_windows: [],
      exception_window_suggestions: [],
      explanation: null,
      exact_preview: null,
      preview_scenarios: [],
      validation_issues: [],
    };
  }

  const rule = await resolveRuleForJourneyLookup({
    programId,
    intakeType,
    entrySemester,
    transferredCredits,
    ruleId,
    executor,
  });

  if (!rule) {
    return {
      rule: null,
      intake_lifecycle_pattern: ["L", "L", "S"],
      intake_lifecycle_source: "default",
      journey_slots: [],
      exception_windows: [],
      exception_window_suggestions: [],
      explanation: null,
      exact_preview: null,
      preview_scenarios: [],
      validation_issues: [],
    };
  }

  const lifecycleConfig = await resolveIntakeLifecyclePattern({
    programId,
    intakeType: rule.intake_type,
    executor,
  });
  const lifecyclePattern = lifecycleConfig.lifecycle_pattern;

  const slots = await ensureSemesterRuleJourneySlotsSeeded({
    rule,
    programId,
    executor,
  });
  const exceptionWindows = await getSemesterRuleExceptionWindows({
    ruleId: rule.id,
    executor,
  });
  const validation = await validateSemesterRuleJourneySlots({
    slots,
    entrySemester: Number(rule.entry_semester),
  });
  const exceptionWindowValidation = validateSemesterRuleExceptionWindows({
    windows: exceptionWindows,
    bandTransferMin: Number(rule.transfer_min),
    bandTransferMax: Number(rule.transfer_max),
    slotCount: slots.length,
    slotRolesByOrder: new Map(
      slots.map((slot) => [slot.slot_order, slot.slot_role]),
    ),
  });
  const explanation =
    transferredCredits != null
      ? `${intakeType} + ${Math.max(Number(transferredCredits) || 0, 0)} transferred credits matched Semester ${rule.entry_semester} band (${getCoverageRangeLabel(rule)}), using the intake lifecycle ${formatIntakeLifecyclePattern(lifecyclePattern)} and the configured journey: ${getJourneySummaryText(slots, Number(rule.entry_semester))}.`
      : `Semester ${rule.entry_semester} band (${getCoverageRangeLabel(rule)}) uses the intake lifecycle ${formatIntakeLifecyclePattern(lifecyclePattern)} and the configured journey: ${getJourneySummaryText(slots, Number(rule.entry_semester))}.`;

  const previewConstraints = await getProgramSemesterPlanConstraints(
    programId,
    executor,
  );
  const resolvedSlots = toResolvedJourneySlots({
    entrySemester: Number(rule.entry_semester),
    slots,
  });
  const previewMetadata = await getPreviewMetadataForJourney({
    resolvedSlots,
    sessionId,
    entrySemester: Number(rule.entry_semester),
    executor,
  });
  const previewExceptionWindowSuggestions =
    previewConstraints && resolvedSlots.length > 0
      ? buildSemesterRuleJourneyExceptionWindowSuggestions({
          rule,
          resolvedSlots,
          metadata: previewMetadata,
          constraints: previewConstraints,
          lifecyclePattern,
          existingWindows: exceptionWindows,
        })
      : [];
  const plannerBackedExceptionWindowSuggestions =
    previewConstraints && resolvedSlots.length > 0
      ? await buildPlannerBackedExceptionWindowSuggestions({
          rule,
          programId,
          sessionId,
          resolvedSlots,
          metadata: previewMetadata,
          constraints: previewConstraints,
          lifecyclePattern,
          existingWindows: exceptionWindows,
          executor,
        })
      : [];
  const exceptionWindowSuggestions = groupExactCreditExceptionWindows([
    ...previewExceptionWindowSuggestions,
    ...plannerBackedExceptionWindowSuggestions,
  ]);
  const exactPreview =
    previewConstraints &&
    resolvedSlots.length > 0 &&
    transferredCredits != null
      ? buildSemesterRuleJourneyPreviewForTransferredCredits({
          resolvedSlots,
          metadata: previewMetadata,
          constraints: previewConstraints,
          lifecyclePattern,
          exceptionWindows,
          entrySemester: Number(rule.entry_semester),
          transferredCredits: Number(transferredCredits),
        })
      : null;

  const previewScenarios = await buildSemesterRuleJourneyPreviewScenarios({
    rule,
    slots,
    exceptionWindows,
    programId,
    sessionId,
    executor,
  });

  return {
    rule,
    intake_lifecycle_pattern: lifecyclePattern,
    intake_lifecycle_source: lifecycleConfig.source,
    journey_slots: resolvedSlots,
    exception_windows: exceptionWindows,
    exception_window_suggestions: exceptionWindowSuggestions,
    explanation,
    exact_preview: exactPreview,
    preview_scenarios: previewScenarios,
    validation_issues: [
      ...validation.issues,
      ...exceptionWindowValidation.issues,
    ] as ResolvedSemesterRuleJourneyPlanSet["validation_issues"],
  };
};

export const getJourneySummaryLabel = ({
  slots,
  entrySemester,
}: {
  slots: SemesterRuleJourneySlot[];
  entrySemester: number;
}) => getJourneySummaryText(slots, entrySemester);
