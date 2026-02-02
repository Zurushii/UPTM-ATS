import { pool } from "../../../../utils/db";
import { auth } from "@@/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "STUDENT") {
    throw createError({ statusCode: 403, statusMessage: "Students only" });
  }

  const planId = getRouterParam(event, "planId");

  if (!planId) {
    throw createError({ statusCode: 400, statusMessage: "Plan ID is required" });
  }

  // Get student ID
  const [studentRows] = await pool.query(
    "SELECT id FROM students WHERE user_id = ?",
    [session.user.id],
  );

  const students = studentRows as any[];
  if (students.length === 0) {
    throw createError({ statusCode: 404, statusMessage: "Student not found" });
  }

  const studentId = students[0].id;

  // Verify this plan belongs to the student and get intake_id
  const [planRows] = await pool.query(
    `SELECT ap.id, ap.intake_id
     FROM academic_plans ap
     WHERE ap.id = ? AND ap.student_id = ?`,
    [planId, studentId],
  );

  if ((planRows as any[]).length === 0) {
    throw createError({ statusCode: 404, statusMessage: "Plan not found" });
  }

  const plan = (planRows as any[])[0];

  // Get session_id from intake
  const [intakeRows] = await pool.query(
    `SELECT session_id FROM academic_planning_intakes WHERE id = ?`,
    [plan.intake_id],
  );

  if ((intakeRows as any[]).length === 0) {
    throw createError({ statusCode: 404, statusMessage: "Intake not found" });
  }

  const sessionId = (intakeRows as any[])[0].session_id;

  // Get available courses from program structure for this session
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
