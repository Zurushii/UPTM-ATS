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

  const query = getQuery(event);
  const ruleSetIntake = query.rule_set_intake as string | undefined;

  if (!ruleSetIntake) {
    throw createError({
      statusCode: 400,
      statusMessage: "rule_set_intake parameter is required",
    });
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

  // Get semester entry rules for the specified intake
  const [rules] = await pool.query(
    `SELECT id, min_credit, max_credit, entry_semester 
     FROM semester_entry_rules 
     WHERE program_id = ? AND intake_year = ?
     ORDER BY min_credit ASC`,
    [programId, ruleSetIntake],
  );

  return rules;
});
