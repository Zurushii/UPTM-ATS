import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";

interface CreateIntakeBody {
  intake_year: string;
  intake_name: string;
  session_id: number;
  intake_type: string;
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
  const body = await readBody<CreateIntakeBody>(event);

  if (!body.intake_year || !body.intake_name || !body.session_id || !body.intake_type) {
    throw createError({
      statusCode: 400,
      statusMessage: "intake_year, intake_name, session_id, and intake_type are required",
    });
  }

  // Validate session belongs to this program
  const [sessionRows] = await pool.query(
    `SELECT id FROM program_sessions WHERE id = ? AND program_id = ?`,
    [body.session_id, programId],
  );

  if ((sessionRows as any[]).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid session_id for this program",
    });
  }

  // Validate intake_type exists in semester rules
  const [ruleRows] = await pool.query(
    `SELECT id FROM semester_entry_rules WHERE program_id = ? AND intake_type = ? LIMIT 1`,
    [programId, body.intake_type],
  );

  if ((ruleRows as any[]).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "No semester rules found for the specified intake_type",
    });
  }

  // Check for duplicate intake_year
  const [existingRows] = await pool.query(
    `SELECT id FROM academic_planning_intakes WHERE program_id = ? AND intake_year = ?`,
    [programId, body.intake_year],
  );

  if ((existingRows as any[]).length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: "Academic planning already exists for this intake year",
    });
  }

  // Create the academic planning intake
  const [result] = await pool.query(
    `INSERT INTO academic_planning_intakes 
     (program_id, intake_year, intake_name, session_id, intake_type, status)
     VALUES (?, ?, ?, ?, ?, 'draft')`,
    [programId, body.intake_year, body.intake_name, body.session_id, body.intake_type],
  );

  const insertId = (result as any).insertId;

  return {
    id: insertId,
    message: "Academic planning intake created successfully",
  };
});
