import { pool } from "../../utils/db";
import { getAcademicPlanSemesterConfigs } from "~~/server/utils/academic-plan-semester-config";
import { getEffectiveSemesterRulePlans } from "~~/server/utils/effective-semester-rule-plans";
import { auth } from "@@/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "STUDENT") {
    throw createError({ statusCode: 403, statusMessage: "Students only" });
  }

  // Get student ID and program
  const [studentRows] = await pool.query(
    "SELECT id, program_id, total_credit_transferred FROM students WHERE user_id = ?",
    [session.user.id],
  );

  const students = studentRows as any[];
  if (students.length === 0) {
    throw createError({ statusCode: 404, statusMessage: "Student not found" });
  }

  const studentId = students[0].id;
  const programId = students[0].program_id;
  const transferredCredits = Number(students[0].total_credit_transferred) || 0;

  // Get academic plan
  const [planRows] = await pool.query(
    `SELECT id, intake_id, start_semester, status, created_at
     FROM academic_plans
     WHERE student_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [studentId],
  );

  const plans = planRows as any[];
  if (plans.length === 0) {
    return { plan: null, courses: [] };
  }

  const plan = plans[0];

  // Get plan details with course info
  const [courseRows] = await pool.query(
    `SELECT 
      apd.semester,
      apd.status,
      apd.grade,
      c.id as course_id,
      c.course_code,
      c.course_name,
      c.credit_hour
    FROM academic_plan_details apd
    JOIN courses c ON apd.course_id = c.id
    WHERE apd.academic_plan_id = ?
    ORDER BY apd.semester, c.course_code`,
    [plan.id],
  );

  // Get submitted result slips
  const [resultSlips] = await pool.query(
    `SELECT semester, result_slip_filename, submitted_at
     FROM semester_results
     WHERE academic_plan_id = ?`,
    [plan.id],
  );

  const planSemesterConfigs = await getAcademicPlanSemesterConfigs(Number(plan.id));
  let semesterMetaRows: Array<{
    semester_number: number;
    semester_type: "L" | "S";
    is_li: boolean;
  }> = planSemesterConfigs.map((config) => ({
    semester_number: Number(config.semester_number),
    semester_type: config.semester_type,
    is_li: !!config.is_li,
  }));

  if (semesterMetaRows.length === 0 && plan.intake_id) {
    const [intakeMetaRows] = await pool.query(
      `SELECT session_id, intake_type
       FROM academic_planning_intakes
       WHERE id = ?
       LIMIT 1`,
      [plan.intake_id],
    );

    const intakeMeta = (intakeMetaRows as any[])[0];
    if (intakeMeta) {
      const effectiveRules = await getEffectiveSemesterRulePlans({
        programId,
        intakeType: intakeMeta.intake_type,
        entrySemester: Number(plan.start_semester) || 1,
        sessionId: Number(intakeMeta.session_id) || null,
        transferredCredits,
      });

      semesterMetaRows = effectiveRules.map((rule) => ({
        semester_number: Number(rule.semester_number),
        semester_type: rule.semester_type,
        is_li: !!rule.is_li,
      }));
    }
  }

  // Get per-intake current_semester for this student's intake
  const [studentIntakeRows] = await pool.query(
    `SELECT api.current_semester
     FROM academic_planning_intakes api
     JOIN students s ON s.program_id = api.program_id AND s.intake_year = api.intake_year
     WHERE s.id = ?
     LIMIT 1`,
    [studentId],
  );
  const intakeCurrentSemester =
    (studentIntakeRows as any[])[0]?.current_semester ?? null;

  return {
    plan: {
      id: plan.id,
      start_semester: plan.start_semester,
      status: plan.status,
      created_at: plan.created_at,
    },
    courses: courseRows,
    resultSlips: resultSlips,
    semesterMeta: semesterMetaRows,
    intakeCurrentSemester,
  };
});
