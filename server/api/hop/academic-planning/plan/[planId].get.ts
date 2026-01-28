import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";

export default defineEventHandler(async (event) => {
  // Authenticate user
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
  }

  const planId = getRouterParam(event, "planId");
  if (!planId) {
    throw createError({ statusCode: 400, statusMessage: "Plan ID required" });
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

  // Get the academic plan with student info
  const [planRows] = await pool.query(
    `SELECT 
      ap.id,
      ap.student_id,
      ap.intake_id,
      ap.start_semester,
      ap.status,
      ap.created_at,
      s.matric_no,
      u.name AS student_name,
      u.email,
      s.total_credit_transferred,
      api.intake_name,
      api.intake_year
    FROM academic_plans ap
    JOIN students s ON ap.student_id = s.id
    JOIN user u ON s.user_id = u.id
    LEFT JOIN academic_planning_intakes api ON ap.intake_id = api.id
    WHERE ap.id = ? AND s.program_id = ?`,
    [planId, programId],
  );

  if ((planRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Academic plan not found",
    });
  }

  const plan = (planRows as any[])[0];

  // Get the plan details (courses by semester) with status
  const [detailRows] = await pool.query(
    `SELECT 
      apd.id,
      apd.semester,
      apd.course_id,
      apd.status,
      c.course_code,
      c.course_name,
      c.credit_hour
    FROM academic_plan_details apd
    JOIN courses c ON apd.course_id = c.id
    WHERE apd.academic_plan_id = ?
    ORDER BY apd.semester, c.course_code`,
    [planId],
  );

  // Group courses by semester
  const coursesBySemester: Record<number, any[]> = {};
  let totalCredits = 0;
  let transferredCredits = 0;
  let plannedCredits = 0;
  let totalCourses = 0;

  for (const detail of detailRows as any[]) {
    if (!coursesBySemester[detail.semester]) {
      coursesBySemester[detail.semester] = [];
    }
    coursesBySemester[detail.semester].push({
      course_id: detail.course_id,
      course_code: detail.course_code,
      course_name: detail.course_name,
      credit_hour: detail.credit_hour,
      status: detail.status || 'Planned',
    });
    totalCredits += detail.credit_hour;
    totalCourses++;
    
    if (detail.status === 'Transferred') {
      transferredCredits += detail.credit_hour;
    } else {
      plannedCredits += detail.credit_hour;
    }
  }

  // Convert to array format for easier frontend consumption
  const semesters = Object.entries(coursesBySemester)
    .map(([semester, courses]) => ({
      semester: parseInt(semester),
      courses,
      total_credits: courses.reduce((sum, c) => sum + c.credit_hour, 0),
    }))
    .sort((a, b) => a.semester - b.semester);

  return {
    plan: {
      id: plan.id,
      status: plan.status,
      start_semester: plan.start_semester,
      created_at: plan.created_at,
      intake_name: plan.intake_name,
      intake_year: plan.intake_year,
    },
    student: {
      id: plan.student_id,
      matric_no: plan.matric_no,
      name: plan.student_name,
      email: plan.email,
      total_credit_transferred: plan.total_credit_transferred,
    },
    semesters,
    summary: {
      total_semesters: semesters.length,
      total_credits: totalCredits,
      transferred_credits: transferredCredits,
      planned_credits: plannedCredits,
      total_courses: totalCourses,
    },
  };
});
