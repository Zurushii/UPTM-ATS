import { pool } from "~~/server/utils/db";
import {
  getProgramCreditCeiling,
  getSemesterEntryBands,
  getSemesterEntryRuleById,
} from "~~/server/utils/semester-entry-bands";
import {
  ensureSemesterRuleJourneySlotsSeeded,
  validateSemesterRuleJourneySlots,
} from "~~/server/utils/semester-rule-journeys";
import { auth } from "~~/utils/auth";

interface RuleInput {
  transfer_min?: number;
  transfer_max?: number;
  credit_transfer?: number;
  entry_semester: number;
  reference_note?: string | null;
}

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

  const existingRule = await getSemesterEntryRuleById({
    ruleId,
    programId,
  });

  if (!existingRule) {
    throw createError({
      statusCode: 404,
      statusMessage: "Rule not found",
    });
  }

  const creditCeiling = await getProgramCreditCeiling(programId);
  const body = await readBody<RuleInput>(event);
  const transferMin = Number(
    body.transfer_min ?? body.credit_transfer ?? existingRule.transfer_min,
  );
  const transferMax = Number(
    body.transfer_max ?? body.transfer_min ?? body.credit_transfer ?? existingRule.transfer_max,
  );
  const entrySemester = Number(body.entry_semester);
  const referenceNote =
    body.reference_note != null
      ? String(body.reference_note).trim() || null
      : existingRule.reference_note;

  if (!Number.isInteger(transferMin) || transferMin < 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Minimum transferred credits must be a non-negative whole number",
    });
  }

  if (!Number.isInteger(transferMax) || transferMax < transferMin) {
    throw createError({
      statusCode: 400,
      statusMessage: "Maximum transferred credits must be a whole number greater than or equal to the minimum",
    });
  }

  if (transferMax > creditCeiling) {
    throw createError({
      statusCode: 400,
      statusMessage: `Semester-entry bands cannot exceed the program credit ceiling of ${creditCeiling}`,
    });
  }

  if (!Number.isInteger(entrySemester) || entrySemester < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Entry semester must be at least 1",
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const existingBands = await getSemesterEntryBands(
      programId,
      existingRule.intake_type,
      { includeSystemDefault: false },
      connection,
    );
    const overlappingBand = existingBands.find(
      (band) =>
        band.id !== ruleId &&
        transferMin <= band.transfer_max &&
        transferMax >= band.transfer_min,
    );

    if (overlappingBand) {
      throw createError({
        statusCode: 400,
        statusMessage: `Band ${transferMin}-${transferMax} overlaps the existing ${overlappingBand.transfer_min}-${overlappingBand.transfer_max} range for this intake`,
      });
    }

    const existingJourneySlots = await ensureSemesterRuleJourneySlotsSeeded({
      rule: existingRule,
      programId,
      executor: connection,
    });
    const journeyValidation = await validateSemesterRuleJourneySlots({
      slots: existingJourneySlots,
      entrySemester,
    });

    if (journeyValidation.issues.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage:
          journeyValidation.issues[0]?.message ||
          "This band journey conflicts with the updated entry semester.",
      });
    }

    await connection.query(
      `UPDATE semester_entry_rules
       SET credit_transfer = ?,
           transfer_min = ?,
           transfer_max = ?,
           entry_semester = ?,
           reference_note = ?
       WHERE id = ?`,
      [
        transferMin,
        transferMin,
        transferMax,
        entrySemester,
        referenceNote,
        ruleId,
      ],
    );

    if (existingJourneySlots.length === 0) {
      await ensureSemesterRuleJourneySlotsSeeded({
        rule: {
          ...existingRule,
          credit_transfer: transferMin,
          transfer_min: transferMin,
          transfer_max: transferMax,
          entry_semester: entrySemester,
          reference_note: referenceNote,
        },
        programId,
        executor: connection,
      });
    }

    await connection.commit();

    return {
      id: ruleId,
      intake_type: existingRule.intake_type,
      credit_transfer: transferMin,
      transfer_min: transferMin,
      transfer_max: transferMax,
      entry_semester: entrySemester,
      reference_note: referenceNote,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});
