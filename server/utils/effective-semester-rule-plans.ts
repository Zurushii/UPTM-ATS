import { pool } from "~~/server/utils/db";
import { resolveSemesterRuleJourney } from "~~/server/utils/semester-rule-journeys";
import {
  buildSemesterRulePlansForSession,
  type SemesterRulePlan,
} from "~~/server/utils/semester-rule-plans";

type QueryExecutor = {
  query: (sql: string, values?: any) => Promise<any>;
};

const mapJourneySlotsToPlans = (
  journeySlots: Array<{
    semester_number: number;
    semester_type: "L" | "S";
    is_li: boolean;
  }>,
  exactPreview?: {
    semesters: Array<{
      semester_number: number;
      estimated_credits: number;
      is_credit_exception: boolean;
    }>;
  } | null,
): SemesterRulePlan[] => {
  const previewBySemester = new Map(
    (exactPreview?.semesters || []).map((semester) => [
      Number(semester.semester_number),
      {
        estimated_credits: Number(semester.estimated_credits) || 0,
        is_credit_exception: !!semester.is_credit_exception,
      },
    ]),
  );

  return journeySlots
    .map((slot) => {
      const preview = previewBySemester.get(Number(slot.semester_number));

      return {
        semester_number: Number(slot.semester_number),
        semester_type: slot.semester_type,
        is_li: !!slot.is_li,
        target_credits: preview?.estimated_credits || 0,
        is_credit_exception: preview?.is_credit_exception || false,
        credit_exception_reason: null,
      };
    })
    .sort((left, right) => left.semester_number - right.semester_number);
};

export const getEffectiveSemesterRulePlans = async ({
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
}): Promise<SemesterRulePlan[]> => {
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

  if (resolvedJourney.journey_slots.length > 0) {
    return mapJourneySlotsToPlans(
      resolvedJourney.journey_slots,
      resolvedJourney.exact_preview,
    );
  }

  if (!sessionId) {
    return [];
  }

  const defaultPlans = await buildSemesterRulePlansForSession(
    sessionId,
    intakeType,
    executor,
  );

  return defaultPlans.filter(
    (plan) => Number(plan.semester_number) >= Number(entrySemester),
  );
};

export const getSemesterRuleMetaForSemester = async ({
  programId,
  intakeType,
  entrySemester,
  sessionId,
  semester,
  transferredCredits,
  ruleId,
  executor = pool,
}: {
  programId: number;
  intakeType?: string | null;
  entrySemester: number;
  sessionId?: number | null;
  semester: number;
  transferredCredits?: number | null;
  ruleId?: number | null;
  executor?: QueryExecutor;
}) => {
  const effectivePlans = await getEffectiveSemesterRulePlans({
    programId,
    intakeType,
    entrySemester,
    sessionId,
    transferredCredits,
    ruleId,
    executor,
  });

  return (
    effectivePlans.find(
      (plan) => Number(plan.semester_number) === Number(semester),
    ) || null
  );
};
