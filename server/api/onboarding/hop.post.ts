import { pool } from "../../utils/db";
import { auth } from "@@/utils/auth";
import { hashPassword } from "better-auth/crypto";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
  }

  const { program_id, password } = await readBody(event);

  if (!program_id) {
    throw createError({
      statusCode: 400,
      statusMessage: "Program is required",
    });
  }

  if (!password || password.length < 8) {
    throw createError({
      statusCode: 400,
      statusMessage: "Password must be at least 8 characters",
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

    // Hash password and create credential account for email/password login
    const hashedPassword = await hashPassword(password);

    await connection.query(
      `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
       VALUES (UUID(), ?, 'credential', ?, ?, NOW(3), NOW(3))
       ON DUPLICATE KEY UPDATE password = VALUES(password), updatedAt = NOW(3)`,
      [session.user.email, session.user.id, hashedPassword],
    );

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
