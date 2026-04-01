import { pool } from "~~/server/utils/db";

export interface SemesterRulePlan {
  semester_number: number;
  semester_type: "L" | "S";
  is_li: boolean;
  target_credits: number;
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

export const normalizeSemesterRulePlan = (
  plan: SemesterRulePlan,
): SemesterRulePlan => {
  if (!plan.is_li) {
    return plan;
  }

  return {
    ...plan,
    semester_type: "L",
  };
};

export const normalizeSemesterRulePlans = (
  plans: SemesterRulePlan[],
): SemesterRulePlan[] => plans.map((plan) => normalizeSemesterRulePlan(plan));

type QueryExecutor = {
  query: (sql: string, values?: any) => Promise<any>;
};

const SEMESTER_ONE_BACKFILL_VERSION =
  "semester-1-lifecycle-li-last-long-credit-limits-v3";

let ensureBackfillTablePromise: Promise<void> | null = null;

export const getIntakeLifecyclePattern = (
  intakeType?: string | null,
): ("L" | "S")[] => {
  const rawIntake = intakeType?.toLowerCase() || "";

  if (rawIntake.includes("may")) {
    return ["S", "L", "L"];
  }

  if (rawIntake.includes("aug")) {
    return ["L", "L", "S"];
  }

  if (rawIntake.includes("dec")) {
    return ["L", "S", "L"];
  }

  return ["L", "L", "S"];
};

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
) => {
  if (semesterType === "L") {
    return {
      min: constraints.long_min,
      max: constraints.long_max,
    };
  }

  return {
    min: constraints.short_min,
    max: constraints.short_max,
  };
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
  const semesterErrors: string[] = [];

  for (const plan of plans) {
    const bounds = getSemesterCreditBounds(plan.semester_type, constraints);
    const label =
      plan.semester_type === "L" ? "Long Semester" : "Short Semester";

    if (plan.target_credits < bounds.min || plan.target_credits > bounds.max) {
      semesterErrors.push(
        `Semester ${plan.semester_number} must stay within ${label} credit limits (${bounds.min}-${bounds.max}).`,
      );
    }
  }

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

  const cyclePattern = getIntakeLifecyclePattern(intakeType);
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
      semester_type: cyclePattern[(semesterNumber - 1) % 3],
      is_li: false,
      target_credits: Number(row.regular_credits) || 0,
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
    : plans;
};

export const replaceSemesterCreditPlans = async (
  ruleId: number,
  plans: SemesterRulePlan[],
  executor: QueryExecutor = pool,
) => {
  const normalizedPlans = normalizeSemesterRulePlans(plans);

  await executor.query(`DELETE FROM semester_credit_plans WHERE rule_id = ?`, [
    ruleId,
  ]);

  if (normalizedPlans.length === 0) {
    return;
  }

  const values = normalizedPlans.map((plan) => [
    ruleId,
    plan.semester_number,
    plan.semester_type,
    plan.is_li ? 1 : 0,
    plan.target_credits,
  ]);

  await executor.query(
    `INSERT INTO semester_credit_plans (
      rule_id,
      semester_number,
      semester_type,
      is_li,
      target_credits
    ) VALUES ?`,
    [values],
  );
};

export const seedSemesterOneRulePlans = async (
  ruleId: number,
  programId: number,
  intakeType: string,
  executor: QueryExecutor = pool,
) => {
  const latestSessionId = await getLatestProgramStructureSessionId(
    programId,
    executor,
  );

  if (!latestSessionId) {
    return [];
  }

  const plans = await buildSemesterRulePlansForSession(
    latestSessionId,
    intakeType,
    executor,
  );

  await replaceSemesterCreditPlans(ruleId, plans, executor);

  return plans;
};

export const ensureBaseRuleForIntake = async (
  programId: number,
  intakeType: string,
  executor: QueryExecutor = pool,
) => {
  const [baseRuleRows] = await executor.query(
    `SELECT id
     FROM semester_entry_rules
     WHERE program_id = ?
       AND intake_type = ?
       AND credit_transfer = 0
       AND entry_semester = 1
     ORDER BY id ASC
     LIMIT 1`,
    [programId, intakeType],
  );

  if ((baseRuleRows as any[]).length > 0) {
    return {
      ruleId: Number((baseRuleRows as any[])[0].id),
      created: false,
    };
  }

  const [baseResult] = await executor.query(
    `INSERT INTO semester_entry_rules (program_id, intake_type, credit_transfer, entry_semester)
     VALUES (?, ?, 0, 1)`,
    [programId, intakeType],
  );

  const ruleId = Number((baseResult as any).insertId);
  await seedSemesterOneRulePlans(ruleId, programId, intakeType, executor);

  return {
    ruleId,
    created: true,
  };
};

