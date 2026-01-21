import { pool } from "../../utils/db";
import { auth } from "@@/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "STUDENT") {
    throw createError({ statusCode: 403, statusMessage: "Students only" });
  }

  const { full_name } = await readBody(event);

  if (!full_name || full_name.trim().length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: "Full name must be at least 2 characters",
    });
  }

  await pool.query("UPDATE user SET name = ? WHERE id = ?", [
    full_name.trim(),
    session.user.id,
  ]);

  return { success: true };
});
