import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";

interface CreditPlanInput {
  semester_number: number;
  semester_type: "L" | "S";
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
    `SELECT id FROM semester_entry_rules WHERE id = ? AND program_id = ?`,
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

  // Delete existing plans for this rule
  await pool.query(`DELETE FROM semester_credit_plans WHERE rule_id = ?`, [
    ruleId,
  ]);

  // Insert new plans
  if (body.plans.length > 0) {
    const values = body.plans.map((plan) => [
      ruleId,
      plan.semester_number,
      plan.semester_type,
      plan.target_credits,
    ]);

    await pool.query(
      `INSERT INTO semester_credit_plans (rule_id, semester_number, semester_type, target_credits)
       VALUES ?`,
      [values],
    );
  }

  // Return updated plans
  const [plans] = await pool.query(
    `SELECT id, semester_number, semester_type, target_credits
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