export const getStoredSemesterRulePlans = async (
  programId: number,
  intakeType: string,
  entrySemester: number,
  executor: QueryExecutor = pool,
): Promise<SemesterRulePlan[]> => {
  const [ruleRows] = await executor.query(
    `SELECT id
     FROM semester_entry_rules
     WHERE program_id = ?
       AND intake_type = ?
       AND entry_semester = ?
     ORDER BY credit_transfer ASC, id ASC
     LIMIT 1`,
    [programId, intakeType, entrySemester],
  );

  if ((ruleRows as any[]).length === 0) {
    return [];
  }

  const [planRows] = await executor.query(
    `SELECT semester_number, semester_type, is_li, target_credits
     FROM semester_credit_plans
     WHERE rule_id = ?
     ORDER BY semester_number ASC`,
    [Number((ruleRows as any[])[0].id)],
  );

  return normalizeSemesterRulePlans(
    (planRows as any[]).map((row) => ({
      semester_number: Number(row.semester_number),
      semester_type: row.semester_type as "L" | "S",
      is_li: !!row.is_li,
      target_credits: Number(row.target_credits) || 0,
    })),
  );
};

export const getEffectiveSemesterRulePlans = async ({
  programId,
  intakeType,
  entrySemester,
  sessionId,
  executor = pool,
}: {
  programId: number;
  intakeType?: string | null;
  entrySemester: number;
  sessionId?: number | null;
  executor?: QueryExecutor;
}) => {
  if (!intakeType) {
    return [];
  }

  if (entrySemester === 1 && sessionId) {
    return buildSemesterRulePlansForSession(sessionId, intakeType, executor);
  }

  const storedPlans = await getStoredSemesterRulePlans(
    programId,
    intakeType,
    entrySemester,
    executor,
  );

  if (storedPlans.length > 0) {
    return storedPlans;
  }

  return [];
};

export const getSemesterRuleMetaForSemester = async ({
  programId,
  intakeType,
  entrySemester,
  sessionId,
  semester,
  executor = pool,
}: {
  programId: number;
  intakeType?: string | null;
  entrySemester: number;
  sessionId?: number | null;
  semester: number;
  executor?: QueryExecutor;
}) => {
  const plans = await getEffectiveSemesterRulePlans({
    programId,
    intakeType,
    entrySemester,
    sessionId,
    executor,
  });

  return (
    plans.find((plan) => plan.semester_number === semester) || null
  );
};

const ensureSemesterRuleBackfillTable = async () => {
  if (!ensureBackfillTablePromise) {
    ensureBackfillTablePromise = pool
      .query(`
        CREATE TABLE IF NOT EXISTS semester_rule_plan_backfills (
          program_id INT NOT NULL,
          version VARCHAR(100) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

          PRIMARY KEY (program_id, version),
          CONSTRAINT fk_srpb_program
            FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
      .then(() => undefined)
      .catch((error) => {
        ensureBackfillTablePromise = null;
        throw error;
      });
  }

  await ensureBackfillTablePromise;
};

export const backfillSemesterOneRulePlansForProgram = async (
  programId: number,
  executor: QueryExecutor = pool,
) => {
  const [ruleRows] = await executor.query(
    `SELECT id, intake_type
     FROM semester_entry_rules
     WHERE program_id = ? AND entry_semester = 1
     ORDER BY id ASC`,
    [programId],
  );

  if ((ruleRows as any[]).length === 0) {
    return { updatedRules: 0, eligibleToMark: true };
  }

  const latestSessionId = await getLatestProgramStructureSessionId(
    programId,
    executor,
  );

  if (!latestSessionId) {
    return { updatedRules: 0, eligibleToMark: false };
  }

  const plansByIntakeType = new Map<string, SemesterRulePlan[]>();

  for (const rule of ruleRows as any[]) {
    const intakeType = String(rule.intake_type);

    if (!plansByIntakeType.has(intakeType)) {
      plansByIntakeType.set(
        intakeType,
        await buildSemesterRulePlansForSession(
          latestSessionId,
          intakeType,
          executor,
        ),
      );
    }

    await replaceSemesterCreditPlans(
      Number(rule.id),
      plansByIntakeType.get(intakeType) || [],
      executor,
    );
  }

  return { updatedRules: (ruleRows as any[]).length, eligibleToMark: true };
};

export const ensureSemesterOneRulePlansBackfilled = async (programId: number) => {
  await ensureSemesterRuleBackfillTable();

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [backfillRows] = await connection.query(
      `SELECT 1
       FROM semester_rule_plan_backfills
       WHERE program_id = ? AND version = ?
       LIMIT 1`,
      [programId, SEMESTER_ONE_BACKFILL_VERSION],
    );

    if ((backfillRows as any[]).length === 0) {
      const result = await backfillSemesterOneRulePlansForProgram(
        programId,
        connection,
      );

      if (result.eligibleToMark) {
        await connection.query(
          `INSERT IGNORE INTO semester_rule_plan_backfills (program_id, version)
           VALUES (?, ?)`,
          [programId, SEMESTER_ONE_BACKFILL_VERSION],
        );
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
