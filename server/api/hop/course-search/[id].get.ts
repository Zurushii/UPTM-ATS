import { pool } from "../../../utils/db";
import { auth } from "@@/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
  }

  const courseId = Number(getRouterParam(event, "id"));
  if (!courseId || isNaN(courseId)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid course ID" });
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

  // Get course info
  const [courseRows] = await pool.query(
    `SELECT id, course_code, course_name, credit_hour FROM courses WHERE id = ?`,
    [courseId],
  );

  const course = (courseRows as any[])[0];
  if (!course) {
    throw createError({ statusCode: 404, statusMessage: "Course not found" });
  }

  // Get all students who have this course in their academic plan (all intakes)
  // Exclude students who have this course as a credit transfer
  const [studentRows] = await pool.query(
    `SELECT 
      s.id AS student_id,
      s.matric_no,
      s.intake_year,
      s.starting_semester,
      u.name AS student_name,
      apd.semester AS planned_semester
    FROM academic_plan_details apd
    JOIN academic_plans ap ON ap.id = apd.academic_plan_id
    JOIN students s ON s.id = ap.student_id
    LEFT JOIN \`user\` u ON u.id = s.user_id
    WHERE apd.course_id = ?
      AND s.program_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM student_transferred_courses stc
        WHERE stc.student_id = s.id AND stc.course_id = apd.course_id
      )
    ORDER BY s.intake_year DESC, s.matric_no ASC`,
    [courseId, programId],
  );
  const students = studentRows as any[];

  // Get which sessions this course appears in
  const [sessions] = await pool.query(
    `SELECT 
      ps.id AS session_id,
      ps.session_name,
      pc.semester,
      pc.course_type
    FROM program_courses pc
    JOIN program_sessions ps ON ps.id = pc.session_id
    WHERE pc.course_id = ?
      AND ps.program_id = ?
    ORDER BY ps.created_at DESC`,
    [courseId, programId],
  );

  return {
    course,
    students,
    sessions,
    total_students: (students as any[]).length,
    session_missing: false,
  };
});
