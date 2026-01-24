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

  // Get distinct intakes for the program's students
  const [intakeRows] = await pool.query(
    `SELECT DISTINCT intake_year FROM students WHERE program_id = ? ORDER BY intake_year DESC`,
    [programId],
  );

  // Get distinct semester entry rule sets (by intake_type)
  const [ruleSetRows] = await pool.query(
    `SELECT DISTINCT intake_type, 
            COUNT(*) as rule_count,
            MIN(credit_transfer) as min_credit,
            MAX(credit_transfer) as max_credit
     FROM semester_entry_rules 
     WHERE program_id = ? 
     GROUP BY intake_type 
     ORDER BY intake_type ASC`,
    [programId],
  );

  const intakes = (intakeRows as any[]).map((r) => r.intake_year);
  const ruleSets = (ruleSetRows as any[]).map((r) => ({
    intake_type: r.intake_type,
    rule_count: r.rule_count,
    min_credit: r.min_credit,
    max_credit: r.max_credit,
  }));

  return {
    programId,
    intakes,
    ruleSets,
  };
});
