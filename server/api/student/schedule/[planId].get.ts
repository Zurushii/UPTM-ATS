import { pool } from "../../../utils/db";
import { auth } from "@@/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "STUDENT") {
    throw createError({ statusCode: 403, statusMessage: "Students only" });
  }

  const planId = getRouterParam(event, "planId");

  if (!planId) {
    throw createError({ statusCode: 400, statusMessage: "Plan ID is required" });
  }

  // Get student ID
  const [studentRows] = await pool.query(
    "SELECT id FROM students WHERE user_id = ?",
    [session.user.id],
  );

  const students = studentRows as any[];
  if (students.length === 0) {
    throw createError({ statusCode: 404, statusMessage: "Student not found" });
  }

  const studentId = students[0].id;

  // Verify this plan belongs to the student
  const [planRows] = await pool.query(
    `SELECT ap.id, ap.status, ap.start_semester, ap.created_at
     FROM academic_plans ap
     WHERE ap.id = ? AND ap.student_id = ?`,
    [planId, studentId],
  );

  if ((planRows as any[]).length === 0) {
    throw createError({ statusCode: 404, statusMessage: "Plan not found" });
  }

  const plan = (planRows as any[])[0];

  // Get plan details (courses by semester)
  const [detailRows] = await pool.query(
    `SELECT 
      apd.semester,
      apd.status,
      c.id as course_id,
      c.course_code,
      c.course_name,
      c.credit_hour
    FROM academic_plan_details apd
    JOIN courses c ON apd.course_id = c.id
    WHERE apd.academic_plan_id = ?
    ORDER BY apd.semester, c.course_code`,
    [planId],
  );

  // Group by semester
  const semesterMap = new Map<number, any[]>();
  for (const row of detailRows as any[]) {
    if (!semesterMap.has(row.semester)) {
      semesterMap.set(row.semester, []);
    }
    semesterMap.get(row.semester)!.push({
      course_id: row.course_id,
      course_code: row.course_code,
      course_name: row.course_name,
      credit_hour: row.credit_hour,
      status: row.status,
    });
  }

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

  // Build semesters array
  const semesters = [];
  let transferredCredits = 0;
  let plannedCredits = 0;
  let totalCourses = 0;

  for (const [semester, courses] of semesterMap) {
    const semCredits = courses.reduce((sum: number, c: any) => sum + c.credit_hour, 0);
    semesters.push({
      semester,
      courses,
      total_credits: semCredits,
    });
    
    for (const course of courses) {
      // All course appearances count towards totalCourses (it's measuring number of entries)
      totalCourses++;

      // Retake entries don't contribute to programme credit totals
      const isRetake = retakeCourseIds.has(course.course_id) && (course.status === "Planned" || !course.status);
      if (isRetake) continue;

      if (course.status === "Transferred") {
        transferredCredits += course.credit_hour;
      } else {
        plannedCredits += course.credit_hour;
      }
    }
  }

  semesters.sort((a, b) => a.semester - b.semester);

  return {
    plan: {
      id: plan.id,
      status: plan.status,
      start_semester: plan.start_semester,
      created_at: plan.created_at,
    },
    semesters,
    summary: {
      total_semesters: semesters.length,
      total_credits: transferredCredits + plannedCredits,
      transferred_credits: transferredCredits,
      planned_credits: plannedCredits,
      total_courses: totalCourses,
    },
  };
});
