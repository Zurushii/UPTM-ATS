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

  // Get distinct intake types from semester_entry_rules
  const [ruleIntakes] = await pool.query(
    `SELECT DISTINCT intake_type FROM semester_entry_rules WHERE program_id = ? ORDER BY intake_type ASC`,
    [programId],
  );

  // Get distinct intakes from students (to show student intake info)
  const [studentIntakes] = await pool.query(
    `SELECT DISTINCT intake_year FROM students WHERE program_id = ? ORDER BY intake_year DESC`,
    [programId],
  );

  return {
    rule_intakes: (ruleIntakes as any[]).map((r) => r.intake_type),
    student_intakes: (studentIntakes as any[]).map((r) => r.intake_year),
  };
});
