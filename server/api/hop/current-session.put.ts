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

  const body = await readBody(event);
  const { active_intake_period, semester_type } = body;

  // Validate active_intake_period: must be 4 digits, MMYY format
  if (!active_intake_period || !/^\d{4}$/.test(active_intake_period)) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Intake period must be 4 digits in MMYY format (e.g., 0525)",
    });
  }

  const month = parseInt(active_intake_period.substring(0, 2), 10);
  if (month < 1 || month > 12) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid month in intake period. Must be 01-12.",
    });
  }

  // Validate semester_type
  if (!semester_type || !["L", "S"].includes(semester_type)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Semester type must be 'L' (Long) or 'S' (Short)",
    });
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

  // Upsert single row per program
  await pool.query(
    `INSERT INTO program_current_session (program_id, active_intake_period, semester_type)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       active_intake_period = VALUES(active_intake_period),
       semester_type = VALUES(semester_type)`,
    [programId, active_intake_period, semester_type],
  );

  const [rows] = await pool.query(
    `SELECT active_intake_period, semester_type, updated_at
     FROM program_current_session
     WHERE program_id = ?`,
    [programId],
  );

  return { current_session: (rows as any[])[0] ?? null };
});
