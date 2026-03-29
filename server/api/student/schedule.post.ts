import { pool } from "../../utils/db";
import { auth } from "@@/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "STUDENT") {
    throw createError({ statusCode: 403, statusMessage: "Students only" });
  }

  const body = await readBody(event);
  const { plan_id, semester, courses } = body;

  if (!plan_id || semester === undefined || !courses) {
    throw createError({
      statusCode: 400,
      statusMessage: "plan_id, semester, and courses are required",
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

  // Verify this plan belongs to the student and is draft
  const [planRows] = await pool.query(
    `SELECT ap.id, ap.status, ap.intake_id, ap.start_semester
     FROM academic_plans ap
     WHERE ap.id = ? AND ap.student_id = ?`,
    [plan_id, studentId],
  );

  if ((planRows as any[]).length === 0) {
    throw createError({ statusCode: 404, statusMessage: "Plan not found" });
  }

  const plan = (planRows as any[])[0];

  if (plan.status !== "draft") {
    throw createError({
      statusCode: 400,
      statusMessage: "Can only modify plans in draft status",
    });
  }

  // CGPA-based credit limit validation
  if (courses.length > 0) {
    // Calculate total credits for the new courses being assigned
    const courseIds = courses.map((c: any) => c.course_id);
    const [courseInfoRows] = await pool.query(
      `SELECT id, credit_hour FROM courses WHERE id IN (?)`,
      [courseIds],
    );
    const courseCredits = new Map(
      (courseInfoRows as any[]).map((r: any) => [r.id, r.credit_hour]),
    );

    // Also count locked courses (Passed/Failed) already in this semester
    const [lockedRows] = await pool.query(
      `SELECT c.credit_hour
       FROM academic_plan_details apd
       JOIN courses c ON apd.course_id = c.id
       WHERE apd.academic_plan_id = ? AND apd.semester = ? AND apd.status IN ('Passed', 'Failed')`,
      [plan_id, semester],
    );
    const lockedCredits = (lockedRows as any[]).reduce(
      (sum: number, r: any) => sum + r.credit_hour,
      0,
    );

    let newCredits = 0;
    for (const c of courses) {
      newCredits += courseCredits.get(c.course_id) || 0;
    }
    const totalSemCredits = newCredits + lockedCredits;

    // Calculate student's CGPA
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
      [plan_id],
    );

    let cgpa: number | null = null;
    const gradedCourses = gradedRows as any[];
    if (gradedCourses.length > 0) {
      let totalPoints = 0;
      let totalCr = 0;
      for (const row of gradedCourses) {
        const gp = gradePointMap[row.grade?.toUpperCase()];
        if (gp !== undefined) {
          totalPoints += gp * row.credit_hour;
          totalCr += row.credit_hour;
        }
      }
      if (totalCr > 0) cgpa = totalPoints / totalCr;
    }

    // Get program credit limits
    const [progRows] = await pool.query(
      `SELECT long_sem_min_credit, long_sem_max_credit, short_sem_min_credit, short_sem_max_credit
       FROM programs WHERE id = ?`,
      [programId],
    );
    const prog = (progRows as any[])[0];

    if (prog) {
      // Determine semester type from intake rules
      const [intakeRows] = await pool.query(
        `SELECT intake_type FROM academic_planning_intakes WHERE id = ?`,
        [plan.intake_id],
      );
      const intakeType = (intakeRows as any[])[0]?.intake_type;

      let semType: string | null = null;
      let isLi = false;
      if (intakeType) {
        const [ruleRows] = await pool.query(
          `SELECT ser.id AS rule_id FROM semester_entry_rules ser
           WHERE ser.program_id = ? AND ser.intake_type = ? AND ser.entry_semester = ?
           LIMIT 1`,
          [programId, intakeType, plan.start_semester],
        );
        if ((ruleRows as any[]).length > 0) {
          const [planRows2] = await pool.query(
            `SELECT semester_type, is_li FROM semester_credit_plans
             WHERE rule_id = ? AND semester_number = ?`,
            [(ruleRows as any[])[0].rule_id, semester],
          );
          if ((planRows2 as any[]).length > 0) {
            semType = (planRows2 as any[])[0].semester_type;
            isLi = !!(planRows2 as any[])[0].is_li;
          }
        }
      }

      // Skip validation for LI semesters
      if (!isLi && semType) {
        const onProbation = cgpa !== null && cgpa < 2.5;
        let maxCredits: number;
        let minCredits: number;
        if (semType === "L") {
          maxCredits = onProbation
            ? prog.long_sem_min_credit
            : prog.long_sem_max_credit;
          minCredits = prog.long_sem_min_credit;
        } else {
          maxCredits = onProbation
            ? prog.short_sem_min_credit
            : prog.short_sem_max_credit;
          minCredits = prog.short_sem_min_credit;
        }

        if (totalSemCredits > maxCredits) {
          throw createError({
            statusCode: 400,
            statusMessage: onProbation
              ? `CGPA below 2.5: maximum ${maxCredits} credit hours allowed for this semester`
              : `Maximum ${maxCredits} credit hours allowed for this semester`,
          });
        }

        // FIX Bug #4: also enforce minimum credit requirement
        if (totalSemCredits > 0 && totalSemCredits < minCredits) {
          throw createError({
            statusCode: 400,
            statusMessage: `Minimum ${minCredits} credit hours required for this semester type (${semType === "L" ? "Long" : "Short"})`,
          });
        }
      }
    }
  }

  // Delete existing planned courses for this semester (keep transferred, passed, failed)
  await pool.query(
    `DELETE FROM academic_plan_details 
     WHERE academic_plan_id = ? AND semester = ? AND status = 'Planned'`,
    [plan_id, semester],
  );

  // Insert new courses
  if (courses.length > 0) {
    const values = courses.map((c: any) => [
      plan_id,
      c.course_id,
      semester,
      c.status || "Planned",
    ]);

    await pool.query(
      `INSERT INTO academic_plan_details (academic_plan_id, course_id, semester, status)
       VALUES ?`,
      [values],
    );
  }

  return {
    success: true,
    message: `Schedule updated for semester ${semester}`,
    semester,
    courses_count: courses.length,
  };
});
