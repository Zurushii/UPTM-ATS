import { pool } from "~~/server/utils/db";
import {
  getDefaultIntakeLifecyclePattern,
  resolveIntakeLifecyclePattern,
} from "~~/server/utils/intake-lifecycle";

export interface SemesterRulePlan {
  semester_number: number;
  semester_type: "L" | "S";
  is_li: boolean;
  target_credits: number;
  is_credit_exception: boolean;
  credit_exception_reason: string | null;
}

export interface ProgramSemesterPlanConstraints {
  total_credit_required: number | null;
  long_min: number;
  long_max: number;
  short_min: number;
  short_max: number;
}

type SemesterRulePlanLike = Pick<
  SemesterRulePlan,
  "semester_number" | "semester_type"
> & {
  is_li?: boolean;
};

type QueryExecutor = {
  query: (sql: string, values?: any) => Promise<any>;
};

export interface SemesterRulePlanCreditException {
  semester_number: number;
  semester_type: "L" | "S";
  target_credits: number;
  recommended_min: number;
  recommended_max: number;
  exception_type: "under" | "over";
}

export const getJourneyOverflowAllowance = ({
  semesterType,
  slotRole = "regular",
}: {
  semesterType: "L" | "S";
  slotRole?: string | null;
}) => {
  if (slotRole !== "regular") {
    return 0;
  }

  return semesterType === "L" ? 3 : 1;
};

export const normalizeSemesterRulePlan = (
  plan: SemesterRulePlan,
): SemesterRulePlan => {
  const normalizedPlan = {
    ...plan,
    is_credit_exception: !!plan.is_credit_exception,
    credit_exception_reason:
      plan.is_credit_exception && plan.credit_exception_reason
        ? String(plan.credit_exception_reason).trim() || null
        : null,
  };

  if (!plan.is_li) {
    return normalizedPlan;
  }

  return {
    ...normalizedPlan,
    semester_type: "L",
  };
};

export const normalizeSemesterRulePlans = (
  plans: SemesterRulePlan[],
): SemesterRulePlan[] => plans.map((plan) => normalizeSemesterRulePlan(plan));

const sortSemesterRulePlans = (plans: SemesterRulePlan[]) =>
  [...plans].sort((left, right) => {
    if (left.semester_number !== right.semester_number) {
      return left.semester_number - right.semester_number;
    }

    if (left.is_li !== right.is_li) {
      return left.is_li ? 1 : -1;
    }

    return left.semester_type.localeCompare(right.semester_type);
  });

export const getIntakeLifecyclePattern = (
  intakeType?: string | null,
): ("L" | "S")[] => getDefaultIntakeLifecyclePattern(intakeType);

export const getLastLongSemesterNumber = (
  plans: SemesterRulePlanLike[],
): number | null => {
  if (plans.length === 0) {
    return null;
  }

  const candidateSemesters = plans
    .filter((plan) => plan.semester_type === "L" || plan.is_li)
    .map((plan) => Number(plan.semester_number))
    .filter((semesterNumber) => Number.isInteger(semesterNumber) && semesterNumber > 0);

  if (candidateSemesters.length > 0) {
    return Math.max(...candidateSemesters);
  }

  const allSemesters = plans
    .map((plan) => Number(plan.semester_number))
    .filter((semesterNumber) => Number.isInteger(semesterNumber) && semesterNumber > 0);

  return allSemesters.length > 0 ? Math.max(...allSemesters) : null;
};

export const placeLiOnLastLongSemester = (
  plans: SemesterRulePlan[],
  hasLi: boolean = plans.some((plan) => plan.is_li),
): SemesterRulePlan[] => {
  const normalizedPlans = normalizeSemesterRulePlans(plans);

  if (!hasLi || normalizedPlans.length === 0) {
    return normalizedPlans.map((plan) => ({
      ...plan,
      is_li: false,
    }));
  }

  const liSemesterNumber = getLastLongSemesterNumber(normalizedPlans);

  if (!liSemesterNumber) {
    return normalizedPlans;
  }

  return normalizedPlans.map((plan) => ({
    ...plan,
    is_li: plan.semester_number === liSemesterNumber,
    semester_type: plan.semester_number === liSemesterNumber ? "L" : plan.semester_type,
  }));
};

const getSemesterCreditBounds = (
  semesterType: "L" | "S",
  constraints: ProgramSemesterPlanConstraints,
) =>
  semesterType === "L"
    ? {
        min: constraints.long_min,
        max: constraints.long_max,
      }
    : {
        min: constraints.short_min,
        max: constraints.short_max,
      };

