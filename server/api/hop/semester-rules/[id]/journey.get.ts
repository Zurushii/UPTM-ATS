import { pool } from "~~/server/utils/db";
import { getSemesterEntryRuleById } from "~~/server/utils/semester-entry-bands";
import { resolveSemesterRuleJourney } from "~~/server/utils/semester-rule-journeys";
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
  const ruleId = Number.parseInt(getRouterParam(event, "id") || "", 10);

  if (!Number.isInteger(ruleId) || ruleId <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid rule ID",
    });
  }

  const rule = await getSemesterEntryRuleById({
    ruleId,
    programId,
  });

  if (!rule) {
    throw createError({
      statusCode: 404,
      statusMessage: "Rule not found",
    });
  }

  const resolvedJourney = await resolveSemesterRuleJourney({
    programId,
    intakeType: rule.intake_type,
    entrySemester: Number(rule.entry_semester),
    transferredCredits: Number(rule.transfer_min),
    ruleId: rule.id,
  });

  return {
    rule,
    intake_lifecycle_pattern: resolvedJourney.intake_lifecycle_pattern,
    intake_lifecycle_source: resolvedJourney.intake_lifecycle_source,
    journey_slots: resolvedJourney.journey_slots,
    exception_windows: resolvedJourney.exception_windows,
    exception_window_suggestions: resolvedJourney.exception_window_suggestions,
    explanation: resolvedJourney.explanation,
    preview_scenarios: resolvedJourney.preview_scenarios,
    validation_issues: resolvedJourney.validation_issues,
  };
});
