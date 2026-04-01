import { pool } from "~~/server/utils/db";
import {
  ensureBaseRuleForIntake,
  seedSemesterOneRulePlans,
} from "~~/server/utils/semester-rule-plans";
import { auth } from "~~/utils/auth";

interface RuleInput {
  intake_type: string;
  credit_transfer: number;
  entry_semester: number;
}

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

  // Parse request body
  const body = await readBody<RuleInput>(event);

  // Validate intake_type
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

  if (body.credit_transfer === undefined || body.credit_transfer < 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Credit transfer must be a non-negative number",
    });
  }

  if (!body.entry_semester || body.entry_semester < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Entry semester must be at least 1",
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Check for duplicate credit_transfer value in same intake type
    const [existingRules] = await connection.query(
      `SELECT id FROM semester_entry_rules
       WHERE program_id = ? AND intake_type = ? AND credit_transfer = ?`,
      [programId, intakeType, body.credit_transfer],
    );

    if ((existingRules as any[]).length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `A rule for ${body.credit_transfer} credits already exists for this intake type`,
      });
    }

    // Insert new rule
    const [result] = await connection.query(
      `INSERT INTO semester_entry_rules (program_id, intake_type, credit_transfer, entry_semester)
       VALUES (?, ?, ?, ?)`,
      [programId, intakeType, body.credit_transfer, body.entry_semester],
    );

    const insertResult = result as any;

    if (body.entry_semester === 1) {
      await seedSemesterOneRulePlans(
        Number(insertResult.insertId),
        programId,
        intakeType,
        connection,
      );
    }

    // Auto-create base rule (entry_semester=1, credit_transfer=0) if it doesn't exist
    const { created: baseRuleCreated } = await ensureBaseRuleForIntake(
      programId,
      intakeType,
      connection,
    );

    await connection.commit();

    return {
      id: insertResult.insertId,
      intake_type: intakeType,
      credit_transfer: body.credit_transfer,
      entry_semester: body.entry_semester,
      base_rule_created: baseRuleCreated,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});