const distributeSemesterCredits = (
  plans: SemesterRulePlan[],
  amount: number,
  constraints: ProgramSemesterPlanConstraints,
  direction: "increase" | "decrease",
) => {
  let remaining = amount;

  while (remaining > 0) {
    let updated = false;

    for (const plan of plans) {
      const bounds = getSemesterCreditBounds(plan.semester_type, constraints);
      const canAdjust =
        direction === "increase"
          ? plan.target_credits < bounds.max
          : plan.target_credits > bounds.min;

      if (!canAdjust) {
        continue;
      }

      plan.target_credits += direction === "increase" ? 1 : -1;
      remaining -= 1;
      updated = true;

      if (remaining === 0) {
        break;
      }
    }

    if (!updated) {
      break;
    }
  }

  return remaining;
};

export const rebalanceSemesterRulePlanTargets = (
  plans: SemesterRulePlan[],
  constraints: ProgramSemesterPlanConstraints,
  requiredTotalCredits: number | null = constraints.total_credit_required,
) => {
  const normalizedPlans = placeLiOnLastLongSemester(plans);

  if (normalizedPlans.length === 0) {
    return normalizedPlans;
  }

  const adjustedPlans = normalizedPlans.map((plan) => {
    const bounds = getSemesterCreditBounds(plan.semester_type, constraints);

    return {
      ...plan,
      target_credits: Math.min(
        bounds.max,
        Math.max(bounds.min, Number(plan.target_credits) || 0),
      ),
    };
  });

  if (
    requiredTotalCredits == null ||
    !Number.isFinite(requiredTotalCredits) ||
    requiredTotalCredits <= 0
  ) {
    return adjustedPlans;
  }

  const currentTotal = adjustedPlans.reduce(
    (sum, plan) => sum + plan.target_credits,
    0,
  );

  if (currentTotal === requiredTotalCredits) {
    return adjustedPlans;
  }

  if (currentTotal < requiredTotalCredits) {
    distributeSemesterCredits(
      adjustedPlans,
      requiredTotalCredits - currentTotal,
      constraints,
      "increase",
    );
    return adjustedPlans;
  }

  distributeSemesterCredits(
    adjustedPlans,
    currentTotal - requiredTotalCredits,
    constraints,
    "decrease",
  );

  return adjustedPlans;
};

export const validateSemesterRulePlanTargets = (
  plans: SemesterRulePlan[],
  constraints: ProgramSemesterPlanConstraints,
  requiredTotalCredits: number | null = constraints.total_credit_required,
) => {
  const semesterErrors = getSemesterRulePlanCreditExceptions(
    plans,
    constraints,
  ).map((exception) => {
    const label =
      exception.semester_type === "L" ? "Long Semester" : "Short Semester";
    return `Semester ${exception.semester_number} is outside the recommended ${label} range (${exception.recommended_min}-${exception.recommended_max}).`;
  });

  const totalCredits = plans.reduce((sum, plan) => sum + plan.target_credits, 0);
  const totalError =
    requiredTotalCredits != null &&
    Number.isFinite(requiredTotalCredits) &&
    requiredTotalCredits > 0 &&
    totalCredits !== requiredTotalCredits
      ? `Total plan credits must equal ${requiredTotalCredits} credit hours (currently ${totalCredits}).`
      : null;

  return {
    semesterErrors,
    totalError,
  };
};

export const getSemesterRulePlanCreditExceptions = (
  plans: SemesterRulePlan[],
  constraints: ProgramSemesterPlanConstraints,
): SemesterRulePlanCreditException[] => {
  const exceptions: SemesterRulePlanCreditException[] = [];

  for (const plan of plans) {
    if (plan.is_li) {
      continue;
    }

    const bounds = getSemesterCreditBounds(plan.semester_type, constraints);

    if (plan.target_credits < bounds.min) {
      exceptions.push({
        semester_number: plan.semester_number,
        semester_type: plan.semester_type,
        target_credits: plan.target_credits,
        recommended_min: bounds.min,
        recommended_max: bounds.max,
        exception_type: "under",
      });
      continue;
    }

    if (plan.target_credits > bounds.max) {
      exceptions.push({
        semester_number: plan.semester_number,
        semester_type: plan.semester_type,
        target_credits: plan.target_credits,
        recommended_min: bounds.min,
        recommended_max: bounds.max,
        exception_type: "over",
      });
    }
  }

  return exceptions;
};

export const getProgramSemesterPlanConstraints = async (
  programId: number,
  executor: QueryExecutor = pool,
): Promise<ProgramSemesterPlanConstraints | null> => {
  const [programRows] = await executor.query(
    `SELECT total_credit_required,
            long_sem_min_credit,
            long_sem_max_credit,
            short_sem_min_credit,
            short_sem_max_credit
     FROM programs
     WHERE id = ?
     LIMIT 1`,
    [programId],
  );

  const program = (programRows as any[])[0];

  if (!program) {
    return null;
  }

  return {
    total_credit_required: Number(program.total_credit_required) || 0,
    long_min: Number(program.long_sem_min_credit) || 12,
    long_max: Number(program.long_sem_max_credit) || 20,
    short_min: Number(program.short_sem_min_credit) || 6,
    short_max: Number(program.short_sem_max_credit) || 10,
  };
};

