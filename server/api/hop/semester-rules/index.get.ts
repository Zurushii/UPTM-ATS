import { pool } from "~~/server/utils/db";
import {
  formatIntakeLifecyclePattern,
  resolveIntakeLifecyclePattern,
} from "~~/server/utils/intake-lifecycle";
import { getSemesterEntryBands } from "~~/server/utils/semester-entry-bands";
import { getSemesterRuleExceptionWindows } from "~~/server/utils/semester-rule-exception-windows";
import {
  ensureSemesterRuleJourneySlotsSeeded,
  getJourneySummaryLabel,
} from "~~/server/utils/semester-rule-journeys";
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

  // Get query param for filtering by intake type
  const query = getQuery(event);
  const intakeFilter = query.intake_type as string | undefined;

  if (intakeFilter) {
    const bands = await getSemesterEntryBands(programId, intakeFilter);
    return Promise.all(
      bands.map(async (band) => {
        const lifecycleConfig = await resolveIntakeLifecyclePattern({
          programId,
          intakeType: band.intake_type,
        });
        const journeySlots = await ensureSemesterRuleJourneySlotsSeeded({
          rule: band,
          programId,
        });
        const exceptionWindows = await getSemesterRuleExceptionWindows({
          ruleId: band.id,
        });

        return {
          ...band,
          intake_lifecycle_pattern: lifecycleConfig.lifecycle_pattern,
          intake_lifecycle_summary: formatIntakeLifecyclePattern(
            lifecycleConfig.lifecycle_pattern,
          ),
          intake_lifecycle_source: lifecycleConfig.source,
          journey_slots: journeySlots,
          exception_windows_count: exceptionWindows.length,
          journey_summary: getJourneySummaryLabel({
            slots: journeySlots,
            entrySemester: Number(band.entry_semester),
          }),
        };
      }),
    );
  }

  const [intakeRows] = await pool.query(
    `SELECT DISTINCT intake_type
     FROM semester_entry_rules
     WHERE program_id = ?
     ORDER BY intake_type ASC`,
    [programId],
  );

  const allBands = [];

  for (const intakeRow of intakeRows as any[]) {
    allBands.push(
      ...(await getSemesterEntryBands(programId, String(intakeRow.intake_type))),
    );
  }

  return Promise.all(
    allBands.map(async (band) => {
      const lifecycleConfig = await resolveIntakeLifecyclePattern({
        programId,
        intakeType: band.intake_type,
      });
      const journeySlots = await ensureSemesterRuleJourneySlotsSeeded({
        rule: band,
        programId,
      });
      const exceptionWindows = await getSemesterRuleExceptionWindows({
        ruleId: band.id,
      });

      return {
        ...band,
        intake_lifecycle_pattern: lifecycleConfig.lifecycle_pattern,
        intake_lifecycle_summary: formatIntakeLifecyclePattern(
          lifecycleConfig.lifecycle_pattern,
        ),
        intake_lifecycle_source: lifecycleConfig.source,
        journey_slots: journeySlots,
        exception_windows_count: exceptionWindows.length,
        journey_summary: getJourneySummaryLabel({
          slots: journeySlots,
          entrySemester: Number(band.entry_semester),
        }),
      };
    }),
  );
});
