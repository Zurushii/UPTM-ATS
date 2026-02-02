import { pool } from "../../utils/db";
import { auth } from "@@/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "STUDENT") {
    throw createError({ statusCode: 403, statusMessage: "Students only" });
  }

  const body = await readBody(event);
  const { plan_id, semester, courses } = body;

  if (!plan_id || semester === undefined || !courses) {
    throw createError({
      statusCode: 400,
      statusMessage: "plan_id, semester, and courses are required",
    });
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

  // Verify this plan belongs to the student and is draft
  const [planRows] = await pool.query(
    `SELECT ap.id, ap.status
     FROM academic_plans ap
     WHERE ap.id = ? AND ap.student_id = ?`,
    [plan_id, studentId],
  );

  if ((planRows as any[]).length === 0) {
    throw createError({ statusCode: 404, statusMessage: "Plan not found" });
  }

  const plan = (planRows as any[])[0];

  if (plan.status !== "draft") {
    throw createError({
      statusCode: 400,
      statusMessage: "Can only modify plans in draft status",
    });
  }

  // Delete existing planned courses for this semester (keep transferred)
  await pool.query(
    `DELETE FROM academic_plan_details 
     WHERE academic_plan_id = ? AND semester = ? AND status = 'Planned'`,
    [plan_id, semester],
  );

  // Insert new courses
  if (courses.length > 0) {
    const values = courses.map((c: any) => [
      plan_id,
      c.course_id,
      semester,
      c.status || "Planned",
    ]);

    await pool.query(
      `INSERT INTO academic_plan_details (academic_plan_id, course_id, semester, status)
       VALUES ?`,
      [values],
    );
  }

  return {
    success: true,
    message: `Schedule updated for semester ${semester}`,
    semester,
    courses_count: courses.length,
  };
});
