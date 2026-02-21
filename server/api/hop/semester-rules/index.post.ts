import { pool } from "~~/server/utils/db";
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

  // Check for duplicate credit_transfer value in same intake type
  const [existingRules] = await pool.query(
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
  const [result] = await pool.query(
    `INSERT INTO semester_entry_rules (program_id, intake_type, credit_transfer, entry_semester)
     VALUES (?, ?, ?, ?)`,
    [programId, intakeType, body.credit_transfer, body.entry_semester],
  );

  const insertResult = result as any;

  // Auto-create base rule (entry_semester=1, credit_transfer=0) if it doesn't exist
  let baseRuleCreated = false;
  const [baseRuleCheck] = await pool.query(
    `SELECT id FROM semester_entry_rules
     WHERE program_id = ? AND intake_type = ? AND entry_semester = 1`,
    [programId, intakeType],
  );

  if ((baseRuleCheck as any[]).length === 0) {
    // Create base rule
    const [baseResult] = await pool.query(
      `INSERT INTO semester_entry_rules (program_id, intake_type, credit_transfer, entry_semester)
       VALUES (?, ?, 0, 1)`,
      [programId, intakeType],
    );

    const baseRuleId = (baseResult as any).insertId;

    // Get program credit limit ranges
    const [progRows] = await pool.query(
      `SELECT short_sem_min_credit, short_sem_max_credit, long_sem_max_credit FROM programs WHERE id = ?`,
      [programId],
    );
    const prog = (progRows as any[])[0];
    const shortMin = prog?.short_sem_min_credit ?? 6;
    const shortMax = prog?.short_sem_max_credit ?? 10;

    // Get the latest session that has program_courses for this program
    const [sessionRows] = await pool.query(
      `SELECT DISTINCT pc.session_id
       FROM program_courses pc
       JOIN sessions s ON pc.session_id = s.id
       WHERE s.program_id = ?
       ORDER BY s.id DESC
       LIMIT 1`,
      [programId],
    );

    if ((sessionRows as any[]).length > 0) {
      const latestSessionId = (sessionRows as any[])[0].session_id;

      // Get total credits per semester from program structure
      const [semCredits] = await pool.query(
        `SELECT pc.semester, SUM(c.credit_hour) AS total_credits
         FROM program_courses pc
         JOIN courses c ON pc.course_id = c.id
         WHERE pc.session_id = ?
         GROUP BY pc.semester
         ORDER BY pc.semester ASC`,
        [latestSessionId],
      );

      const planValues: string[] = [];
      const planParams: any[] = [];
      for (const row of semCredits as any[]) {
        const credits = Number(row.total_credits);
        const semType = (credits >= shortMin && credits <= shortMax) ? 'S' : 'L';
        planValues.push('(?, ?, ?, 0, ?)');
        planParams.push(baseRuleId, row.semester, semType, credits);
      }

      if (planValues.length > 0) {
        await pool.query(
          `INSERT INTO semester_credit_plans (rule_id, semester_number, semester_type, is_li, target_credits)
           VALUES ${planValues.join(', ')}`,
          planParams,
        );
      }
    }

    baseRuleCreated = true;
  }

  return {
    id: insertResult.insertId,
    intake_type: intakeType,
    credit_transfer: body.credit_transfer,
    entry_semester: body.entry_semester,
    base_rule_created: baseRuleCreated,
  };
});
