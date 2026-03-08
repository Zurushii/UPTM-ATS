import { pool } from "../utils/db";
import { auth } from "@@/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  let programId: number | null = null;

  if (session.user.role === "HOP") {
    const [hopRows] = await pool.query(
      `SELECT program_id FROM head_of_programs WHERE user_id = ?`,
      [session.user.id],
    );
    const hopData = hopRows as any[];
    if (hopData.length > 0) {
      programId = hopData[0].program_id;
    }
  } else if (session.user.role === "STUDENT") {
    const [studentRows] = await pool.query(
      `SELECT program_id FROM students WHERE user_id = ?`,
      [session.user.id],
    );
    const studentData = studentRows as any[];
    if (studentData.length > 0) {
      programId = studentData[0].program_id;
    }
  }

  if (!programId) {
    return { current_session: null };
  }

  const [rows] = await pool.query(
    `SELECT intake_period, semester_type, updated_at
     FROM program_current_session
     WHERE program_id = ?`,
    [programId],
  );

  const data = (rows as any[])[0] || null;

  return { current_session: data };
});
