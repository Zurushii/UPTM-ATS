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

  // Delete session (cascade will remove program_courses)
  await pool.query(`DELETE FROM program_sessions WHERE id = ?`, [id]);

  return { success: true, message: "Session deleted" };
});
