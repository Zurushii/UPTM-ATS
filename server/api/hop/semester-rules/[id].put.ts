import { pool } from "~~/server/utils/db";
import { seedSemesterOneRulePlans } from "~~/server/utils/semester-rule-plans";
import { auth } from "~~/utils/auth";

interface RuleInput {
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

  // Get rule ID from params
  const ruleId = parseInt(getRouterParam(event, "id") || "");
  if (isNaN(ruleId)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid rule ID",
    });
  }

  // Verify rule belongs to this program
  const [ruleRows] = await pool.query(
    `SELECT id, intake_type, credit_transfer, entry_semester
     FROM semester_entry_rules
     WHERE id = ? AND program_id = ?`,
    [ruleId, programId],
  );

  const ruleData = ruleRows as any[];
  if (ruleData.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Rule not found",
    });
  }

  const intakeType = ruleData[0].intake_type;
  const oldCreditTransfer = ruleData[0].credit_transfer;
  const oldEntrySemester = ruleData[0].entry_semester;

  // Parse request body
  const body = await readBody<RuleInput>(event);

  // Validate input
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

  // Check for duplicate credit_transfer if value changed
  if (body.credit_transfer !== oldCreditTransfer) {
    const [existingRules] = await pool.query(
      `SELECT id FROM semester_entry_rules
       WHERE program_id = ? AND intake_type = ? AND credit_transfer = ? AND id != ?`,
      [programId, intakeType, body.credit_transfer, ruleId],
    );

    if ((existingRules as any[]).length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `A rule for ${body.credit_transfer} credits already exists for this intake type`,
      });
    }
  }

  // Update rule
  await pool.query(
    `UPDATE semester_entry_rules SET credit_transfer = ?, entry_semester = ? WHERE id = ?`,
    [body.credit_transfer, body.entry_semester, ruleId],
  );

  if (oldEntrySemester !== 1 && body.entry_semester === 1) {
    await seedSemesterOneRulePlans(ruleId, programId, intakeType);
  }

  return {
    id: ruleId,
    intake_type: intakeType,
    credit_transfer: body.credit_transfer,
    entry_semester: body.entry_semester,
  };
});
