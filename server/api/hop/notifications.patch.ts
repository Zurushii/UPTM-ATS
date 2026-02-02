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

  const body = await readBody(event);
  const { notification_ids, mark_all } = body;

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

  if (mark_all) {
    // Mark all notifications as read for this HoP's program
    await pool.query(
      `UPDATE plan_activity_logs pal
       JOIN academic_plans ap ON pal.plan_id = ap.id
       JOIN students s ON ap.student_id = s.id
       SET pal.is_read = TRUE
       WHERE s.program_id = ?
         AND pal.actor_type = 'student'
         AND pal.is_read = FALSE`,
      [programId],
    );
  } else if (notification_ids && notification_ids.length > 0) {
    // Mark specific notifications as read
    await pool.query(
      `UPDATE plan_activity_logs pal
       JOIN academic_plans ap ON pal.plan_id = ap.id
       JOIN students s ON ap.student_id = s.id
       SET pal.is_read = TRUE
       WHERE pal.id IN (?)
         AND s.program_id = ?`,
      [notification_ids, programId],
    );
  }

  return {
    success: true,
    message: "Notifications marked as read",
  };
});
