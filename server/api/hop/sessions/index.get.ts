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

  // Get all sessions for this program with course count
  const [rows] = await pool.query(
    `SELECT 
      ps.id,
      ps.session_name,
      ps.intake_year,
      ps.is_active,
      ps.created_at,
      COUNT(pc.id) AS course_count,
      COALESCE(SUM(c.credit_hour), 0) AS total_credits
    FROM program_sessions ps
    LEFT JOIN program_courses pc ON ps.id = pc.session_id
    LEFT JOIN courses c ON pc.course_id = c.id
    WHERE ps.program_id = ?
    GROUP BY ps.id
    ORDER BY ps.created_at DESC`,
    [programId],
  );

  return rows;
});
