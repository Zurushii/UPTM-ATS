import { pool } from "~~/server/utils/db";
import {
  getEffectiveSemesterRulePlans,
} from "~~/server/utils/effective-semester-rule-plans";
import {
  getEffectiveSemesterRuleAllowanceMap,
} from "~~/server/utils/effective-semester-rule-allowances";
import {
  getAcademicPlanSemesterConfigs,
  replaceAcademicPlanSemesterConfigs,
} from "~~/server/utils/academic-plan-semester-config";
import { auth } from "~~/utils/auth";

interface ScheduleCourseInput {
  course_id: number;
  status?: string;
}

interface CreditExceptionPayload {
  semester: number;
  semester_type: "L" | "S";
  total_credits: number;
  recommended_min: number;
  recommended_max: number;
  effective_max: number;
  on_probation: boolean;
  exception_type: "under" | "over";
}

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
  }

  const body = await readBody<{
    plan_id?: number;
    semester?: number;
    courses?: ScheduleCourseInput[];
    accept_credit_exception?: boolean;
    credit_exception_reason?: string | null;
  }>(event);

  const planId = Number(body.plan_id);
  const semester = Number(body.semester);
  const courses = Array.isArray(body.courses) ? body.courses : null;
  const acceptCreditException = !!body.accept_credit_exception;
  const creditExceptionReason = body.credit_exception_reason?.trim() || "";

  if (!Number.isInteger(planId) || planId <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "plan_id is required",
    });
  }

  if (!Number.isInteger(semester) || semester < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "semester must be a positive number",
    });
  }

  if (!courses) {
    throw createError({
      statusCode: 400,
      statusMessage: "courses must be an array of { course_id, status }",
    });
  }

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

  const programId = Number(hopData[0].program_id);

  const [planRows] = await pool.query(
    `SELECT ap.id,
            ap.status,
            ap.intake_id,
            ap.start_semester,
            api.status AS intake_status,
            s.total_credit_transferred
     FROM academic_plans ap
     JOIN students s ON ap.student_id = s.id
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

  if (plan.intake_status === "completed") {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Cannot modify schedule for an intake that has been marked as completed",
    });
  }

  if (plan.status !== "draft") {
    throw createError({
      statusCode: 400,
      statusMessage: "Can only modify courses for plans in draft status",
    });
  }

  const [intakeRows] = await pool.query(
    `SELECT session_id, intake_type
     FROM academic_planning_intakes
     WHERE id = ?`,
    [plan.intake_id],
  );

  if ((intakeRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Intake not found",
    });
  }

  const intake = (intakeRows as any[])[0];
  const sessionId = Number(intake.session_id);
  const intakeType = intake.intake_type as string;
  const startSemester = Number(plan.start_semester) || 1;
  const transferredCredits = Number(plan.total_credit_transferred) || 0;

  const [programRows] = await pool.query(
    `SELECT long_sem_min_credit,
            long_sem_max_credit,
            short_sem_min_credit,
            short_sem_max_credit
     FROM programs
     WHERE id = ?`,
    [programId],
  );

  const program = (programRows as any[])[0];

  const existingPlanConfigs = await getAcademicPlanSemesterConfigs(planId);
  const effectiveSemesterRules =
    existingPlanConfigs.length > 0
      ? existingPlanConfigs
      : await getEffectiveSemesterRulePlans({
          programId,
          intakeType,
          entrySemester: startSemester,
          sessionId,
          transferredCredits,
        });

  const semesterMeta =
    effectiveSemesterRules.find((rule) => rule.semester_number === semester) ||
    null;
  const semesterAllowanceMap = await getEffectiveSemesterRuleAllowanceMap({
    programId,
    intakeType,
    entrySemester: startSemester,
    sessionId,
    transferredCredits,
  });
  const semesterAllowance = semesterAllowanceMap.get(semester) || null;

  const courseIds = courses.map((course) => course.course_id);
  if (courseIds.length > 0) {
    const [validCourses] = await pool.query(
      `SELECT pc.course_id
       FROM program_courses pc
       WHERE pc.session_id = ? AND pc.course_id IN (?)`,
      [sessionId, courseIds],
    );

    const validCourseIds = new Set(
      (validCourses as any[]).map((course) => Number(course.course_id)),
    );
    const invalidCourses = courseIds.filter((id) => !validCourseIds.has(id));

    if (invalidCourses.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid course IDs: ${invalidCourses.join(", ")}`,
      });
    }
  }

  const [courseInfoRows] =
    courseIds.length > 0
      ? await pool.query(`SELECT id, credit_hour FROM courses WHERE id IN (?)`, [
          courseIds,
        ])
      : [[]];
  const courseCredits = new Map(
    (courseInfoRows as any[]).map((row: any) => [
      Number(row.id),
      Number(row.credit_hour) || 0,
    ]),
  );

  const [lockedRows] = await pool.query(
    `SELECT c.credit_hour
     FROM academic_plan_details apd
     JOIN courses c ON apd.course_id = c.id
     WHERE apd.academic_plan_id = ?
       AND apd.semester = ?
       AND apd.status IN ('Passed', 'Failed')`,
    [planId, semester],
  );
  const lockedCredits = (lockedRows as any[]).reduce(
    (sum: number, row: any) => sum + (Number(row.credit_hour) || 0),
    0,
  );

  const newCredits = courses.reduce(
    (sum, course) => sum + (courseCredits.get(course.course_id) || 0),
    0,
  );
  const totalSemesterCredits = newCredits + lockedCredits;

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
         SELECT MAX(apd2.id)
         FROM academic_plan_details apd2
         WHERE apd2.academic_plan_id = apd.academic_plan_id
           AND apd2.course_id = apd.course_id
           AND apd2.status IN ('Passed', 'Failed')
           AND apd2.grade IS NOT NULL
       )`,
    [planId],
  );

  let cgpa: number | null = null;
  const gradedCourses = gradedRows as any[];
  if (gradedCourses.length > 0) {
    let totalPoints = 0;
    let totalCredits = 0;
    for (const row of gradedCourses) {
      const gradePoint = gradePointMap[row.grade?.toUpperCase()];
      if (gradePoint !== undefined) {
        totalPoints += gradePoint * Number(row.credit_hour);
        totalCredits += Number(row.credit_hour);
      }
    }
    if (totalCredits > 0) {
      cgpa = totalPoints / totalCredits;
    }
  }

  const onProbation = cgpa !== null && cgpa < 2.5;
  let creditException: CreditExceptionPayload | null = null;

  if (
    program &&
    semesterMeta &&
    semester >= startSemester &&
    !semesterMeta.is_li
  ) {
    const recommendedMin =
      semesterMeta.semester_type === "L"
        ? Number(program.long_sem_min_credit) || 12
        : Number(program.short_sem_min_credit) || 6;
    const recommendedMax =
      semesterMeta.semester_type === "L"
        ? Number(program.long_sem_max_credit) || 20
        : Number(program.short_sem_max_credit) || 10;
    const allowedOverloadCredits = onProbation
      ? 0
      : Number(semesterAllowance?.allowed_overload_credits) || 0;
    const allowedUnderloadCredits =
      Number(semesterAllowance?.allowed_underload_credits) || 0;
    const effectiveMin = Math.max(recommendedMin - allowedUnderloadCredits, 0);
    const effectiveMax =
      (onProbation ? recommendedMin : recommendedMax) + allowedOverloadCredits;

    if (totalSemesterCredits > effectiveMax) {
      creditException = {
        semester,
        semester_type: semesterMeta.semester_type,
        total_credits: totalSemesterCredits,
        recommended_min: recommendedMin,
        recommended_max: recommendedMax,
        effective_max: effectiveMax,
        on_probation: onProbation,
        exception_type: "over",
      };
    } else if (totalSemesterCredits > 0 && totalSemesterCredits < effectiveMin) {
      creditException = {
        semester,
        semester_type: semesterMeta.semester_type,
        total_credits: totalSemesterCredits,
        recommended_min: recommendedMin,
        recommended_max: recommendedMax,
        effective_max: effectiveMax,
        on_probation: onProbation,
        exception_type: "under",
      };
    }
  }

  if (creditException && (!acceptCreditException || !creditExceptionReason)) {
    throw createError({
      statusCode: 409,
      statusMessage: "Credit-hour exception approval required",
      data: {
        code: "CREDIT_EXCEPTION_REQUIRED",
        reason_required: true,
        exception: creditException,
      },
    });
  }

  const shouldSyncPlanConfig =
    existingPlanConfigs.length > 0 ||
    !!creditException ||
    !!semesterMeta?.is_credit_exception;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(
      `DELETE FROM academic_plan_details
       WHERE academic_plan_id = ? AND semester = ? AND status = 'Planned'`,
      [planId, semester],
    );

    if (courses.length > 0) {
      for (const course of courses) {
        await connection.query(
          `INSERT INTO academic_plan_details (
             academic_plan_id,
             course_id,
             semester,
             status
           ) VALUES (?, ?, ?, ?)`,
          [planId, course.course_id, semester, course.status || "Planned"],
        );
      }
    }

    if (shouldSyncPlanConfig) {
      const baseRules =
        existingPlanConfigs.length > 0
          ? existingPlanConfigs
          : await getEffectiveSemesterRulePlans({
              programId,
              intakeType,
              entrySemester: startSemester,
              sessionId,
              transferredCredits,
              executor: connection,
            });

      const nextRules = baseRules.map((rule) => ({ ...rule }));
      const existingRuleIndex = nextRules.findIndex(
        (rule) => rule.semester_number === semester,
      );
      const existingRule =
        existingRuleIndex >= 0 ? nextRules[existingRuleIndex] : null;

      if (existingRule) {
        nextRules[existingRuleIndex] = {
          ...existingRule,
          is_credit_exception: !!creditException,
          credit_exception_reason: creditException
            ? creditExceptionReason
            : null,
        };
      } else if (semesterMeta) {
        nextRules.push({
          ...semesterMeta,
          is_credit_exception: !!creditException,
          credit_exception_reason: creditException
            ? creditExceptionReason
            : null,
        });
      }

      nextRules.sort((left, right) => left.semester_number - right.semester_number);
      await replaceAcademicPlanSemesterConfigs(planId, nextRules, connection);
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
    plan_id: planId,
    semester,
    courses_count: courses.length,
    credit_exception_approved: !!creditException,
  };
});
