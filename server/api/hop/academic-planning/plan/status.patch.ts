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

  // Get request body
  const body = await readBody(event);
  const { plan_id, status } = body;

  if (!plan_id) {
    throw createError({ statusCode: 400, statusMessage: "plan_id is required" });
  }

  if (!status || !["draft", "approved", "completed"].includes(status)) {
    throw createError({
      statusCode: 400,
      statusMessage: "status must be 'draft', 'approved' or 'completed'",
    });
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

  // Verify the plan exists and belongs to a student in this program
  const [planRows] = await pool.query(
    `SELECT ap.id, ap.status AS current_status
     FROM academic_plans ap
     JOIN students s ON ap.student_id = s.id
     WHERE ap.id = ? AND s.program_id = ?`,
    [plan_id, programId],
  );

  if ((planRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Academic plan not found",
    });
  }

  const currentStatus = (planRows as any[])[0].current_status;

  // Validate status transitions
  if (status === "draft" && currentStatus !== "approved") {
    throw createError({
      statusCode: 400,
      statusMessage: "Can only revert to draft from approved status",
    });
  }

  if (status === "approved" && currentStatus !== "draft") {
    throw createError({
      statusCode: 400,
      statusMessage: "Can only approve a plan that is in draft status",
    });
  }

  if (status === "completed" && currentStatus !== "approved") {
    throw createError({
      statusCode: 400,
      statusMessage: "Can only complete a plan that is in approved status",
    });
  }

  // Update the status
  await pool.query(
    `UPDATE academic_plans SET status = ? WHERE id = ?`,
    [status, plan_id],
  );

  return {
    success: true,
    message: `Plan status updated to ${status}`,
    plan_id,
    status,
  };
});
