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

  const planId = getRouterParam(event, "planId");
  if (!planId) {
    throw createError({ statusCode: 400, statusMessage: "Plan ID required" });
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

  // Verify the plan exists and get intake info
  const [planRows] = await pool.query(
    `SELECT ap.intake_id
     FROM academic_plans ap
     JOIN students s ON ap.student_id = s.id
     WHERE ap.id = ? AND s.program_id = ?`,
    [planId, programId],
  );

  if ((planRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Academic plan not found",
    });
  }

  const intakeId = (planRows as any[])[0].intake_id;

  // Get session_id from intake
  const [intakeRows] = await pool.query(
    `SELECT session_id FROM academic_planning_intakes WHERE id = ?`,
    [intakeId],
  );

  if ((intakeRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Intake not found",
    });
  }

  const sessionId = (intakeRows as any[])[0].session_id;

  // Get all available courses from program structure
  const [courseRows] = await pool.query(
    `SELECT 
      c.id AS course_id,
      c.course_code,
      c.course_name,
      c.credit_hour,
      pc.semester AS default_semester,
      pc.course_type,
      pc.course_group
    FROM program_courses pc
    JOIN courses c ON pc.course_id = c.id
    WHERE pc.session_id = ?
    ORDER BY pc.semester, c.course_code`,
    [sessionId],
  );

  return {
    courses: courseRows,
  };
});
