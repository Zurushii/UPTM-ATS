import { pool } from "../utils/db";
import { auth } from "@@/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  // Resolve the user's program_id
  let programId: number | null = null;

  if (session.user.role === "HOP") {
    const [hopRows] = await pool.query(
      `SELECT program_id FROM head_of_programs WHERE user_id = ?`,
      [session.user.id],
    );
    const hopData = hopRows as any[];
    if (hopData.length === 0) return { current_session: null };
    programId = hopData[0].program_id;
  } else if (session.user.role === "STUDENT") {
    const [studentRows] = await pool.query(
      `SELECT program_id FROM students WHERE user_id = ?`,
      [session.user.id],
    );
    const studentData = studentRows as any[];
    if (studentData.length === 0) return { current_session: null };
    programId = studentData[0].program_id;
  }

  if (!programId) return { current_session: null };

  // Both roles get the same global row
  const [rows] = await pool.query(
    `SELECT active_intake_period, semester_type, updated_at
     FROM program_current_session
     WHERE program_id = ?`,
    [programId],
  );

  const cs = (rows as any[])[0] ?? null;
  return { current_session: cs };
});
