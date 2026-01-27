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

  // Get available program sessions
  const [sessionRows] = await pool.query(
    `SELECT id, session_name, intake_year, is_active 
     FROM program_sessions 
     WHERE program_id = ?
     ORDER BY created_at DESC`,
    [programId],
  );

  // Get available intake types from semester rules
  const [intakeTypeRows] = await pool.query(
    `SELECT DISTINCT intake_type 
     FROM semester_entry_rules 
     WHERE program_id = ?
     ORDER BY intake_type`,
    [programId],
  );

  // Get available intake years from students (for reference)
  const [intakeYearRows] = await pool.query(
    `SELECT DISTINCT intake_year 
     FROM students 
     WHERE program_id = ?
     ORDER BY intake_year DESC`,
    [programId],
  );

  // Get existing academic planning intakes (to prevent duplicates)
  const [existingIntakes] = await pool.query(
    `SELECT intake_year FROM academic_planning_intakes WHERE program_id = ?`,
    [programId],
  );

  const existingIntakeYears = new Set(
    (existingIntakes as any[]).map((r) => r.intake_year)
  );

  return {
    sessions: sessionRows,
    intake_types: (intakeTypeRows as any[]).map((r) => r.intake_type),
    intake_years: (intakeYearRows as any[]).filter(
      (r) => !existingIntakeYears.has(r.intake_year)
    ),
    existing_intake_years: Array.from(existingIntakeYears),
  };
});
