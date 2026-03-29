import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";
import { getRouterParam, readBody } from "h3";

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
    `SELECT id, status, intake_year FROM academic_planning_intakes WHERE id = ? AND program_id = ?`,
    [intakeId, programId],
  );

  if ((intakeRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Intake not found for your program",
    });
  }

  const intake = (intakeRows as any[])[0];

  if (intake.status !== "generated") {
    throw createError({
      statusCode: 400,
      statusMessage: "Only generated intakes can be marked as completed.",
    });
  }

  // Check if all students in this intake have plan_status = 'completed'
  const [studentRows] = await pool.query(
    `SELECT ap.status AS plan_status
    FROM students s
    LEFT JOIN academic_plans ap ON ap.student_id = s.id AND ap.intake_id = ?
    WHERE s.program_id = ? AND s.intake_year = ?`,
    [intakeId, programId, intake.intake_year],
  );

  const students = studentRows as any[];
  const incompleteStudents = students.filter(
    (s) => s.plan_status !== "completed"
  );

  if (incompleteStudents.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "All students in this intake must have their academic plan status marked as 'completed' before the intake can be completed.",
    });
  }

  await pool.query(
    `UPDATE academic_planning_intakes SET status = 'completed' WHERE id = ?`,
    [intakeId]
  );

  return { success: true };
});
