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

  // Get request body
  const body = await readBody(event);
  const { plan_id, semester, courses } = body;

  if (!plan_id) {
    throw createError({ statusCode: 400, statusMessage: "plan_id is required" });
  }

  if (!semester || typeof semester !== "number" || semester < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "semester must be a positive number",
    });
  }

  if (!courses || !Array.isArray(courses)) {
    throw createError({
      statusCode: 400,
      statusMessage: "courses must be an array of { course_id, status }",
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

  // Verify the plan exists and belongs to a student in this program
  const [planRows] = await pool.query(
    `SELECT ap.id, ap.status, ap.intake_id
     FROM academic_plans ap
     JOIN students s ON ap.student_id = s.id
     WHERE ap.id = ? AND s.program_id = ?`,
    [plan_id, programId],
  );

  if ((planRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Academic plan not found",
    });
  }

  const plan = (planRows as any[])[0];

  // Only allow scheduling for draft plans
  if (plan.status !== "draft") {
    throw createError({
      statusCode: 400,
      statusMessage: "Can only modify courses for plans in draft status",
    });
  }

  // Get session_id from intake to validate courses belong to the program
  const [intakeRows] = await pool.query(
    `SELECT session_id FROM academic_planning_intakes WHERE id = ?`,
    [plan.intake_id],
  );

  if ((intakeRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Intake not found",
    });
  }

  const sessionId = (intakeRows as any[])[0].session_id;

  // Validate all course_ids belong to the program's session
  const courseIds = courses.map((c: any) => c.course_id);
  if (courseIds.length > 0) {
    const [validCourses] = await pool.query(
      `SELECT pc.course_id 
       FROM program_courses pc
       WHERE pc.session_id = ? AND pc.course_id IN (?)`,
      [sessionId, courseIds],
    );

    const validCourseIds = new Set((validCourses as any[]).map((c) => c.course_id));
    const invalidCourses = courseIds.filter((id: number) => !validCourseIds.has(id));

    if (invalidCourses.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid course IDs: ${invalidCourses.join(", ")}`,
      });
    }
  }

  // Start transaction
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Delete existing PLANNED courses for this semester (preserve Transferred)
    await connection.query(
      `DELETE FROM academic_plan_details WHERE academic_plan_id = ? AND semester = ? AND status = 'Planned'`,
      [plan_id, semester],
    );

    // Insert new courses for this semester
    if (courses.length > 0) {
      for (const course of courses) {
        await connection.query(
          `INSERT INTO academic_plan_details (academic_plan_id, course_id, semester, status)
           VALUES (?, ?, ?, ?)`,
          [plan_id, course.course_id, semester, course.status || "Planned"],
        );
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    success: true,
    message: `Semester ${semester} courses updated successfully`,
    plan_id,
    semester,
    courses_count: courses.length,
  };
});
