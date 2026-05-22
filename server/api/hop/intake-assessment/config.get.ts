import { pool } from "~~/server/utils/db";
import {
  getProgramCreditCeiling,
  getSemesterEntryBands,
  validateSemesterEntryBands,
} from "~~/server/utils/semester-entry-bands";
import {
  resolveProgramSessionForIntake,
  resolveSemesterRuleSetForIntake,
} from "~~/server/utils/intake-planning-config";
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

  // Get distinct intakes for the program's students
  const [intakeRows] = await pool.query(
    `SELECT DISTINCT intake_year FROM students WHERE program_id = ? ORDER BY intake_year DESC`,
    [programId],
  );

  // Get distinct semester entry rule sets (by intake_type)
  const [ruleSetRows] = await pool.query(
    `SELECT DISTINCT intake_type
     FROM semester_entry_rules
     WHERE program_id = ?
     ORDER BY intake_type ASC`,
    [programId],
  );

  const intakes = (intakeRows as any[]).map((r) => r.intake_year);
  const creditCeiling = await getProgramCreditCeiling(programId);
  const ruleSets = [];

  const [currentSessionRows] = await pool.query(
    `SELECT active_intake_period, semester_type, updated_at
     FROM program_current_session
     WHERE program_id = ?`,
    [programId],
  );
  const currentSession = (currentSessionRows as any[])[0] ?? null;

  for (const row of ruleSetRows as any[]) {
    const intakeType = String(row.intake_type);
    const bands = await getSemesterEntryBands(programId, intakeType);
    const validation = validateSemesterEntryBands({
      bands,
      creditCeiling,
    });

    ruleSets.push({
      intake_type: intakeType,
      rule_count: bands.length,
      min_credit: bands[0]?.transfer_min ?? 0,
      max_credit: bands.at(-1)?.transfer_max ?? 0,
      is_valid: validation.is_valid,
      validation_message: validation.issues[0]?.message ?? null,
    });
  }

  const autoAssignment =
    currentSession?.active_intake_period
      ? {
          intake_year: String(currentSession.active_intake_period),
          semester_rule: await resolveSemesterRuleSetForIntake({
            programId,
            intakeYear: String(currentSession.active_intake_period),
          }),
          program_session: await resolveProgramSessionForIntake({
            programId,
            intakeYear: String(currentSession.active_intake_period),
          }),
        }
      : null;

  return {
    programId,
    intakes,
    ruleSets,
    current_session: currentSession,
    auto_assignment: autoAssignment,
  };
});
