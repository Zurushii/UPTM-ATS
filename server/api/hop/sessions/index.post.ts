import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";

interface SessionInput {
  session_name: string;
  intake_year: string;
}

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

  const body = await readBody<SessionInput>(event);

  if (!body.session_name || body.session_name.trim().length < 3) {
    throw createError({
      statusCode: 400,
      statusMessage: "Session name is required (min 3 characters)",
    });
  }

  if (!body.intake_year || body.intake_year.length !== 4) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid intake year format. Use MMYY (e.g., 0824)",
    });
  }

  // Check for duplicate session name in same program
  const [existingRows] = await pool.query(
    `SELECT id FROM program_sessions WHERE program_id = ? AND session_name = ?`,
    [programId, body.session_name.trim()],
  );

  if ((existingRows as any[]).length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: "A session with this name already exists",
    });
  }

  const [result] = await pool.query(
    `INSERT INTO program_sessions (program_id, session_name, intake_year, is_active)
     VALUES (?, ?, ?, TRUE)`,
    [programId, body.session_name.trim(), body.intake_year],
  );

  return {
    success: true,
    id: (result as any).insertId,
    session_name: body.session_name.trim(),
    intake_year: body.intake_year,
  };
});
