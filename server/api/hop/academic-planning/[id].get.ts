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

  // Get the academic planning intake details
  const [intakeRows] = await pool.query(
    `SELECT 
      api.id,
      api.intake_year,
      api.intake_name,
      api.session_id,
      ps.session_name,
      api.intake_type,
      api.status,
      api.total_students,
      api.successful_plans,
      api.failed_plans,
      api.created_at,
      api.updated_at
    FROM academic_planning_intakes api
    JOIN program_sessions ps ON api.session_id = ps.id
    WHERE api.id = ? AND api.program_id = ?`,
    [intakeId, programId],
  );

  if ((intakeRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Academic planning intake not found",
    });
  }

  const intake = (intakeRows as any[])[0];

  // Get all students for this intake with their academic plan status
  const [studentRows] = await pool.query(
    `SELECT 
      s.id AS student_id,
      s.matric_no,
      u.name AS student_name,
      s.starting_semester AS entry_semester,
      s.total_credit_transferred,
      ap.id AS academic_plan_id,
      ap.status AS plan_status
    FROM students s
    JOIN user u ON s.user_id = u.id
    LEFT JOIN academic_plans ap ON ap.student_id = s.id AND ap.intake_id = ?
    WHERE s.program_id = ? AND s.intake_year = ?
    ORDER BY s.matric_no ASC`,
    [intakeId, programId, intake.intake_year],
  );

  return {
    ...intake,
    students: studentRows,
  };
});
