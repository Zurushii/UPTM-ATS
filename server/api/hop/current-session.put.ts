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

  // ── Auto-compute current_semester for every intake ──

  // 1. Record this active period in the persistent session timeline
  await pool.query(
    `INSERT IGNORE INTO program_session_timeline (program_id, period)
     VALUES (?, ?)`,
    [programId, active_intake_period],
  );

  // 2. Backfill: ensure all intake start periods are also in the timeline
  //    (covers intakes created before this feature existed)
  const [intakeRows] = await pool.query(
    `SELECT id, intake_year
     FROM academic_planning_intakes
     WHERE program_id = ?`,
    [programId],
  );

  const intakes = intakeRows as { id: number; intake_year: string }[];

  for (const intake of intakes) {
    await pool.query(
      `INSERT IGNORE INTO program_session_timeline (program_id, period)
       VALUES (?, ?)`,
      [programId, intake.intake_year],
    );
  }

  // 3. Build full chronological timeline from the persistent table
  const toSortKey = (mmyy: string): number => {
    const mm = parseInt(mmyy.substring(0, 2), 10);
    const yy = parseInt(mmyy.substring(2, 4), 10);
    return yy * 100 + mm;
  };

  const [timelineRows] = await pool.query(
    `SELECT period FROM program_session_timeline WHERE program_id = ?`,
    [programId],
  );

  const timeline = (timelineRows as { period: string }[])
    .map((r) => r.period)
    .sort((a, b) => toSortKey(a) - toSortKey(b));

  // 4. Find active period position and compute semesters
  const activePos = timeline.indexOf(active_intake_period);

  for (const intake of intakes) {
    const intakePos = timeline.indexOf(intake.intake_year);
    const semester =
      intakePos <= activePos ? activePos - intakePos + 1 : 0;
    await pool.query(
      `UPDATE academic_planning_intakes SET current_semester = ? WHERE id = ?`,
      [semester, intake.id],
    );
  }

  const [rows] = await pool.query(
    `SELECT active_intake_period, semester_type, updated_at
     FROM program_current_session
     WHERE program_id = ?`,
    [programId],
  );

  return { current_session: (rows as any[])[0] ?? null };
});
