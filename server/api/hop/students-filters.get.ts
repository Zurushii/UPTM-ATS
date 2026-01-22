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

  // Get distinct intake years for the program's students
  const [intakeRows] = await pool.query(
    `SELECT DISTINCT intake_year FROM students WHERE program_id = ? ORDER BY intake_year DESC`,
    [programId],
  );

  // Get distinct entry semesters for the program's students
  const [semesterRows] = await pool.query(
    `SELECT DISTINCT starting_semester FROM students WHERE program_id = ? ORDER BY starting_semester ASC`,
    [programId],
  );

  const intakes = (intakeRows as any[]).map((r) => r.intake_year);
  const entrySemesters = (semesterRows as any[]).map(
    (r) => r.starting_semester,
  );

  return {
    intakes,
    entrySemesters,
    statuses: ["none", "draft", "approved", "completed"],
  };
});
