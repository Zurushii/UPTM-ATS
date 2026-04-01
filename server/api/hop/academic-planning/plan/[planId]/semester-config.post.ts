import { auth } from "~~/utils/auth";
import { pool } from "~~/server/utils/db";
import {
  replaceAcademicPlanSemesterConfigs,
  type AcademicPlanSemesterConfigInput,
} from "~~/server/utils/academic-plan-semester-config";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
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

  const [planRows] = await pool.query(
    `SELECT ap.id, ap.status, api.status AS intake_status
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
