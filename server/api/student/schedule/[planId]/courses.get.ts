import { pool } from "../../../../utils/db";
import { auth } from "@@/utils/auth";
import { getAcademicPlanSemesterConfigs } from "~~/server/utils/academic-plan-semester-config";
import {
  ensureSemesterOneRulePlansBackfilled,
  getEffectiveSemesterRulePlans,
  getIntakeLifecyclePattern,
} from "~~/server/utils/semester-rule-plans";

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
    throw createError({
      statusCode: 400,
      statusMessage: "Plan ID is required",
    });
  }

  // Get student ID and program_id
  const [studentRows] = await pool.query(
    "SELECT id, program_id FROM students WHERE user_id = ?",
    [session.user.id],
  );

  const students = studentRows as any[];
  if (students.length === 0) {
    throw createError({ statusCode: 404, statusMessage: "Student not found" });
  }

  const studentId = students[0].id;
  const programId = students[0].program_id;

  await ensureSemesterOneRulePlansBackfilled(programId);

  // Verify this plan belongs to the student and get intake_id + start_semester
  const [planRows] = await pool.query(
    `SELECT ap.id, ap.intake_id, ap.start_semester
     FROM academic_plans ap
     WHERE ap.id = ? AND ap.student_id = ?`,
    [planId, studentId],
  );

  if ((planRows as any[]).length === 0) {
    throw createError({ statusCode: 404, statusMessage: "Plan not found" });
  }

  const plan = (planRows as any[])[0];
  const startSemester = plan.start_semester;

  // Get session_id and intake_type from intake
  const [intakeRows] = await pool.query(
    `SELECT session_id, intake_type FROM academic_planning_intakes WHERE id = ?`,
    [plan.intake_id],
  );

  if ((intakeRows as any[]).length === 0) {
    throw createError({ statusCode: 404, statusMessage: "Intake not found" });
  }

  const sessionId = (intakeRows as any[])[0].session_id;
  const intakeType = (intakeRows as any[])[0].intake_type;
  const numericPlanId = Number(planId);

  // Get available courses from program structure for this session
  const [courseRows] = await pool.query(
    `SELECT 
      c.id AS course_id,
      c.course_code,
      c.course_name,
      c.credit_hour,
      pc.semester AS default_semester,
      pc.course_type,
      pc.course_group,
      pc.prerequisite_course_id,
      prereq.course_code AS prerequisite_code
    FROM program_courses pc
    JOIN courses c ON pc.course_id = c.id
    LEFT JOIN courses prereq ON pc.prerequisite_course_id = prereq.id
    WHERE pc.session_id = ?
    ORDER BY pc.semester, c.course_code`,
    [sessionId],
  );

  let semesterRules: any[] = [];
  const planSpecificRules = await getAcademicPlanSemesterConfigs(numericPlanId);
  const hasPlanSpecificRules = planSpecificRules.length > 0;

  if (hasPlanSpecificRules) {
    semesterRules = planSpecificRules;
  } else {
    semesterRules = await getEffectiveSemesterRulePlans({
      programId,
      intakeType,
      entrySemester: startSemester,
      sessionId,
    });
  }

  // Get program info (credit limits + duration)
  const [programRows] = await pool.query(
    `SELECT long_sem_min_credit, long_sem_max_credit, short_sem_min_credit, short_sem_max_credit, duration_semesters
     FROM programs WHERE id = ?`,
    [programId],
  );

  const program = (programRows as any[])[0];

  // Calculate student's current CGPA from graded courses (grade replacement: latest entry per course)
  const [gradedRows] = await pool.query(
    `SELECT apd.grade, c.credit_hour
     FROM academic_plan_details apd
     JOIN courses c ON apd.course_id = c.id
     WHERE apd.academic_plan_id = ?
       AND apd.status IN ('Passed', 'Failed')
       AND apd.grade IS NOT NULL
       AND apd.id = (
         SELECT MAX(apd2.id) FROM academic_plan_details apd2
         WHERE apd2.academic_plan_id = apd.academic_plan_id
           AND apd2.course_id = apd.course_id
           AND apd2.status IN ('Passed', 'Failed')
           AND apd2.grade IS NOT NULL
       )`,
    [planId],
  );

  const gradePointMap: Record<string, number> = {
    "A+": 4.0,
    A: 4.0,
    "A-": 3.67,
    "B+": 3.33,
    B: 3.0,
    "B-": 2.67,
    "C+": 2.33,
    C: 2.0,
    "C-": 1.67,
    "D+": 1.33,
    D: 1.0,
    F: 0.0,
  };

  let cgpa: number | null = null;
  const gradedCourses = gradedRows as any[];
  if (gradedCourses.length > 0) {
    let totalPoints = 0;
    let totalCredits = 0;
    for (const row of gradedCourses) {
      const gp = gradePointMap[row.grade?.toUpperCase()];
      if (gp !== undefined) {
        totalPoints += gp * row.credit_hour;
        totalCredits += row.credit_hour;
      }
    }
    if (totalCredits > 0) {
      cgpa = totalPoints / totalCredits;
    }
  }

  // ── INTAKE-BASED DYNAMIC SEMESTER CYCLES (mirrors generate.post.ts & HOP courses.get.ts) ──
  const baseCyclePattern = getIntakeLifecyclePattern(intakeType);

  const longMin = program?.long_sem_min_credit ?? 12;
  const longMax = program?.long_sem_max_credit ?? 20;
  const shortMin2 = program?.short_sem_min_credit ?? 6;
  const shortMax2 = program?.short_sem_max_credit ?? 10;

  // CGPA < 2.5: restrict max credits to minimum for each semester type
  const onProbation = cgpa !== null && cgpa < 2.5;

  // Get failed courses that need retaking (Failed but not also Passed in another entry)
  const [failedRows] = await pool.query(
    `SELECT DISTINCT apd.course_id, c.course_code, c.course_name, c.credit_hour,
            pc.semester AS default_semester, pc.course_type, pc.course_group,
            pc.prerequisite_course_id, prereq.course_code AS prerequisite_code
     FROM academic_plan_details apd
     JOIN courses c ON apd.course_id = c.id
     JOIN program_courses pc ON pc.course_id = c.id AND pc.session_id = ?
     LEFT JOIN courses prereq ON pc.prerequisite_course_id = prereq.id
     WHERE apd.academic_plan_id = ? AND apd.status = 'Failed'
       AND apd.course_id NOT IN (
         SELECT course_id FROM academic_plan_details
         WHERE academic_plan_id = ? AND status = 'Passed'
       )`,
    [sessionId, planId, planId],
  );

  // Get max semester from semester rules for extension logic
  const maxProgramSemester =
    semesterRules.length > 0
      ? Math.max(...semesterRules.map((r: any) => r.semester_number))
      : 12;

  // Auto-extend semester rules if retake courses exist beyond max program semester
  // FIX Bug #2: use intake-derived baseCyclePattern with relative offset (startSemester),
  // matching the same formula used in generate.post.ts and HOP courses.get.ts.
  if (!hasPlanSpecificRules && ((failedRows as any[]).length > 0 || onProbation)) {
    const lastSem = maxProgramSemester;
    // Add 3 extra semesters for retake scheduling room
    for (let i = 1; i <= 3; i++) {
      const semNum = lastSem + i;
      if (!semesterRules.find((r: any) => r.semester_number === semNum)) {
        const semType = baseCyclePattern[(semNum - startSemester) % 3];
        semesterRules.push({
          semester_number: semNum,
          semester_type: semType,
          is_li: false,
          target_credits: semType === "S" ? shortMin2 : longMin,
        });
      }
    }
  }

  // Auto-extend semester rules for semesters that exist in the plan's course
  // assignments but are beyond the configured rules (from auto-extend during generation).
  // Also detect if an IT course landed in an extra semester (mark it as LI).
  const [planDetailSems] = await pool.query(
    `SELECT apd.semester,
            MAX(CASE WHEN pc.course_type = 'Industrial Training' THEN 1 ELSE 0 END) AS has_it
     FROM academic_plan_details apd
     LEFT JOIN program_courses pc ON pc.course_id = apd.course_id AND pc.session_id = ?
     WHERE apd.academic_plan_id = ?
     GROUP BY apd.semester
     ORDER BY apd.semester ASC`,
    [sessionId, planId],
  );

  const existingRuleSems = new Set(
    semesterRules.map((r: any) => r.semester_number),
  );

  // Build a map of semester → has_it from plan details
  const semHasIt = new Map<number, boolean>();
  for (const row of planDetailSems as any[]) {
    semHasIt.set(Number(row.semester), row.has_it === 1);
  }

  const defaultLiSemesters = new Set<number>(
    (courseRows as any[])
      .filter((row: any) => row.course_type === "Industrial Training")
      .map((row: any) => Number(row.default_semester)),
  );
  const actualLiSemesters = new Set<number>(
    (planDetailSems as any[])
      .filter((row: any) => row.has_it === 1)
      .map((row: any) => Number(row.semester)),
  );
  const authoritativeLiSemesters =
    actualLiSemesters.size > 0 ? actualLiSemesters : defaultLiSemesters;

  for (const rule of semesterRules) {
    if (authoritativeLiSemesters.has(Number(rule.semester_number))) {
      rule.is_li = true;
      rule.semester_type = "L";
    }
  }

  // If a configured LI semester now has NO IT courses assigned (e.g., IT moved to
  // an auto-extended later semester), flip it back to a regular Long semester.
  if (!hasPlanSpecificRules) {
    for (const rule of semesterRules) {
      if (rule.is_li) {
        const hasIt = semHasIt.get(rule.semester_number);
        // hasIt === false means semester exists in plan but has no IT courses
        // hasIt === undefined means semester has no courses at all
        // In both cases, revert to regular Long semester (auto-extend may have
        // moved the IT course to a later semester)
        if (hasIt !== true) {
          rule.is_li = false;
          rule.semester_type = "L";
        }
      }
    }
  }

  // Apply the intake's physical cycle to any newly discovered trailing semesters
  for (const row of planDetailSems as any[]) {
    const semNum = Number(row.semester);
    if (!existingRuleSems.has(semNum) && semNum >= startSemester) {
      const hasIt = row.has_it === 1;
      const semType = hasIt ? "L" : baseCyclePattern[(semNum - startSemester) % 3];
      semesterRules.push({
        semester_number: semNum,
        semester_type: semType,
        is_li: hasIt,
        target_credits: 0,
      });
      existingRuleSems.add(semNum);
    }
  }

  return {
    courses: courseRows,
    semester_rules: semesterRules,
    credit_limits: {
      long_min: longMin,
      long_max: onProbation ? longMin : longMax,
      short_min: shortMin2,
      short_max: onProbation ? shortMin2 : shortMax2,
    },
    base_credit_limits: {
      long_min: longMin,
      long_max: longMax,
      short_min: shortMin2,
      short_max: shortMax2,
    },
    cgpa: cgpa !== null ? parseFloat(cgpa.toFixed(2)) : null,
    on_probation: onProbation,
    retake_courses: failedRows,
    max_program_semester: maxProgramSemester,
  };
});
