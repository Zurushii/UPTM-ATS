import {
  resolveSemesterEntryBand,
  type SemesterEntryBand,
} from "~~/server/utils/semester-entry-bands";
import { resolveSemesterRuleJourney } from "~~/server/utils/semester-rule-journeys";

export interface NeedsFixRegenerationAssessment {
  originalReason: string;
  canRetryInAcademicPlanning: boolean;
  requiresTransferredCreditsColumn: boolean;
  requiresTransferredCoursesColumn: boolean;
  blockReason: string | null;
  recoveryGuidance: string | null;
}

export interface RegenerationStudentSnapshot {
  starting_semester: number | null;
  system_assigned_entry_semester?: number | null;
  final_entry_semester?: number | null;
  is_entry_semester_override?: boolean | number | null;
}

export interface ParsedTransferredCreditsResult {
  ok: boolean;
  value: number | null;
  reason: string | null;
}

export interface ResolvedRegenerationEntryInputs {
  transferredCredits: number;
  matchedBand: SemesterEntryBand;
  systemAssignedEntrySemester: number;
  effectiveStartingSemester: number;
  entrySemesterRuleId: number | null;
  entrySemesterAssignmentNote: string;
  isEntrySemesterOverride: boolean;
  finalEntrySemester: number;
}

interface ResolveTransferredCoursesArgs {
  rawValue: unknown;
  courseCodeToId: Map<string, number>;
  courseIdToCreditHour: Map<number, number>;
}

interface ResolvedTransferredCourses {
  normalizedCodes: string[];
  courseIds: Set<number>;
  totalCredits: number;
  unresolvedCodes: string[];
}

interface ValidateTransferredCoursesArgs
  extends ResolveTransferredCoursesArgs {
  hasTransferredCoursesColumn: boolean;
  dbCredits: number;
}

export interface TransferredCoursesValidationResult {
  ok: boolean;
  courseIds: Set<number>;
  totalCredits: number;
  reason: string | null;
}

export const CREDIT_COLUMN_HEADERS = [
  "total_credit_transferred",
  "transferred_credits",
  "credit",
  "credits",
  "total_credit",
  "credit_hours",
];

const RECOVERABLE_NEEDS_FIX_PATTERNS = [
  /invalid course\(s\) not found in system/i,
  /credit mismatch:\s*total_credit_transferred/i,
];

const BLOCKED_NEEDS_FIX_PATTERNS = [/invalid credit value/i];

export const assessNeedsFixForAcademicPlanRegeneration = (
  reasonInput: unknown,
): NeedsFixRegenerationAssessment => {
  const originalReason = String(reasonInput || "").trim();

  if (!originalReason) {
    return {
      originalReason: "Needs Fix in Student Entry Assessment",
      canRetryInAcademicPlanning: false,
      requiresTransferredCreditsColumn: false,
      requiresTransferredCoursesColumn: false,
      blockReason:
        "This student still needs Student Entry Assessment before a plan can be regenerated.",
      recoveryGuidance: null,
    };
  }

  if (
    BLOCKED_NEEDS_FIX_PATTERNS.some((pattern) => pattern.test(originalReason))
  ) {
    return {
      originalReason,
      canRetryInAcademicPlanning: true,
      requiresTransferredCreditsColumn: true,
      requiresTransferredCoursesColumn: false,
      blockReason: null,
      recoveryGuidance:
        "Upload a regenerate file with a corrected total_credit_transferred value. If transferred courses are also used, make sure their credit total matches the corrected value.",
    };
  }

  if (
    RECOVERABLE_NEEDS_FIX_PATTERNS.some((pattern) =>
      pattern.test(originalReason),
    )
  ) {
    return {
      originalReason,
      canRetryInAcademicPlanning: true,
      requiresTransferredCreditsColumn: false,
      requiresTransferredCoursesColumn: true,
      blockReason: null,
      recoveryGuidance:
        "Upload a regenerate file with a corrected transferred_courses column. If the transferred courses validate, generation will clear the Needs Fix flag automatically.",
    };
  }

  return {
    originalReason,
    canRetryInAcademicPlanning: false,
    requiresTransferredCreditsColumn: false,
    requiresTransferredCoursesColumn: false,
    blockReason: `${originalReason} This issue still needs Student Entry Assessment before regenerating.`,
    recoveryGuidance: null,
  };
};

export const parseTransferredCreditsFromExcel = (
  rawValue: unknown,
): ParsedTransferredCreditsResult => {
  if (rawValue == null) {
    return {
      ok: true,
      value: null,
      reason: null,
    };
  }

  const normalized = String(rawValue).trim();
  if (!normalized) {
    return {
      ok: true,
      value: null,
      reason: null,
    };
  }

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return {
      ok: false,
      value: null,
      reason: `Invalid total_credit_transferred value '${normalized}' in the regenerate file.`,
    };
  }

  return {
    ok: true,
    value: Math.trunc(numericValue),
    reason: null,
  };
};

