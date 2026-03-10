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

  // Verify the plan exists and get intake info + student's starting semester
  const [planRows] = await pool.query(
    `SELECT ap.intake_id, ap.start_semester
     FROM academic_plans ap
     JOIN students s ON ap.student_id = s.id
     WHERE ap.id = ? AND s.program_id = ?`,
    [planId, programId],
  );

  if ((planRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Academic plan not found",
    });
  }

  const intakeId = (planRows as any[])[0].intake_id;
  const startSemester = (planRows as any[])[0].start_semester;

  // Get session_id and intake_type from intake
  const [intakeRows] = await pool.query(
    `SELECT session_id, intake_type FROM academic_planning_intakes WHERE id = ?`,
    [intakeId],
  );

  if ((intakeRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Intake not found",
    });
  }

  const sessionId = (intakeRows as any[])[0].session_id;
  const intakeType = (intakeRows as any[])[0].intake_type;

  // Get all available courses from program structure
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

  // Get semester credit plans for this student's rule
  // Find the rule that matches this intake_type and the student's starting_semester
  const [ruleRows] = await pool.query(
    `SELECT ser.id AS rule_id
     FROM semester_entry_rules ser
     WHERE ser.program_id = ? AND ser.intake_type = ? AND ser.entry_semester = ?
     LIMIT 1`,
    [programId, intakeType, startSemester],
  );

  let semesterRules: any[] = [];

  if ((ruleRows as any[]).length > 0) {
    const ruleId = (ruleRows as any[])[0].rule_id;

    const [creditPlans] = await pool.query(
      `SELECT semester_number, semester_type, is_li, target_credits
       FROM semester_credit_plans
       WHERE rule_id = ?
       ORDER BY semester_number ASC`,
      [ruleId],
    );

    semesterRules = creditPlans as any[];
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

  // If no matching rule found AND student starts at semester 1,
  // infer semester types from program structure credits.
  // Students with entry_semester > 1 must rely on HOP-configured rules.
  if (semesterRules.length === 0 && program && startSemester === 1) {
    const shortMin = program.short_sem_min_credit ?? 6;
    const shortMax = program.short_sem_max_credit ?? 10;

    // Detect which semesters contain Industrial Training courses
    const [liSemRows] = await pool.query(
      `SELECT DISTINCT pc.semester
       FROM program_courses pc
       WHERE pc.session_id = ? AND pc.course_type = 'Industrial Training'`,
      [sessionId],
    );
    const liSemesters = new Set(
      (liSemRows as any[]).map((r: any) => r.semester),
    );

    // Get total credits per semester from program structure
    // For grouped courses (e.g. MPU electives), only count one per group
    const [semCredits] = await pool.query(
      `SELECT semester, SUM(credit_hour) AS total_credits FROM (
        SELECT pc.semester, c.credit_hour
        FROM program_courses pc
        JOIN courses c ON pc.course_id = c.id
        WHERE pc.session_id = ? AND pc.course_group IS NULL
        UNION ALL
        SELECT pc.semester, MAX(c.credit_hour) AS credit_hour
        FROM program_courses pc
        JOIN courses c ON pc.course_id = c.id
        WHERE pc.session_id = ? AND pc.course_group IS NOT NULL
        GROUP BY pc.semester, pc.course_group
      ) combined
      GROUP BY semester
      ORDER BY semester ASC`,
      [sessionId, sessionId],
    );

    for (const row of semCredits as any[]) {
      const credits = Number(row.total_credits);
      const isLi = liSemesters.has(row.semester);
      // LI semesters are always Long type; otherwise infer from credits
      const semType = isLi
        ? "L"
        : credits >= shortMin && credits <= shortMax
          ? "S"
          : "L";

      semesterRules.push({
        semester_number: row.semester,
        semester_type: semType,
        is_li: isLi,
        target_credits: credits,
      });
    }
  }

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
  // Detect the program's cycle pattern (L/L/S or S/L/L) from existing non-LI rules
  if ((failedRows as any[]).length > 0) {
    const lastSem = maxProgramSemester;
    // Detect cycle: count L vs S at each modulo-3 position from non-LI semesters
    const posLong = [0, 0, 0];
    const posTotal = [0, 0, 0];
    for (const r of semesterRules) {
      if (!r.is_li) {
        const pos = (r.semester_number - 1) % 3;
        posTotal[pos]++;
        if (r.semester_type === "L") posLong[pos]++;
      }
    }
    const cycle = posTotal.map((total, i) =>
      total === 0 ? "L" : posLong[i] >= total / 2 ? "L" : "S",
    );
    for (let i = 1; i <= 3; i++) {
      const semNum = lastSem + i;
      if (!semesterRules.find((r: any) => r.semester_number === semNum)) {
        const semType = cycle[(semNum - 1) % 3];
        semesterRules.push({
          semester_number: semNum,
          semester_type: semType,
          is_li: false,
          target_credits: semType === "S" ? shortMin2 : longMin,
        });
      }
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
