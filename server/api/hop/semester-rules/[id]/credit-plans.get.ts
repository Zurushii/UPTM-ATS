import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";

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

  // Get credit plans for this rule
  const [plans] = await pool.query(
    `SELECT id, semester_number, semester_type, target_credits
     FROM semester_credit_plans
     WHERE rule_id = ?
     ORDER BY semester_number ASC`,
    [ruleId],
  );

  return plans;
});
