import { pool } from "../../utils/db";
import { auth } from "@@/utils/auth";

export default defineEventHandler(async (event) => {
  // Authenticate user
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
  }

  // Get query parameters for filtering
  const query = getQuery(event);
  const intakeFilter = query.intake as string | undefined;
  const entrySemesterFilter = query.entry_semester as string | undefined;
  const statusFilter = query.status as string | undefined;

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

  // Build the query with optional filters
  let sql = `
    SELECT 
      s.id AS student_id,
      s.matric_no,
      s.intake_year AS intake,
      s.starting_semester AS entry_semester,
      u.name AS student_name,
      u.email,
      ap.id AS academic_plan_id,
      ap.status AS plan_status
    FROM students s
    JOIN user u ON s.user_id = u.id
    LEFT JOIN academic_plans ap ON ap.student_id = s.id
    WHERE s.program_id = ?
  `;

  const params: any[] = [programId];

  // Apply filters
  if (intakeFilter) {
    sql += ` AND s.intake_year = ?`;
    params.push(intakeFilter);
  }

  if (entrySemesterFilter) {
    if (entrySemesterFilter === "null") {
      sql += ` AND s.starting_semester IS NULL`;
    } else {
      sql += ` AND s.starting_semester = ?`;
      params.push(parseInt(entrySemesterFilter));
    }
  }

  if (statusFilter) {
    if (statusFilter === "none") {
      sql += ` AND ap.id IS NULL`;
    } else {
      sql += ` AND ap.status = ?`;
      params.push(statusFilter);
    }
  }

  sql += ` ORDER BY s.matric_no ASC`;

  const [rows] = await pool.query(sql, params);
  const students = rows as any[];

  // Transform the result to include academic_plan_status
  const result = students.map((student) => ({
    student_id: student.student_id,
    matric_no: student.matric_no,
    student_name: student.student_name,
    email: student.email,
    intake: student.intake,
    entry_semester: student.entry_semester ?? null,
    academic_plan_status: student.academic_plan_id
      ? student.plan_status
      : "none",
  }));

  return result;
});
