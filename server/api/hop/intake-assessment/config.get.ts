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

  // Get distinct semester entry rule sets (by intake_year)
  const [ruleSetRows] = await pool.query(
    `SELECT DISTINCT intake_year, 
            COUNT(*) as rule_count,
            MIN(min_credit) as min_credit_floor,
            MAX(max_credit) as max_credit_ceiling
     FROM semester_entry_rules 
     WHERE program_id = ? 
     GROUP BY intake_year 
     ORDER BY intake_year DESC`,
    [programId],
  );

  const intakes = (intakeRows as any[]).map((r) => r.intake_year);
  const ruleSets = (ruleSetRows as any[]).map((r) => ({
    intake_year: r.intake_year,
    rule_count: r.rule_count,
    min_credit_floor: r.min_credit_floor,
    max_credit_ceiling: r.max_credit_ceiling,
  }));

  return {
    programId,
    intakes,
    ruleSets,
  };
});
