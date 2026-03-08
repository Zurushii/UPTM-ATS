import { pool } from "../../utils/db";
import { auth } from "@@/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "STUDENT") {
    throw createError({ statusCode: 403, statusMessage: "Student only" });
  }

  // Get student record
  const [studentRows] = await pool.query(
    `SELECT s.id, s.program_id FROM students s WHERE s.user_id = ?`,
    [session.user.id],
  );

  const student = (studentRows as any[])[0];
  if (!student) {
    throw createError({
      statusCode: 404,
      statusMessage: "Student profile not found",
    });
  }

  // Get latest academic plan
  const [planRows] = await pool.query(
    `SELECT id, start_semester, status FROM academic_plans WHERE student_id = ? ORDER BY created_at DESC LIMIT 1`,
    [student.id],
  );

  const plan = (planRows as any[])[0];
  if (!plan) {
    return { plan: null, semesters: [] };
  }

  // Get all planned courses grouped by semester with their result status
  const [courses] = await pool.query(
    `SELECT 
      apd.id AS detail_id,
      apd.course_id,
      apd.semester,
      apd.status,
      c.course_code,
      c.course_name,
      c.credit_hour
    FROM academic_plan_details apd
    JOIN courses c ON c.id = apd.course_id
    WHERE apd.academic_plan_id = ?
      AND apd.status != 'Transferred'
    ORDER BY apd.semester ASC, c.course_code ASC`,
    [plan.id],
  );

  // Get submitted result slips
  const [results] = await pool.query(
    `SELECT semester, result_slip_filename, submitted_at
     FROM semester_results
     WHERE academic_plan_id = ?`,
    [plan.id],
  );

  // Build semester summary
  const resultMap = new Map<number, any>();
  for (const r of results as any[]) {
    resultMap.set(r.semester, r);
  }

  const semesterMap = new Map<number, any[]>();
  for (const c of courses as any[]) {
    if (!semesterMap.has(c.semester)) semesterMap.set(c.semester, []);
    semesterMap.get(c.semester)!.push(c);
  }

  const semesters = Array.from(semesterMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([semester, semCourses]) => {
      const result = resultMap.get(semester);
      const passedCount = semCourses.filter(
        (c: any) => c.status === "Passed",
      ).length;
      const failedCount = semCourses.filter(
        (c: any) => c.status === "Failed",
      ).length;
      const totalCourses = semCourses.length;
      const hasResult = passedCount + failedCount > 0;

      return {
        semester,
        courses: semCourses,
        total_courses: totalCourses,
        passed: passedCount,
        failed: failedCount,
        has_result: hasResult,
        result_slip: result
          ? {
              filename: result.result_slip_filename,
              submitted_at: result.submitted_at,
            }
          : null,
      };
    });

  return {
    plan: {
      id: plan.id,
      status: plan.status,
      start_semester: plan.start_semester,
    },
    semesters,
  };
});
