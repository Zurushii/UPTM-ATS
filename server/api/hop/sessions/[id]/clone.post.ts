import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";

export default defineEventHandler(async (event) => {
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
  const sourceId = getRouterParam(event, "id");

  // Verify source session belongs to this program
  const [sourceRows] = await pool.query(
    `SELECT id, session_name, intake_year FROM program_sessions WHERE id = ? AND program_id = ?`,
    [sourceId, programId],
  );

  if ((sourceRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Source session not found",
    });
  }

  const body = await readBody(event);
  const { session_name, intake_year } = body;

  if (!session_name || session_name.trim().length < 3) {
    throw createError({
      statusCode: 400,
      statusMessage: "New session name is required",
    });
  }

  if (!intake_year || intake_year.length !== 4) {
    throw createError({
      statusCode: 400,
      statusMessage: "Intake year is required (MMYY format)",
    });
  }

  // Check for duplicate session name
  const [existingRows] = await pool.query(
    `SELECT id FROM program_sessions WHERE program_id = ? AND session_name = ?`,
    [programId, session_name.trim()],
  );

  if ((existingRows as any[]).length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: "A session with this name already exists",
    });
  }

  // Create new session
  const [insertResult] = await pool.query(
    `INSERT INTO program_sessions (program_id, session_name, intake_year, is_active)
     VALUES (?, ?, ?, TRUE)`,
    [programId, session_name.trim(), intake_year],
  );

  const newSessionId = (insertResult as any).insertId;

  // Clone all courses from source session
  await pool.query(
    `INSERT INTO program_courses (session_id, course_id, semester, course_type, prerequisite_course_id)
     SELECT ?, course_id, semester, course_type, prerequisite_course_id
     FROM program_courses
     WHERE session_id = ?`,
    [newSessionId, sourceId],
  );

  // Get count of cloned courses
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS count FROM program_courses WHERE session_id = ?`,
    [newSessionId],
  );

  return {
    success: true,
    id: newSessionId,
    session_name: session_name.trim(),
    intake_year,
    courses_cloned: (countRows as any[])[0].count,
  };
});
