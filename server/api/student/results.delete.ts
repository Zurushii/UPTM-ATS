import { pool } from "../../utils/db";
import { auth } from "@@/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "STUDENT") {
    throw createError({ statusCode: 403, statusMessage: "Student only" });
  }

  const body = await readBody(event);
  const semester = body?.semester;

  if (!semester || typeof semester !== "number" || semester < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid semester number",
    });
  }

  // Get student record
  const [studentRows] = await pool.query(
    `SELECT s.id, s.matric_no FROM students s WHERE s.user_id = ?`,
    [session.user.id],
  );

  const student = (studentRows as any[])[0];
  if (!student) {
    throw createError({
      statusCode: 404,
      statusMessage: "Student profile not found",
    });
  }

  // Get latest academic plan
  const [planRows] = await pool.query(
    `SELECT id FROM academic_plans WHERE student_id = ? ORDER BY created_at DESC LIMIT 1`,
    [student.id],
  );

  const plan = (planRows as any[])[0];
  if (!plan) {
    throw createError({
      statusCode: 400,
      statusMessage: "No academic plan found",
    });
  }

  // Use transaction: delete result slip record + reset course statuses to 'Planned'
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Delete the semester result record
    await connection.query(
      `DELETE FROM semester_results
       WHERE student_id = ? AND academic_plan_id = ? AND semester = ?`,
      [student.id, plan.id, semester],
    );

    // Reset all course statuses for that semester back to 'Planned' (except 'Transferred')
    await connection.query(
      `UPDATE academic_plan_details
       SET status = 'Planned', grade = NULL
       WHERE academic_plan_id = ? AND semester = ? AND status IN ('Passed', 'Failed')`,
      [plan.id, semester],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to revoke results",
    });
  } finally {
    connection.release();
  }

  return { success: true, message: "Results revoked successfully" };
});
