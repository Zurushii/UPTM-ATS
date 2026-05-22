import { pool } from "~~/server/utils/db";
import {
  getProgramCreditCeiling,
  getSemesterEntryBands,
} from "~~/server/utils/semester-entry-bands";
import { ensureSemesterRuleJourneySlotsSeeded } from "~~/server/utils/semester-rule-journeys";
import { auth } from "~~/utils/auth";

interface RuleInput {
  intake_type: string;
  credit_transfer?: number;
  transfer_min?: number;
  transfer_max?: number;
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
  const creditCeiling = await getProgramCreditCeiling(programId);
  const body = await readBody<RuleInput>(event);

  if (!body.intake_type || body.intake_type.trim().length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Intake type is required",
    });
  }

  if (body.intake_type.length > 20) {
    throw createError({
      statusCode: 400,
      statusMessage: "Intake type must be 20 characters or less",
    });
  }

  const intakeType = body.intake_type.trim();
  const transferMin = Number(
    body.transfer_min ?? body.credit_transfer ?? 0,
  );
  const transferMax = Number(
    body.transfer_max ?? body.transfer_min ?? body.credit_transfer ?? 0,
  );
  const entrySemester = Number(body.entry_semester);
  const referenceNote =
    body.reference_note != null ? String(body.reference_note).trim() || null : null;

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
      intakeType,
      { includeSystemDefault: false },
      connection,
    );
    const overlappingBand = existingBands.find(
      (band) =>
        transferMin <= band.transfer_max && transferMax >= band.transfer_min,
    );

    if (overlappingBand) {
      throw createError({
        statusCode: 400,
        statusMessage: `Band ${transferMin}-${transferMax} overlaps the existing ${overlappingBand.transfer_min}-${overlappingBand.transfer_max} range for this intake`,
      });
    }

    const [result] = await connection.query(
      `INSERT INTO semester_entry_rules (
         program_id,
         intake_type,
         credit_transfer,
         transfer_min,
         transfer_max,
         entry_semester,
         reference_note
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        programId,
        intakeType,
        transferMin,
        transferMin,
        transferMax,
        entrySemester,
        referenceNote,
      ],
    );

    const insertId = Number((result as any).insertId);

    const createdRule = {
      id: insertId,
      program_id: programId,
      intake_type: intakeType,
      credit_transfer: transferMin,
      transfer_min: transferMin,
      transfer_max: transferMax,
      entry_semester: entrySemester,
      reference_note: referenceNote,
    };
    await ensureSemesterRuleJourneySlotsSeeded({
      rule: createdRule,
      programId,
      executor: connection,
    });

    await connection.commit();

    return {
      id: insertId,
      intake_type: intakeType,
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
