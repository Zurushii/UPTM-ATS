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

  // Get unread notifications (plans that need re-approval)
  const [notifications] = await pool.query(
    `SELECT 
      pal.id,
      pal.plan_id,
      pal.action,
      pal.notes,
      pal.is_read,
      pal.created_at,
      s.matric_no,
      COALESCE(u.name, 'Unknown Student') as student_name,
      ap.status as plan_status
    FROM plan_activity_logs pal
    JOIN academic_plans ap ON pal.plan_id = ap.id
    JOIN students s ON ap.student_id = s.id
    LEFT JOIN user u ON s.user_id = u.id
    WHERE s.program_id = ?
      AND pal.actor_type = 'student'
      AND pal.is_read = FALSE
    ORDER BY pal.created_at DESC
    LIMIT 50`,
    [programId],
  );

  // Get count of unread
  const [countResult] = await pool.query(
    `SELECT COUNT(*) as count
    FROM plan_activity_logs pal
    JOIN academic_plans ap ON pal.plan_id = ap.id
    JOIN students s ON ap.student_id = s.id
    WHERE s.program_id = ?
      AND pal.actor_type = 'student'
      AND pal.is_read = FALSE`,
    [programId],
  );

  return {
    notifications,
    unread_count: (countResult as any[])[0]?.count || 0,
  };
});
