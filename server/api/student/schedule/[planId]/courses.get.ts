import { pool } from "../../../../utils/db";
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

  // Get semester credit plans for this student's rule
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

  return {
    courses: courseRows,
    semester_rules: semesterRules,
    credit_limits: {
      long_min: program?.long_sem_min_credit ?? 12,
      long_max: program?.long_sem_max_credit ?? 20,
      short_min: program?.short_sem_min_credit ?? 6,
      short_max: program?.short_sem_max_credit ?? 10,
    },
  };
});