export const resolveAcademicPlanRegenerationEntryInputs = async ({
  programId,
  intakeType,
  sessionId,
  transferredCredits,
  student,
}: {
  programId: number;
  intakeType: string;
  sessionId: number;
  transferredCredits: number;
  student: RegenerationStudentSnapshot;
}): Promise<ResolvedRegenerationEntryInputs | null> => {
  const bandResolution = await resolveSemesterEntryBand({
    programId,
    intakeType,
    transferredCredits,
  });

  if (!bandResolution.band) {
    return null;
  }

  const matchedBand = bandResolution.band;
  const systemAssignedEntrySemester = matchedBand.entry_semester;
  const resolvedJourney = await resolveSemesterRuleJourney({
    programId,
    intakeType,
    entrySemester: systemAssignedEntrySemester,
    transferredCredits,
    sessionId,
    ruleId: matchedBand.id,
  });

  const isEntrySemesterOverride = Boolean(student.is_entry_semester_override);
  const currentFinalEntrySemester =
    Number(
      student.final_entry_semester ??
        student.starting_semester ??
        systemAssignedEntrySemester,
    ) || systemAssignedEntrySemester;

  const effectiveStartingSemester = isEntrySemesterOverride
    ? currentFinalEntrySemester
    : systemAssignedEntrySemester;

  const coverageRange = `${matchedBand.transfer_min}-${matchedBand.transfer_max}`;
  const entrySemesterAssignmentNote =
    resolvedJourney.explanation ||
    `${intakeType} + ${transferredCredits} transferred credits matched Semester ${systemAssignedEntrySemester} band (${coverageRange}) and will follow the configured band journey.`;

  return {
    transferredCredits,
    matchedBand,
    systemAssignedEntrySemester,
    effectiveStartingSemester,
    entrySemesterRuleId:
      matchedBand.is_system_default || Number(matchedBand.id) <= 0
        ? null
        : Number(matchedBand.id),
    entrySemesterAssignmentNote,
    isEntrySemesterOverride,
    finalEntrySemester: isEntrySemesterOverride
      ? currentFinalEntrySemester
      : systemAssignedEntrySemester,
  };
};

const resolveTransferredCoursesValue = ({
  rawValue,
  courseCodeToId,
  courseIdToCreditHour,
}: ResolveTransferredCoursesArgs): ResolvedTransferredCourses => {
  const normalizedCodes = String(rawValue || "")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code.length > 0);

  const courseIds = new Set<number>();
  let totalCredits = 0;
  const unresolvedCodes = new Set<string>();

  for (const code of normalizedCodes) {
    const candidateCodes = code.includes("/")
      ? code
          .split("/")
          .map((candidate) => candidate.trim().toUpperCase())
          .filter((candidate) => candidate.length > 0)
      : [code];

    let resolvedCourseId: number | null = null;

    for (const candidate of candidateCodes) {
      const courseId = courseCodeToId.get(candidate);
      if (courseId) {
        resolvedCourseId = courseId;
        break;
      }
    }

    if (!resolvedCourseId) {
      unresolvedCodes.add(code);
      continue;
    }

    if (!courseIds.has(resolvedCourseId)) {
      courseIds.add(resolvedCourseId);
      totalCredits += courseIdToCreditHour.get(resolvedCourseId) || 0;
    }
  }

  return {
    normalizedCodes,
    courseIds,
    totalCredits,
    unresolvedCodes: Array.from(unresolvedCodes),
  };
};

export const validateTransferredCoursesForAcademicPlanRegeneration = ({
  rawValue,
  hasTransferredCoursesColumn,
  dbCredits,
  courseCodeToId,
  courseIdToCreditHour,
}: ValidateTransferredCoursesArgs): TransferredCoursesValidationResult => {
  if (!hasTransferredCoursesColumn) {
    if (dbCredits > 0) {
      return {
        ok: false,
        courseIds: new Set<number>(),
        totalCredits: 0,
        reason:
          "This regenerate file is missing the transferred_courses column needed to validate transferred credits for this student.",
      };
    }

    return {
      ok: true,
      courseIds: new Set<number>(),
      totalCredits: 0,
      reason: null,
    };
  }

  const resolved = resolveTransferredCoursesValue({
    rawValue,
    courseCodeToId,
    courseIdToCreditHour,
  });

  if (resolved.unresolvedCodes.length > 0) {
    return {
      ok: false,
      courseIds: resolved.courseIds,
      totalCredits: resolved.totalCredits,
      reason: `Transferred course code(s) not found in system: ${resolved.unresolvedCodes.join(", ")}. Correct the regenerate file and try again.`,
    };
  }

  if (
    (resolved.normalizedCodes.length > 0 || dbCredits > 0) &&
    resolved.totalCredits !== dbCredits
  ) {
    return {
      ok: false,
      courseIds: resolved.courseIds,
      totalCredits: resolved.totalCredits,
      reason: `Credit mismatch: total_credit_transferred (${dbCredits}) does not match sum of transferred courses (${resolved.totalCredits}).`,
    };
  }

  return {
    ok: true,
    courseIds: resolved.courseIds,
    totalCredits: resolved.totalCredits,
    reason: null,
  };
};
