import { auth } from "@@/utils/auth";
import { pool } from "../../../../utils/db";
import {
  replaceAcademicPlanSemesterConfigs,
  type AcademicPlanSemesterConfigInput,
} from "~~/server/utils/academic-plan-semester-config";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "STUDENT") {
    throw createError({ statusCode: 403, statusMessage: "Students only" });
  }

  const planId = Number(getRouterParam(event, "planId"));
  if (!Number.isInteger(planId) || planId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid plan ID" });
  }

  const body = await readBody<{ rules?: AcademicPlanSemesterConfigInput[] }>(event);
  const rules = body.rules;

  if (!Array.isArray(rules)) {
    throw createError({
      statusCode: 400,
      statusMessage: "rules must be an array",
    });
  }

  const [studentRows] = await pool.query(
    `SELECT id FROM students WHERE user_id = ?`,
    [session.user.id],
  );

  const students = studentRows as any[];
  if (students.length === 0) {
    throw createError({ statusCode: 404, statusMessage: "Student not found" });
  }

  const studentId = students[0].id;

  const [planRows] = await pool.query(
    `SELECT ap.id, ap.status, api.status AS intake_status
     FROM academic_plans ap
     LEFT JOIN academic_planning_intakes api ON ap.intake_id = api.id
     WHERE ap.id = ? AND ap.student_id = ?`,
    [planId, studentId],
  );

  if ((planRows as any[]).length === 0) {
    throw createError({ statusCode: 404, statusMessage: "Plan not found" });
  }

  const plan = (planRows as any[])[0];

  if (plan.intake_status === "completed") {
    throw createError({
      statusCode: 400,
      statusMessage: "Cannot modify semester configuration for a completed intake",
    });
  }

  if (plan.status !== "draft") {
    throw createError({
      statusCode: 400,
      statusMessage: "Can only modify semester configuration for draft plans",
    });
  }

  const seenSemesters = new Set<number>();
  const normalizedRules = rules
    .map((rule) => ({
      semester_number: Number(rule.semester_number),
      semester_type: rule.semester_type,
      is_li: !!rule.is_li,
      target_credits: Number(rule.target_credits ?? 0),
    }))
    .sort((a, b) => a.semester_number - b.semester_number);

  for (const rule of normalizedRules) {
    if (!Number.isInteger(rule.semester_number) || rule.semester_number < 1) {
      throw createError({
        statusCode: 400,
        statusMessage: "Semester numbers must be positive integers",
      });
    }

    if (!["L", "S"].includes(rule.semester_type)) {
      throw createError({
        statusCode: 400,
        statusMessage: "Semester type must be L or S",
      });
    }

    if (!Number.isFinite(rule.target_credits) || rule.target_credits < 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "Target credits must be a non-negative number",
      });
    }

    if (seenSemesters.has(rule.semester_number)) {
      throw createError({
        statusCode: 400,
        statusMessage: "Duplicate semester numbers are not allowed",
      });
    }
    seenSemesters.add(rule.semester_number);
  }

  await replaceAcademicPlanSemesterConfigs(planId, normalizedRules);

  return {
    success: true,
    rules: normalizedRules,
  };
});
