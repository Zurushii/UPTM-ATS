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
    `SELECT pc.id, pc.course_id, pc.session_id, c.course_code 
     FROM program_courses pc
     JOIN program_sessions ps ON pc.session_id = ps.id
     JOIN courses c ON pc.course_id = c.id
     WHERE pc.id = ? AND ps.program_id = ?`,
    [id, programId],
  );

  if ((existingRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Program course not found",
    });
  }

  const courseId = (existingRows as any[])[0].course_id;
  const sessionId = (existingRows as any[])[0].session_id;

  // Check if any other courses in this session depend on this one
  const [dependentRows] = await pool.query(
    `SELECT pc.id, c.course_code 
     FROM program_courses pc
     JOIN courses c ON pc.course_id = c.id
     WHERE pc.session_id = ? AND pc.prerequisite_course_id = ?`,
    [sessionId, courseId],
  );

  if ((dependentRows as any[]).length > 0) {
    const dependents = (dependentRows as any[])
      .map((d) => d.course_code)
      .join(", ");
    throw createError({
      statusCode: 400,
      statusMessage: `Cannot delete. The following courses depend on this course: ${dependents}`,
    });
  }

  // Delete the program course
  await pool.query(`DELETE FROM program_courses WHERE id = ?`, [id]);

  return {
    success: true,
    message: "Course removed from session structure",
  };
});
