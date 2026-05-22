import { pool } from "~~/server/utils/db";
import { resolveIntakeLifecyclePattern } from "~~/server/utils/intake-lifecycle";
import { getSemesterEntryRuleById } from "~~/server/utils/semester-entry-bands";
import {
  replaceSemesterRuleExceptionWindows,
  validateSemesterRuleExceptionWindows,
  type SemesterRuleExceptionWindow,
} from "~~/server/utils/semester-rule-exception-windows";
import {
  replaceSemesterRuleJourneySlots,
  resolveSemesterRuleJourney,
  validateSemesterRuleJourneySlots,
  type SemesterRuleJourneySlot,
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

  const body = await readBody<{
    journey_slots: SemesterRuleJourneySlot[];
    exception_windows?: SemesterRuleExceptionWindow[];
  }>(event);

  if (!Array.isArray(body?.journey_slots)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Journey slots are required",
    });
  }

  const lifecycleConfig = await resolveIntakeLifecyclePattern({
    programId,
    intakeType: rule.intake_type,
  });
  const lifecyclePattern = lifecycleConfig.lifecycle_pattern;

  const validation = await validateSemesterRuleJourneySlots({
    slots: body.journey_slots,
    entrySemester: Number(rule.entry_semester),
  });
  const exceptionWindowValidation = validateSemesterRuleExceptionWindows({
    windows: Array.isArray(body.exception_windows) ? body.exception_windows : [],
    bandTransferMin: Number(rule.transfer_min),
    bandTransferMax: Number(rule.transfer_max),
    slotCount: body.journey_slots.length,
    slotRolesByOrder: new Map(
      body.journey_slots.map((slot, index) => [
        index + 1,
        String(slot.slot_role || "regular").toLowerCase(),
      ]),
    ),
  });

  if (
    validation.issues.length > 0 ||
    exceptionWindowValidation.issues.length > 0
  ) {
    throw createError({
      statusCode: 400,
      statusMessage:
        validation.issues[0]?.message ||
        exceptionWindowValidation.issues[0]?.message ||
        "This planned semester setup is invalid.",
      data: {
        code: "INVALID_JOURNEY",
        issues: [
          ...validation.issues,
          ...exceptionWindowValidation.issues,
        ],
      },
    });
  }

  await replaceSemesterRuleJourneySlots({
    ruleId: rule.id,
    slots: body.journey_slots,
    lifecyclePattern,
  });
  await replaceSemesterRuleExceptionWindows({
    ruleId: rule.id,
    windows: Array.isArray(body.exception_windows) ? body.exception_windows : [],
  });

  const resolvedJourney = await resolveSemesterRuleJourney({
    programId,
    intakeType: rule.intake_type,
    entrySemester: Number(rule.entry_semester),
    transferredCredits: Number(rule.transfer_min),
    ruleId: rule.id,
  });

  return {
    message: "Band journey updated successfully",
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
