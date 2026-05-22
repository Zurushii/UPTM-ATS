import { pool } from "~~/server/utils/db";
import {
  formatIntakeLifecyclePattern,
  normalizeIntakeLifecyclePattern,
  replaceProgramIntakeLifecyclePattern,
} from "~~/server/utils/intake-lifecycle";
import {
  getSemesterRuleJourneySlots,
  replaceSemesterRuleJourneySlots,
} from "~~/server/utils/semester-rule-journeys";
import { auth } from "~~/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
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
  const body = await readBody<{
    intake_type?: string;
    lifecycle_pattern?: Array<"L" | "S">;
  }>(event);

  const intakeType = String(body?.intake_type || "").trim();
  if (!intakeType) {
    throw createError({
      statusCode: 400,
      statusMessage: "Intake type is required",
    });
  }

  const lifecyclePattern = normalizeIntakeLifecyclePattern(
    body?.lifecycle_pattern,
    intakeType,
  );

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await replaceProgramIntakeLifecyclePattern({
      programId,
      intakeType,
      lifecyclePattern,
      executor: connection,
    });

    const [ruleRows] = await connection.query(
      `SELECT id
       FROM semester_entry_rules
       WHERE program_id = ? AND intake_type = ?`,
      [programId, intakeType],
    );

    for (const row of ruleRows as any[]) {
      const ruleId = Number(row.id);
      if (!ruleId) {
        continue;
      }

      const existingSlots = await getSemesterRuleJourneySlots({
        ruleId,
        executor: connection,
      });

      if (existingSlots.length === 0) {
        continue;
      }

      await replaceSemesterRuleJourneySlots({
        ruleId,
        slots: existingSlots,
        lifecyclePattern,
        executor: connection,
      });
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    message: `Intake lifecycle saved for ${intakeType}.`,
    intake_type: intakeType,
    lifecycle_pattern: lifecyclePattern,
    lifecycle_summary: formatIntakeLifecyclePattern(lifecyclePattern),
    source: "configured" as const,
  };
});
