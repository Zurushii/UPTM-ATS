import { pool } from "../../utils/db";
import { auth } from "@@/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
  }

  const { program_id } = await readBody(event);

  if (!program_id) {
    throw createError({
      statusCode: 400,
      statusMessage: "Program is required",
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(
      `INSERT INTO head_of_programs (user_id, program_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE program_id = VALUES(program_id)`,
      [session.user.id, program_id],
    );

    await connection.query("UPDATE user SET is_onboarded = 1 WHERE id = ?", [
      session.user.id,
    ]);

    await connection.commit();
    return { success: true };
  } catch (error: any) {
    await connection.rollback();
    if (error.statusCode) throw error;
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to complete onboarding",
    });
  } finally {
    connection.release();
  }
});
