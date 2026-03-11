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

  // Get current session for filtering
  const [sessionRows] = await pool.query(
    `SELECT active_intake_period, semester_type FROM program_current_session WHERE program_id = ?`,
    [programId],
  );
  const currentSession = (sessionRows as any[])[0] || null;

  // No current session → return empty (banner will warn the user)
  if (!currentSession) {
    return { courses: [], has_session: false };
  }

  const query = getQuery(event);
  const search = (query.search as string) || "";

  // Show all distinct courses in the program;
  // student_count = students currently taking the course in their active semester
  let sql = `
    SELECT
      c.id AS course_id,
      c.course_code,
      c.course_name,
      c.credit_hour,
      MIN(pc.semester) AS semester,
      MIN(pc.course_type) AS course_type,
      COUNT(DISTINCT active_apd.student_id) AS student_count
    FROM program_courses pc
    JOIN courses c ON c.id = pc.course_id
    JOIN program_sessions ps ON ps.id = pc.session_id
    LEFT JOIN (
      SELECT apd.course_id, ap.student_id
      FROM academic_plan_details apd
      JOIN academic_plans ap ON ap.id = apd.academic_plan_id
      JOIN students s ON s.id = ap.student_id
      JOIN academic_planning_intakes api ON api.id = ap.intake_id
      WHERE s.program_id = ?
        AND apd.semester = api.current_semester + ap.start_semester - 1
        AND apd.status = 'Planned'
    ) active_apd ON active_apd.course_id = c.id
    WHERE ps.program_id = ?
  `;

  const params: any[] = [programId, programId];

  if (search) {
    sql += ` AND (c.course_code LIKE ? OR c.course_name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += `
    GROUP BY c.id, c.course_code, c.course_name, c.credit_hour
    HAVING student_count > 0
    ORDER BY semester ASC, c.course_code ASC
  `;

  const [rows] = await pool.query(sql, params);

  return {
    courses: rows,
    has_session: true,
  };
});
