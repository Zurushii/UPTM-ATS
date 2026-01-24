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

  const body = await readBody(event);
  const { session_name, intake_year, is_active } = body;

  // Build dynamic update
  const updates: string[] = [];
  const params: any[] = [];

  if (session_name !== undefined) {
    if (session_name.trim().length < 3) {
      throw createError({
        statusCode: 400,
        statusMessage: "Session name must be at least 3 characters",
      });
    }
    updates.push("session_name = ?");
    params.push(session_name.trim());
  }

  if (intake_year !== undefined) {
    if (intake_year.length !== 4) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid intake year format. Use MMYY",
      });
    }
    updates.push("intake_year = ?");
    params.push(intake_year);
  }

  if (is_active !== undefined) {
    updates.push("is_active = ?");
    params.push(is_active ? 1 : 0);
  }

  if (updates.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "No fields to update",
    });
  }

  params.push(id);

  await pool.query(
    `UPDATE program_sessions SET ${updates.join(", ")} WHERE id = ?`,
    params,
  );

  return { success: true, message: "Session updated" };
});
