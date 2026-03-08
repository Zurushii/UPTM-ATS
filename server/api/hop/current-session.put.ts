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
  const { intake_period, semester_type } = body;

  // Validate intake_period: must be 4 digits, MMYY format
  if (!intake_period || !/^\d{4}$/.test(intake_period)) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Intake period must be 4 digits in MMYY format (e.g., 0525)",
    });
  }

  const month = parseInt(intake_period.substring(0, 2), 10);
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

  // Upsert: insert or update if already exists
  await pool.query(
    `INSERT INTO program_current_session (program_id, intake_period, semester_type)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       intake_period = VALUES(intake_period),
       semester_type = VALUES(semester_type)`,
    [programId, intake_period, semester_type],
  );

  // Return the updated record
  const [rows] = await pool.query(
    `SELECT intake_period, semester_type, updated_at
     FROM program_current_session
     WHERE program_id = ?`,
    [programId],
  );

  return { current_session: (rows as any[])[0] };
});
