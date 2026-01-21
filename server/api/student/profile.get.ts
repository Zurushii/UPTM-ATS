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

  const [rows] = await pool.query(
    `SELECT 
      s.id,
      s.matric_no,
      s.intake_year,
      s.total_credit_transferred,
      s.starting_semester,
      p.id as program_id,
      p.program_code,
      p.program_name,
      p.total_credit_required,
      p.duration_semesters,
      u.name as full_name,
      u.email
    FROM students s
    JOIN programs p ON s.program_id = p.id
    JOIN user u ON s.user_id = u.id
    WHERE s.user_id = ?`,
    [session.user.id],
  );

  const students = rows as any[];
  if (students.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Student profile not found",
    });
  }

  return students[0];
});
