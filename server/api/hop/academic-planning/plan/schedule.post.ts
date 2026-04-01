import { pool } from "~~/server/utils/db";
import {
  ensureSemesterOneRulePlansBackfilled,
  getSemesterRuleMetaForSemester,
} from "~~/server/utils/semester-rule-plans";
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

  // Get request body
  const body = await readBody(event);
  const { plan_id, semester, courses } = body;

  if (!plan_id) {
    throw createError({
      statusCode: 400,
      statusMessage: "plan_id is required",
    });
  }

  if (!semester || typeof semester !== "number" || semester < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "semester must be a positive number",
    });
  }

  if (!courses || !Array.isArray(courses)) {
    throw createError({
      statusCode: 400,
      statusMessage: "courses must be an array of { course_id, status }",
    });
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

  await ensureSemesterOneRulePlansBackfilled(programId);

  // Verify the plan exists and belongs to a student in this program
  const [planRows] = await pool.query(
    `SELECT ap.id, ap.status, ap.intake_id, api.status AS intake_status
     FROM academic_plans ap
     JOIN students s ON ap.student_id = s.id
     LEFT JOIN academic_planning_intakes api ON ap.intake_id = api.id
     WHERE ap.id = ? AND s.program_id = ?`,
    [plan_id, programId],
  );

  if ((planRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Academic plan not found",
    });
  }

  const plan = (planRows as any[])[0];

  if (plan.intake_status === "completed") {
    throw createError({
      statusCode: 400,
      statusMessage: "Cannot modify schedule for an intake that has been marked as completed",
    });
  }

  // Only allow scheduling for draft plans
  if (plan.status !== "draft") {
    throw createError({
      statusCode: 400,
      statusMessage: "Can only modify courses for plans in draft status",
    });
  }

  // CGPA-based credit limit validation
  if (courses.length > 0) {
    // Calculate total credits for new courses
    const courseIds = courses.map((c: any) => c.course_id);
    const [courseInfoRows] = await pool.query(
      `SELECT id, credit_hour FROM courses WHERE id IN (?)`,
      [courseIds],
    );
    const courseCredits = new Map(
      (courseInfoRows as any[]).map((r: any) => [r.id, r.credit_hour]),
    );

    // Count locked courses (Passed/Failed) already in this semester
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
      const [intakeRows2] = await pool.query(
        `SELECT intake_type, session_id FROM academic_planning_intakes WHERE id = ?`,
        [plan.intake_id],
      );
      const intakeType = (intakeRows2 as any[])[0]?.intake_type;
      const sessionId = (intakeRows2 as any[])[0]?.session_id || null;

      // Get start_semester for the plan
      const [planInfo] = await pool.query(
        `SELECT start_semester FROM academic_plans WHERE id = ?`,
        [plan_id],
      );
      const startSemester = (planInfo as any[])[0]?.start_semester || 1;

      const semesterMeta = intakeType
        ? await getSemesterRuleMetaForSemester({
            programId,
            intakeType,
            entrySemester: startSemester,
            sessionId,
            semester,
          })
        : null;
      const semType = semesterMeta?.semester_type || null;
      const isLi = !!semesterMeta?.is_li;

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

  // Get session_id from intake to validate courses belong to the program
  const [intakeRows] = await pool.query(
    `SELECT session_id FROM academic_planning_intakes WHERE id = ?`,
    [plan.intake_id],
  );

  if ((intakeRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Intake not found",
    });
  }

  const sessionId = (intakeRows as any[])[0].session_id;

  // Validate all course_ids belong to the program's session
  const courseIds = courses.map((c: any) => c.course_id);
  if (courseIds.length > 0) {
    const [validCourses] = await pool.query(
      `SELECT pc.course_id 
       FROM program_courses pc
       WHERE pc.session_id = ? AND pc.course_id IN (?)`,
      [sessionId, courseIds],
    );

    const validCourseIds = new Set(
      (validCourses as any[]).map((c) => c.course_id),
    );
    const invalidCourses = courseIds.filter(
      (id: number) => !validCourseIds.has(id),
    );

    if (invalidCourses.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid course IDs: ${invalidCourses.join(", ")}`,
      });
    }
  }

  // Start transaction
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Delete existing PLANNED courses for this semester (preserve Transferred, Passed, Failed)
    await connection.query(
      `DELETE FROM academic_plan_details WHERE academic_plan_id = ? AND semester = ? AND status = 'Planned'`,
      [plan_id, semester],
    );

    // Insert new courses for this semester
    if (courses.length > 0) {
      for (const course of courses) {
        await connection.query(
          `INSERT INTO academic_plan_details (academic_plan_id, course_id, semester, status)
           VALUES (?, ?, ?, ?)`,
          [plan_id, course.course_id, semester, course.status || "Planned"],
        );
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    success: true,
    message: `Semester ${semester} courses updated successfully`,
    plan_id,
    semester,
    courses_count: courses.length,
  };
});
