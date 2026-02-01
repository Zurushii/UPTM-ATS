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
  const id = getRouterParam(event, "id");

  // Verify session belongs to this program
  const [existingRows] = await pool.query(
    `SELECT id FROM program_sessions WHERE id = ? AND program_id = ?`,
    [id, programId],
  );

  if ((existingRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Session not found",
    });
  }

  // Use transaction to ensure all-or-nothing deletion
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    // Delete academic plans for all intakes linked to this session
    // This ensures students will show "No Plan" status after session deletion
    await connection.query(
      `DELETE FROM academic_plans WHERE intake_id IN (
        SELECT id FROM academic_planning_intakes WHERE session_id = ?
      )`,
      [id]
    );

    // Delete academic_planning_intakes linked to this session
    await connection.query(
      `DELETE FROM academic_planning_intakes WHERE session_id = ?`,
      [id]
    );

    // Delete session (cascade will remove program_courses)
    await connection.query(`DELETE FROM program_sessions WHERE id = ?`, [id]);

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to delete session. Please try again.",
    });
  } finally {
    connection.release();
  }

  return { success: true, message: "Session deleted" };
});
