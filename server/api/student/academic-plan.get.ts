import { pool } from "../../utils/db";
import { ensureSemesterOneRulePlansBackfilled } from "~~/server/utils/semester-rule-plans";
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

  // Get academic plan
  const [planRows] = await pool.query(
    `SELECT id, start_semester, status, created_at
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

  // Get semester type metadata for this program
  const [semesterMetaRows] = await pool.query(
    `SELECT scp.semester_number, scp.semester_type, scp.is_li
     FROM semester_credit_plans scp
     JOIN semester_entry_rules ser ON scp.rule_id = ser.id
     WHERE ser.program_id = ?
     GROUP BY scp.semester_number, scp.semester_type, scp.is_li
     ORDER BY scp.semester_number`,
    [programId],
  );

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
