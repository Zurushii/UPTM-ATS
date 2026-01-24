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
  const id = getRouterParam(event, "id");

  // Verify the program course exists and get its session
  const [existingRows] = await pool.query(
    `SELECT pc.id, pc.course_id, pc.session_id
     FROM program_courses pc
     JOIN program_sessions ps ON pc.session_id = ps.id
     WHERE pc.id = ? AND ps.program_id = ?`,
    [id, programId],
  );

  if ((existingRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Program course not found",
    });
  }

  const body = await readBody(event);
  const { semester, course_type, prerequisite_course_id } = body;

  if (!semester) {
    throw createError({
      statusCode: 400,
      statusMessage: "semester is required",
    });
  }

  const sessionId = (existingRows as any[])[0].session_id;

  // Validate prerequisite if provided
  if (prerequisite_course_id) {
    // Check prerequisite course exists in this session's structure
    const [prereqRows] = await pool.query(
      `SELECT semester FROM program_courses WHERE session_id = ? AND course_id = ?`,
      [sessionId, prerequisite_course_id],
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

    // Cannot set prerequisite to itself
    const currentCourseId = (existingRows as any[])[0].course_id;
    if (prerequisite_course_id === currentCourseId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Course cannot be its own prerequisite",
      });
    }
  }

  // Check if any other courses depend on this one (have it as prerequisite)
  // If so, ensure those courses are in later semesters
  const currentCourseId = (existingRows as any[])[0].course_id;
  const [dependentRows] = await pool.query(
    `SELECT pc.id, c.course_code, pc.semester 
     FROM program_courses pc
     JOIN courses c ON pc.course_id = c.id
     WHERE pc.session_id = ? AND pc.prerequisite_course_id = ?`,
    [sessionId, currentCourseId],
  );

  const dependents = dependentRows as any[];
  for (const dep of dependents) {
    if (dep.semester <= semester) {
      throw createError({
        statusCode: 400,
        statusMessage: `Cannot move to semester ${semester}. Course ${dep.course_code} depends on this course and is in semester ${dep.semester}`,
      });
    }
  }

  // Update program course
  await pool.query(
    `UPDATE program_courses SET semester = ?, course_type = COALESCE(?, course_type), prerequisite_course_id = ? WHERE id = ?`,
    [semester, course_type, prerequisite_course_id || null, id],
  );

  return {
    success: true,
    message: "Program course updated",
  };
});
