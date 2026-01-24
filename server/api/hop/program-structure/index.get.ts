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

  // Get session_id from query params
  const query = getQuery(event);
  const sessionId = query.session_id as string | undefined;

  if (!sessionId) {
    throw createError({
      statusCode: 400,
      statusMessage: "session_id query parameter is required",
    });
  }

  // Verify session belongs to this program
  const [sessionRows] = await pool.query(
    `SELECT id, session_name, intake_year FROM program_sessions 
     WHERE id = ? AND program_id = ?`,
    [sessionId, programId],
  );

  if ((sessionRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Session not found",
    });
  }

  const programSession = (sessionRows as any[])[0];

  // Get program info
  const [programRows] = await pool.query(
    `SELECT id, program_code, program_name, total_credit_required, duration_semesters 
     FROM programs WHERE id = ?`,
    [programId],
  );

  const program = (programRows as any[])[0];

  // Get all courses in this session's structure with prerequisite info
  const [rows] = await pool.query(
    `SELECT 
      pc.id,
      pc.semester,
      pc.prerequisite_course_id,
      c.id AS course_id,
      c.course_code,
      c.course_name,
      c.credit_hour,
      prereq.course_code AS prerequisite_code,
      prereq.course_name AS prerequisite_name
    FROM program_courses pc
    JOIN courses c ON pc.course_id = c.id
    LEFT JOIN courses prereq ON pc.prerequisite_course_id = prereq.id
    WHERE pc.session_id = ?
    ORDER BY pc.semester ASC, c.course_code ASC`,
    [sessionId],
  );

  // Group courses by semester
  const coursesArray = rows as any[];
  const semesters: Record<number, any[]> = {};

  for (const course of coursesArray) {
    if (!semesters[course.semester]) {
      semesters[course.semester] = [];
    }
    semesters[course.semester].push(course);
  }

  // Calculate totals per semester
  const semesterSummary = Object.entries(semesters).map(([sem, courses]) => ({
    semester: parseInt(sem),
    courses,
    totalCredits: courses.reduce((sum, c) => sum + c.credit_hour, 0),
    courseCount: courses.length,
  }));

  return {
    program,
    session: programSession,
    semesters: semesterSummary,
    totalCourses: coursesArray.length,
    totalCredits: coursesArray.reduce((sum, c) => sum + c.credit_hour, 0),
  };
});
