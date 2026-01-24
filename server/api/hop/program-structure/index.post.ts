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

  // Parse body
  const body = await readBody(event);
  const { session_id, course_id, semester, course_type, prerequisite_course_id } = body;

  if (!session_id) {
    throw createError({
      statusCode: 400,
      statusMessage: "session_id is required",
    });
  }

  if (!course_id || !semester) {
    throw createError({
      statusCode: 400,
      statusMessage: "course_id and semester are required",
    });
  }

  // Verify session belongs to this program
  const [sessionRows] = await pool.query(
    `SELECT id FROM program_sessions WHERE id = ? AND program_id = ?`,
    [session_id, programId],
  );

  if ((sessionRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Session not found",
    });
  }

  // Check if course exists
  const [courseRows] = await pool.query(`SELECT id FROM courses WHERE id = ?`, [
    course_id,
  ]);

  if ((courseRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Course not found",
    });
  }

  // Check if course already exists in this session's structure
  const [existingRows] = await pool.query(
    `SELECT id FROM program_courses WHERE session_id = ? AND course_id = ?`,
    [session_id, course_id],
  );

  if ((existingRows as any[]).length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: "Course already exists in this session's structure",
    });
  }

  // Validate prerequisite if provided
  if (prerequisite_course_id) {
    // Check prerequisite course exists in this session's structure
    const [prereqRows] = await pool.query(
      `SELECT semester FROM program_courses WHERE session_id = ? AND course_id = ?`,
      [session_id, prerequisite_course_id],
    );

    if ((prereqRows as any[]).length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage:
          "Prerequisite course must be in this session's structure first",
      });
    }

    // Prerequisite must be in an earlier semester
    const prereqSemester = (prereqRows as any[])[0].semester;
    if (prereqSemester >= semester) {
      throw createError({
        statusCode: 400,
        statusMessage: "Prerequisite course must be in an earlier semester",
      });
    }
  }

  // Insert new program course
  const [result] = await pool.query(
    `INSERT INTO program_courses (session_id, course_id, semester, course_type, prerequisite_course_id)
     VALUES (?, ?, ?, ?, ?)`,
    [session_id, course_id, semester, course_type || 'Core Computing', prerequisite_course_id || null],
  );

  return {
    success: true,
    id: (result as any).insertId,
    message: "Course added to session structure",
  };
});
