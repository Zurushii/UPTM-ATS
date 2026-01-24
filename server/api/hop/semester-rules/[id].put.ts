import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";

interface RuleInput {
  min_credit: number;
  max_credit: number;
  entry_semester: number;
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
    `SELECT id, intake_type FROM semester_entry_rules WHERE id = ? AND program_id = ?`,
    [ruleId, programId],
  );

  const ruleData = ruleRows as any[];
  if (ruleData.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Rule not found",
    });
  }

  const intakeType = ruleData[0].intake_type;

  // Parse request body
  const body = await readBody<RuleInput>(event);

  // Validate input
  if (body.min_credit === undefined || body.min_credit < 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Min credit must be a non-negative number",
    });
  }

  if (body.max_credit === undefined || body.max_credit < body.min_credit) {
    throw createError({
      statusCode: 400,
      statusMessage: "Max credit must be greater than or equal to min credit",
    });
  }

  if (!body.entry_semester || body.entry_semester < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Entry semester must be at least 1",
    });
  }

  // Check for overlapping ranges (excluding current rule)
  const [existingRules] = await pool.query(
    `SELECT id, min_credit, max_credit FROM semester_entry_rules
     WHERE program_id = ? AND intake_type = ? AND id != ?
     AND (
       (? BETWEEN min_credit AND max_credit) OR
       (? BETWEEN min_credit AND max_credit) OR
       (min_credit BETWEEN ? AND ?) OR
       (max_credit BETWEEN ? AND ?)
     )`,
    [
      programId,
      intakeType,
      ruleId,
      body.min_credit,
      body.max_credit,
      body.min_credit,
      body.max_credit,
      body.min_credit,
      body.max_credit,
    ],
  );

  if ((existingRules as any[]).length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Credit range overlaps with an existing rule for this intake",
    });
  }

  // Update rule
  await pool.query(
    `UPDATE semester_entry_rules SET min_credit = ?, max_credit = ?, entry_semester = ? WHERE id = ?`,
    [body.min_credit, body.max_credit, body.entry_semester, ruleId],
  );

  return {
    id: ruleId,
    intake_type: intakeType,
    min_credit: body.min_credit,
    max_credit: body.max_credit,
    entry_semester: body.entry_semester,
  };
});
