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

  const { long_min, long_max, short_min, short_max } = body;

  // Validate values
  if (long_min == null || long_max == null || short_min == null || short_max == null) {
    throw createError({ statusCode: 400, statusMessage: "All credit limit values are required" });
  }

  if (long_min < 0 || long_max < 0 || short_min < 0 || short_max < 0) {
    throw createError({ statusCode: 400, statusMessage: "Credit limits must be non-negative" });
  }

  if (long_min > long_max) {
    throw createError({ statusCode: 400, statusMessage: "Long semester min cannot exceed max" });
  }

  if (short_min > short_max) {
    throw createError({ statusCode: 400, statusMessage: "Short semester min cannot exceed max" });
  }

  // Get HOP's program
  const [hopRows] = await pool.query(
    `SELECT program_id FROM head_of_programs WHERE user_id = ?`,
    [session.user.id],
  );

  const hopData = hopRows as any[];
  if (hopData.length === 0) {
    throw createError({ statusCode: 404, statusMessage: "HOP profile not found" });
  }

  const programId = hopData[0].program_id;

  await pool.query(
    `UPDATE programs 
     SET long_sem_min_credit = ?, long_sem_max_credit = ?, 
         short_sem_min_credit = ?, short_sem_max_credit = ?
     WHERE id = ?`,
    [long_min, long_max, short_min, short_max, programId],
  );

  return { success: true };
});
