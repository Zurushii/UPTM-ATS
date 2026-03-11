import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
  }

  const intakeId = Number(getRouterParam(event, "id"));
  if (!intakeId || !Number.isInteger(intakeId)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid intake ID" });
  }

  const body = await readBody(event);
  const sem = Number(body.current_semester);
  if (!Number.isInteger(sem) || sem < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "current_semester must be a positive integer",
    });
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

  // Ensure the intake belongs to this HOP's program
  const [intakeRows] = await pool.query(
    `SELECT id FROM academic_planning_intakes WHERE id = ? AND program_id = ?`,
    [intakeId, programId],
  );

  if ((intakeRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Intake not found for your program",
    });
  }

  await pool.query(
    `UPDATE academic_planning_intakes SET current_semester = ? WHERE id = ?`,
    [sem, intakeId],
  );

  return { success: true };
});
