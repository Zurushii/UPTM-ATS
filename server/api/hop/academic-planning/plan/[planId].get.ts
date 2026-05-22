import { pool } from "~~/server/utils/db";
import { getAcademicPlanSemesterConfigs } from "~~/server/utils/academic-plan-semester-config";
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
      api.intake_year,
      api.current_semester
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
      apd.grade,
      c.course_code,
      c.course_name,
      c.credit_hour
    FROM academic_plan_details apd
    JOIN courses c ON apd.course_id = c.id
    WHERE apd.academic_plan_id = ?
    ORDER BY apd.semester, c.course_code`,
    [planId],
  );

  // Group courses by semester and calculate credit totals
  // Retake courses (same course_id appearing as Planned after a Failed entry) are excluded
  // from credit totals since they don't add to the programme's required credit count.
  const coursesBySemester: Record<number, any[]> = {};
  const transferredCourses: Array<{
    course_id: number;
    course_code: string;
    course_name: string;
    credit_hour: number;
    status: string;
    grade: string | null;
    semester: number;
  }> = [];
  let totalCredits = 0;
  let transferredCredits = 0;
  let plannedCredits = 0;
  let totalCourses = 0;
  const scheduledSemesters = new Set<number>();

  // Pre-compute retake course IDs: course_ids that appear as Failed AND later as Planned
  const failedCourseIds = new Set<number>();
  const retakeCourseIds = new Set<number>();
  const sortedDetails = (detailRows as any[]).slice().sort((a: any, b: any) => a.semester - b.semester);
  for (const detail of sortedDetails) {
    if (detail.status === "Failed") {
      failedCourseIds.add(detail.course_id);
    } else if (detail.status === "Passed") {
      failedCourseIds.delete(detail.course_id);
      retakeCourseIds.delete(detail.course_id);
    } else if ((detail.status === "Planned" || !detail.status) && failedCourseIds.has(detail.course_id)) {
      retakeCourseIds.add(detail.course_id);
    }
  }

  for (const detail of detailRows as any[]) {
    const semesterKey = Number(detail.semester);
    const semesterCourses =
      coursesBySemester[semesterKey] || (coursesBySemester[semesterKey] = []);

    semesterCourses.push({
      course_id: detail.course_id,
      course_code: detail.course_code,
      course_name: detail.course_name,
      credit_hour: detail.credit_hour,
      status: detail.status || "Planned",
      grade: detail.grade || null,
    });
    totalCourses++;

    if (detail.status === "Transferred") {
      transferredCourses.push({
        course_id: detail.course_id,
        course_code: detail.course_code,
        course_name: detail.course_name,
        credit_hour: detail.credit_hour,
        status: detail.status || "Planned",
        grade: detail.grade || null,
        semester: semesterKey,
      });
    }

    if (
      detail.semester >= plan.start_semester &&
      detail.status !== "Transferred"
    ) {
      scheduledSemesters.add(detail.semester);
    }

    // Retake entries don't contribute to programme credit totals
    const isRetake = retakeCourseIds.has(detail.course_id) && (detail.status === "Planned" || !detail.status);
    if (isRetake) continue;

    totalCredits += detail.credit_hour;
    if (detail.status === "Transferred") {
      transferredCredits += detail.credit_hour;
    } else {
      plannedCredits += detail.credit_hour;
    }
  }

  const planSemesterConfigs = await getAcademicPlanSemesterConfigs(Number(planId));

  // Convert to array format for easier frontend consumption
  const semesters =
    planSemesterConfigs.length > 0
      ? planSemesterConfigs
          .map((config) => {
            const courses = coursesBySemester[config.semester_number] || [];
            return {
              semester: Number(config.semester_number),
              semester_type: config.semester_type,
              is_li: !!config.is_li,
              courses,
              total_credits: courses.reduce((sum, c) => sum + c.credit_hour, 0),
            };
          })
          .sort((a, b) => a.semester - b.semester)
      : Object.entries(coursesBySemester)
          .map(([semester, courses]) => ({
            semester: parseInt(semester, 10),
            semester_type: null,
            is_li: false,
            courses,
            total_credits: courses.reduce((sum, c) => sum + c.credit_hour, 0),
          }))
          .sort((a, b) => a.semester - b.semester);

  // Get result slips for this plan
  const [resultSlipRows] = await pool.query(
    `SELECT semester, result_slip_filename, submitted_at
     FROM semester_results
     WHERE academic_plan_id = ?
     ORDER BY semester`,
    [planId],
  );

  return {
    plan: {
      id: plan.id,
      intake_id: plan.intake_id,
      status: plan.status,
      start_semester: plan.start_semester,
      created_at: plan.created_at,
      intake_name: plan.intake_name,
      intake_year: plan.intake_year,
      current_semester: plan.current_semester,
    },
    student: {
      id: plan.student_id,
      matric_no: plan.matric_no,
      name: plan.student_name,
      email: plan.email,
      total_credit_transferred: plan.total_credit_transferred,
    },
    semesters,
    transferredCourses: transferredCourses.sort((left, right) => {
      if (left.semester !== right.semester) {
        return left.semester - right.semester;
      }

      return left.course_code.localeCompare(right.course_code);
    }),
    resultSlips: resultSlipRows as any[],
    summary: {
      total_semesters: semesters.filter((semester) => semester.semester >= plan.start_semester).length,
      total_credits: totalCredits,
      transferred_credits: transferredCredits,
      planned_credits: plannedCredits,
      total_courses: totalCourses,
    },
  };
});
