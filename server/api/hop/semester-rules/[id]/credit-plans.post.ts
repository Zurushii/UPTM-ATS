import { pool } from "~~/server/utils/db";
import {
  getProgramSemesterPlanConstraints,
  normalizeSemesterRulePlans,
  placeLiOnLastLongSemester,
  replaceSemesterCreditPlans,
  validateSemesterRulePlanTargets,
} from "~~/server/utils/semester-rule-plans";
import { auth } from "~~/utils/auth";

interface CreditPlanInput {
  semester_number: number;
  semester_type: "L" | "S";
  is_li: boolean;
  target_credits: number;
}

export default defineEventHandler(async (event) => {
  // Authenticate user
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
  }

  // Get the HoP's assigned program
  const [hopRows] = await pool.query(
    `SELECT program_id FROM head_of_programs WHERE user_id = ?`,
    [session.user.id],
  );

  const hopData = hopRows as any[];
  if (hopData.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "HOP profile not found",
    });
  }

  const programId = hopData[0].program_id;

  // Get rule ID from params
  const ruleId = parseInt(getRouterParam(event, "id") || "");
  if (isNaN(ruleId)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid rule ID",
    });
  }

  // Verify rule belongs to this program
  const [ruleRows] = await pool.query(
    `SELECT id, entry_semester FROM semester_entry_rules WHERE id = ? AND program_id = ?`,
    [ruleId, programId],
  );

  if ((ruleRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Rule not found",
    });
  }

  // Parse request body - array of credit plans
  const body = await readBody<{ plans: CreditPlanInput[] }>(event);

  if (!body.plans || !Array.isArray(body.plans)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Plans array is required",
    });
  }

  // Validate plans
  for (const plan of body.plans) {
    if (!plan.semester_number || plan.semester_number < 1) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid semester number",
      });
    }
    if (!["L", "S"].includes(plan.semester_type)) {
      throw createError({
        statusCode: 400,
        statusMessage: "Semester type must be L (Long) or S (Short)",
      });
    }
    if (plan.target_credits === undefined || plan.target_credits < 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "Target credits must be a non-negative number",
      });
    }
  }

  const rule = (ruleRows as any[])[0];

  const normalizedPlans = normalizeSemesterRulePlans(
    body.plans.map((plan) => ({
      semester_number: Number(plan.semester_number),
      semester_type: plan.semester_type,
      is_li: !!plan.is_li,
      target_credits: Number(plan.target_credits) || 0,
    })),
  );

  const finalPlans =
    Number(rule.entry_semester) === 1
      ? placeLiOnLastLongSemester(normalizedPlans)
      : normalizedPlans;

  if (Number(rule.entry_semester) === 1) {
    const constraints = await getProgramSemesterPlanConstraints(programId);

    if (!constraints) {
      throw createError({
        statusCode: 404,
        statusMessage: "Program credit rules not found",
      });
    }

    const validation = validateSemesterRulePlanTargets(finalPlans, constraints);

    if (validation.semesterErrors.length > 0 || validation.totalError) {
      throw createError({
        statusCode: 400,
        statusMessage:
          validation.totalError ||
          validation.semesterErrors[0] ||
          "Semester 1 credit plan is invalid",
      });
    }
  }

  await replaceSemesterCreditPlans(ruleId, finalPlans);

  // Return updated plans
  const [plans] = await pool.query(
    `SELECT id, semester_number, semester_type, is_li, target_credits
     FROM semester_credit_plans
     WHERE rule_id = ?
     ORDER BY semester_number ASC`,
    [ruleId],
  );

  return {
    message: "Credit plans updated successfully",
    plans,
  };
});
