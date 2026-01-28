import { pool } from "~~/server/utils/db";
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

  // Get intake_type from query params
  const query = getQuery(event);
  const intakeType = query.intake_type as string;

  if (!intakeType) {
    throw createError({
      statusCode: 400,
      statusMessage: "intake_type is required",
    });
  }

  // Delete all rules for this intake type and program
  const [result] = await pool.query(
    `DELETE FROM semester_entry_rules 
     WHERE program_id = ? AND intake_type = ?`,
    [programId, intakeType],
  );

  const deleteResult = result as any;

  return {
    message: `Deleted ${deleteResult.affectedRows} rule(s) for ${intakeType}`,
    deleted_count: deleteResult.affectedRows,
  };
});
