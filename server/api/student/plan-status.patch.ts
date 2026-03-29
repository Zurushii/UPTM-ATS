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
  const { plan_id, status } = body;

  if (!plan_id || !status) {
    throw createError({
      statusCode: 400,
      statusMessage: "plan_id and status are required",
    });
  }

  // Only allow reverting to draft (for re-scheduling)
  if (status !== "draft") {
    throw createError({
      statusCode: 400,
      statusMessage: "Students can only revert plan to draft status",
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

  // Verify this plan belongs to the student
  const [planRows] = await pool.query(
    `SELECT ap.id, ap.status, api.status AS intake_status 
     FROM academic_plans ap
     LEFT JOIN academic_planning_intakes api ON ap.intake_id = api.id
     WHERE ap.id = ? AND ap.student_id = ?`,
    [plan_id, studentId],
  );

  if ((planRows as any[]).length === 0) {
    throw createError({ statusCode: 404, statusMessage: "Plan not found" });
  }

  const plan = (planRows as any[])[0];

  if (plan.intake_status === "completed") {
    throw createError({
      statusCode: 400,
      statusMessage: "Cannot modify plan status for an intake that has been marked as completed",
    });
  }

  // Only allow reverting from approved to draft
  if (plan.status !== "approved") {
    throw createError({
      statusCode: 400,
      statusMessage: "Can only revert approved plans to draft",
    });
  }

  // Update status to draft
  await pool.query(
    `UPDATE academic_plans SET status = 'draft' WHERE id = ?`,
    [plan_id],
  );

  // Log the activity for HoP notification and audit
  await pool.query(
    `INSERT INTO plan_activity_logs (plan_id, actor_type, action, notes)
     VALUES (?, 'student', 'reverted_to_draft', 'Student requested to re-schedule their approved plan')`,
    [plan_id],
  );

  return {
    success: true,
    message: "Plan reverted to draft for re-scheduling",
  };
});
