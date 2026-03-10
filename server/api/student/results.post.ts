import { pool } from "../../utils/db";
import { auth } from "@@/utils/auth";
import { readMultipartFormData } from "h3";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "STUDENT") {
    throw createError({ statusCode: 403, statusMessage: "Student only" });
  }

  // Get student record
  const [studentRows] = await pool.query(
    `SELECT s.id, s.matric_no FROM students s WHERE s.user_id = ?`,
    [session.user.id],
  );

  const student = (studentRows as any[])[0];
  if (!student) {
    throw createError({
      statusCode: 404,
      statusMessage: "Student profile not found",
    });
  }

  // Get latest academic plan
  const [planRows] = await pool.query(
    `SELECT id, status FROM academic_plans WHERE student_id = ? ORDER BY created_at DESC LIMIT 1`,
    [student.id],
  );

  const plan = (planRows as any[])[0];
  if (!plan) {
    throw createError({
      statusCode: 400,
      statusMessage: "No academic plan found",
    });
  }

  // Parse multipart form data
  const formData = await readMultipartFormData(event);
  if (!formData) {
    throw createError({
      statusCode: 400,
      statusMessage: "No form data received",
    });
  }

  // Extract fields
  const semesterField = formData.find((f) => f.name === "semester");
  const fileField = formData.find((f) => f.name === "result_slip");
  const resultsField = formData.find((f) => f.name === "results");

  if (!semesterField || !fileField || !resultsField) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields: semester, result_slip, results",
    });
  }

  const semester = parseInt(semesterField.data.toString(), 10);
  if (isNaN(semester) || semester < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid semester number",
    });
  }

  // Validate file type (PDF only)
  const filename = fileField.filename || "result_slip";
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext !== "pdf") {
    throw createError({
      statusCode: 400,
      statusMessage: "Only PDF files are allowed",
    });
  }

  // Parse results JSON: [{ course_id: number, status: "Passed" | "Failed", grade?: string }]
  let courseResults: {
    course_id: number;
    status: "Passed" | "Failed";
    grade?: string;
  }[];
  try {
    courseResults = JSON.parse(resultsField.data.toString());
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid results JSON",
    });
  }

  if (!Array.isArray(courseResults) || courseResults.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Results must be a non-empty array",
    });
  }

  // Validate each result
  for (const r of courseResults) {
    if (!r.course_id || !["Passed", "Failed"].includes(r.status)) {
      throw createError({
        statusCode: 400,
        statusMessage:
          "Each result must have course_id and status ('Passed' or 'Failed')",
      });
    }
  }

  // Verify courses belong to this plan and semester
  const [planCourses] = await pool.query(
    `SELECT id, course_id FROM academic_plan_details
     WHERE academic_plan_id = ? AND semester = ? AND status != 'Transferred'`,
    [plan.id, semester],
  );

  const planCourseIds = new Set((planCourses as any[]).map((c) => c.course_id));
  for (const r of courseResults) {
    if (!planCourseIds.has(r.course_id)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Course ID ${r.course_id} is not in semester ${semester} of your plan`,
      });
    }
  }

  // Save file to uploads directory
  const uploadsDir = join(
    process.cwd(),
    "uploads",
    "results",
    student.matric_no,
  );
  await mkdir(uploadsDir, { recursive: true });

  const storedFilename = `sem${semester}_${Date.now()}.${ext}`;
  const filePath = join(uploadsDir, storedFilename);
  await writeFile(filePath, fileField.data);

  const relativePath = `uploads/results/${student.matric_no}/${storedFilename}`;

  // Use transaction: save result slip + update course statuses
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Upsert semester result slip
    await connection.query(
      `INSERT INTO semester_results (student_id, academic_plan_id, semester, result_slip_filename, result_slip_path)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         result_slip_filename = VALUES(result_slip_filename),
         result_slip_path = VALUES(result_slip_path),
         submitted_at = CURRENT_TIMESTAMP`,
      [student.id, plan.id, semester, filename, relativePath],
    );

    // Update each course status and grade
    for (const r of courseResults) {
      await connection.query(
        `UPDATE academic_plan_details
         SET status = ?, grade = ?
         WHERE academic_plan_id = ? AND course_id = ? AND semester = ?`,
        [r.status, r.grade || null, plan.id, r.course_id, semester],
      );
    }

    // Prerequisite cascade: remove planned dependents of failed courses
    const failedCourseIds = courseResults
      .filter((r) => r.status === "Failed")
      .map((r) => r.course_id);

    const cascadedCourses: number[] = [];
    if (failedCourseIds.length > 0) {
      // Find planned courses that depend on any failed course
      const [dependentRows] = await connection.query(
        `SELECT apd.id, apd.course_id, c.course_code
         FROM academic_plan_details apd
         JOIN program_courses pc ON apd.course_id = pc.course_id
         JOIN courses c ON apd.course_id = c.id
         WHERE apd.academic_plan_id = ?
           AND apd.status = 'Planned'
           AND pc.prerequisite_course_id IN (?)
           AND pc.session_id = (
             SELECT pc2.session_id FROM program_courses pc2
             WHERE pc2.course_id = apd.course_id LIMIT 1
           )`,
        [plan.id, failedCourseIds],
      );

      const dependents = dependentRows as any[];
      if (dependents.length > 0) {
        const idsToDelete = dependents.map((d) => d.id);
        cascadedCourses.push(...dependents.map((d) => d.course_id));
        await connection.query(
          `DELETE FROM academic_plan_details WHERE id IN (?)`,
          [idsToDelete],
        );
      }

      // Auto-revert plan to draft so student can reschedule
      await connection.query(
        `UPDATE academic_plans SET status = 'draft' WHERE id = ?`,
        [plan.id],
      );
    }

    await connection.commit();

    return {
      success: true,
      message: "Results submitted successfully",
      cascaded_courses: cascadedCourses,
      plan_reverted: failedCourseIds.length > 0,
    };
  } catch (error) {
    await connection.rollback();
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to save results",
    });
  } finally {
    connection.release();
  }
});
