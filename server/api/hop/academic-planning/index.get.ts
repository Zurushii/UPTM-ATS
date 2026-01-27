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

  // Get all academic planning intakes for this program
  const [rows] = await pool.query(
    `SELECT 
      api.id,
      api.intake_year,
      api.intake_name,
      api.session_id,
      ps.session_name,
      api.intake_type,
      api.status,
      api.total_students,
      api.successful_plans,
      api.failed_plans,
      api.created_at,
      api.updated_at
    FROM academic_planning_intakes api
    JOIN program_sessions ps ON api.session_id = ps.id
    WHERE api.program_id = ?
    ORDER BY api.created_at DESC`,
    [programId],
  );

  return rows;
});