const getSessionSemesterPlanConstraints = async (
  sessionId: number,
  executor: QueryExecutor = pool,
) => {
  const [sessionRows] = await executor.query(
    `SELECT program_id
     FROM program_sessions
     WHERE id = ?
     LIMIT 1`,
    [sessionId],
  );

  const programId = Number((sessionRows as any[])[0]?.program_id);

  if (!programId) {
    return null;
  }

  return getProgramSemesterPlanConstraints(programId, executor);
};

export const getLatestProgramStructureSessionId = async (
  programId: number,
  executor: QueryExecutor = pool,
) => {
  const [sessionRows] = await executor.query(
    `SELECT s.id AS session_id
     FROM program_sessions s
     WHERE s.program_id = ?
       AND EXISTS (
         SELECT 1
         FROM program_courses pc
         WHERE pc.session_id = s.id
       )
     ORDER BY s.id DESC
     LIMIT 1`,
    [programId],
  );

  return (sessionRows as any[])[0]?.session_id
    ? Number((sessionRows as any[])[0].session_id)
    : null;
};

export const buildSemesterRulePlansForSession = async (
  sessionId: number,
  intakeType?: string | null,
  executor: QueryExecutor = pool,
): Promise<SemesterRulePlan[]> => {
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return [];
  }

  const [sessionRows] = await executor.query(
    `SELECT program_id
     FROM program_sessions
     WHERE id = ?
     LIMIT 1`,
    [sessionId],
  );

  const programId = Number((sessionRows as any[])[0]?.program_id);
  const lifecycleConfig = programId
    ? await resolveIntakeLifecyclePattern({
        programId,
        intakeType,
        executor,
      })
    : {
        lifecycle_pattern: getDefaultIntakeLifecyclePattern(intakeType),
      };
  const cyclePattern = lifecycleConfig.lifecycle_pattern;
  const constraints = await getSessionSemesterPlanConstraints(sessionId, executor);

  const [semesterRows] = await executor.query(
    `SELECT combined.semester,
            SUM(CASE WHEN combined.has_li = 1 THEN combined.credit_hour ELSE 0 END) AS li_credits,
            SUM(CASE WHEN combined.has_li = 1 THEN 0 ELSE combined.credit_hour END) AS regular_credits,
            MAX(combined.has_li) AS has_li
     FROM (
       SELECT pc.semester,
              c.credit_hour,
              CASE WHEN pc.course_type = 'Industrial Training' THEN 1 ELSE 0 END AS has_li
       FROM program_courses pc
       JOIN courses c ON pc.course_id = c.id
       WHERE pc.session_id = ? AND pc.course_group IS NULL

       UNION ALL

       SELECT pc.semester,
              MAX(c.credit_hour) AS credit_hour,
              MAX(CASE WHEN pc.course_type = 'Industrial Training' THEN 1 ELSE 0 END) AS has_li
       FROM program_courses pc
       JOIN courses c ON pc.course_id = c.id
       WHERE pc.session_id = ? AND pc.course_group IS NOT NULL
       GROUP BY pc.semester, pc.course_group
     ) combined
     GROUP BY combined.semester
     ORDER BY combined.semester ASC`,
    [sessionId, sessionId],
  );

  const basePlans = (semesterRows as any[]).map((row) => {
    const semesterNumber = Number(row.semester);

    return {
      semester_number: semesterNumber,
      semester_type: cyclePattern[(semesterNumber - 1) % 3] || "L",
      is_li: false,
      target_credits: Number(row.regular_credits) || 0,
      is_credit_exception: false,
      credit_exception_reason: null,
    };
  });

  const totalLiCredits = (semesterRows as any[]).reduce(
    (sum: number, row: any) => sum + (Number(row.li_credits) || 0),
    0,
  );

  if (totalLiCredits <= 0) {
    return constraints
      ? rebalanceSemesterRulePlanTargets(basePlans, constraints)
      : normalizeSemesterRulePlans(basePlans);
  }

  const liSemesterNumber =
    getLastLongSemesterNumber(basePlans) ?? basePlans.at(-1)?.semester_number ?? null;

  if (!liSemesterNumber) {
    return constraints
      ? rebalanceSemesterRulePlanTargets(basePlans, constraints)
      : normalizeSemesterRulePlans(basePlans);
  }

  const plans = placeLiOnLastLongSemester(
    basePlans.map((plan) =>
      plan.semester_number === liSemesterNumber
        ? {
            ...plan,
            target_credits: plan.target_credits + totalLiCredits,
          }
        : plan,
    ),
    true,
  );

  return constraints
    ? rebalanceSemesterRulePlanTargets(plans, constraints)
    : normalizeSemesterRulePlans(plans);
};
