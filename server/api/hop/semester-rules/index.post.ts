import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";

interface RuleInput {
  intake_year: string;
  min_credit: number;
  max_credit: number;
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

  // Validate input
  if (!body.intake_year || body.intake_year.length !== 4) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid intake year format. Use MMYY (e.g., 0524)",
    });
  }

  if (body.min_credit === undefined || body.min_credit < 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Min credit must be a non-negative number",
    });
  }

  if (body.max_credit === undefined || body.max_credit < body.min_credit) {
    throw createError({
      statusCode: 400,
      statusMessage: "Max credit must be greater than or equal to min credit",
    });
  }

  if (!body.entry_semester || body.entry_semester < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Entry semester must be at least 1",
    });
  }

  // Check for overlapping ranges in the same intake
  const [existingRules] = await pool.query(
    `SELECT id, min_credit, max_credit FROM semester_entry_rules
     WHERE program_id = ? AND intake_year = ?
     AND (
       (? BETWEEN min_credit AND max_credit) OR
       (? BETWEEN min_credit AND max_credit) OR
       (min_credit BETWEEN ? AND ?) OR
       (max_credit BETWEEN ? AND ?)
     )`,
    [
      programId,
      body.intake_year,
      body.min_credit,
      body.max_credit,
      body.min_credit,
      body.max_credit,
      body.min_credit,
      body.max_credit,
    ],
  );

  if ((existingRules as any[]).length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Credit range overlaps with an existing rule for this intake",
    });
  }

  // Insert new rule
  const [result] = await pool.query(
    `INSERT INTO semester_entry_rules (program_id, intake_year, min_credit, max_credit, entry_semester)
     VALUES (?, ?, ?, ?, ?)`,
    [
      programId,
      body.intake_year,
      body.min_credit,
      body.max_credit,
      body.entry_semester,
    ],
  );

  const insertResult = result as any;

  return {
    id: insertResult.insertId,
    intake_year: body.intake_year,
    min_credit: body.min_credit,
    max_credit: body.max_credit,
    entry_semester: body.entry_semester,
  };
});
