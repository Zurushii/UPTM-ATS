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

  // Get rule ID from params
  const ruleId = parseInt(getRouterParam(event, "id") || "");
  if (isNaN(ruleId)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid rule ID",
    });
  }

  // Verify rule belongs to this program and delete
  const [result] = await pool.query(
    `DELETE FROM semester_entry_rules WHERE id = ? AND program_id = ?`,
    [ruleId, programId],
  );

  const deleteResult = result as any;
  if (deleteResult.affectedRows === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Rule not found",
    });
  }

  return { success: true };
});
