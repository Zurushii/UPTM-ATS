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

  const intakeId = getRouterParam(event, "id");
  if (!intakeId) {
    throw createError({ statusCode: 400, statusMessage: "Intake ID required" });
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

  // Verify intake belongs to this program
  const [intakeRows] = await pool.query(
    `SELECT id FROM academic_planning_intakes WHERE id = ? AND program_id = ?`,
    [intakeId, programId],
  );

  if ((intakeRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Academic planning intake not found",
    });
  }

  // Delete associated academic plans (they have intake_id FK)
  // The FK is SET NULL, so we need to explicitly delete plans linked to this intake
  await pool.query(
    `DELETE FROM academic_plans WHERE intake_id = ?`,
    [intakeId],
  );

  // Delete the intake
  await pool.query(
    `DELETE FROM academic_planning_intakes WHERE id = ?`,
    [intakeId],
  );

  return {
    message: "Academic planning intake deleted successfully",
  };
});
