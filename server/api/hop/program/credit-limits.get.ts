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

  const [rows] = await pool.query(
    `SELECT total_credit_required,
            long_sem_min_credit,
            long_sem_max_credit,
            short_sem_min_credit,
            short_sem_max_credit
     FROM programs WHERE id = ?`,
    [programId],
  );

  const program = (rows as any[])[0];
  if (!program) {
    throw createError({ statusCode: 404, statusMessage: "Program not found" });
  }

  return {
    total_credit_required: program.total_credit_required,
    long_min: program.long_sem_min_credit,
    long_max: program.long_sem_max_credit,
    short_min: program.short_sem_min_credit,
    short_max: program.short_sem_max_credit,
  };
});
