import { pool } from "~~/server/utils/db";
import {
  getApplicableSemesterRuleExceptionAllowances,
} from "~~/server/utils/semester-rule-exception-windows";
import { resolveSemesterRuleJourney } from "~~/server/utils/semester-rule-journeys";

type QueryExecutor = {
  query: (sql: string, values?: any) => Promise<any>;
};

export interface EffectiveSemesterRuleAllowance {
  semester_number: number;
  slot_order: number;
  allowed_overload_credits: number;
  allowed_underload_credits: number;
  default_reason: string | null;
}

export const getEffectiveSemesterRuleAllowances = async ({
  programId,
  intakeType,
  entrySemester,
  sessionId,
  transferredCredits,
  ruleId,
  executor = pool,
}: {
  programId: number;
  intakeType?: string | null;
  entrySemester: number;
  sessionId?: number | null;
  transferredCredits?: number | null;
  ruleId?: number | null;
  executor?: QueryExecutor;
}): Promise<EffectiveSemesterRuleAllowance[]> => {
  if (!intakeType) {
    return [];
  }

  const resolvedJourney = await resolveSemesterRuleJourney({
    programId,
    intakeType,
    entrySemester,
    transferredCredits,
    ruleId,
    sessionId,
    executor,
  });

  if (
    resolvedJourney.journey_slots.length === 0 ||
    resolvedJourney.exception_windows.length === 0
  ) {
    return [];
  }

  const applicableAllowances = getApplicableSemesterRuleExceptionAllowances({
    windows: resolvedJourney.exception_windows,
    transferredCredits: Number(transferredCredits) || 0,
  });

  return resolvedJourney.journey_slots
    .map((slot) => {
      const allowance = applicableAllowances.get(slot.slot_order);
      if (!allowance) {
        return null;
      }

      return {
        semester_number: Number(slot.semester_number),
        slot_order: Number(slot.slot_order),
        allowed_overload_credits: allowance.allowed_overload_credits,
        allowed_underload_credits: allowance.allowed_underload_credits,
        default_reason: allowance.default_reason,
      };
    })
    .filter(
      (
        allowance,
      ): allowance is EffectiveSemesterRuleAllowance => allowance !== null,
    );
};

export const getEffectiveSemesterRuleAllowanceMap = async (
  input: {
    programId: number;
    intakeType?: string | null;
    entrySemester: number;
    sessionId?: number | null;
    transferredCredits?: number | null;
    ruleId?: number | null;
    executor?: QueryExecutor;
  },
) =>
  new Map(
    (
      await getEffectiveSemesterRuleAllowances(input)
    ).map((allowance) => [allowance.semester_number, allowance] as const),
  );
