import { pool } from "~~/server/utils/db";
import { ensureStudentEntrySemesterColumns } from "~~/server/utils/semester-entry-bands";
import { auth } from "~~/utils/auth";

interface OverrideEntrySemesterBody {
  final_entry_semester: number;
  override_reason?: string | null;
}

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
  }

  const studentId = Number.parseInt(getRouterParam(event, "id") || "", 10);

  if (!Number.isInteger(studentId) || studentId <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid student ID",
    });
  }

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

  const programId = Number(hopData[0].program_id);
  await ensureStudentEntrySemesterColumns();

  const [studentRows] = await pool.query(
    `SELECT s.id,
            s.program_id,
            s.matric_no,
            s.starting_semester,
            s.system_assigned_entry_semester,
            s.final_entry_semester
     FROM students s
     WHERE s.id = ? AND s.program_id = ?
     LIMIT 1`,
    [studentId, programId],
  );

  const student = (studentRows as any[])[0];

  if (!student) {
    throw createError({
      statusCode: 404,
      statusMessage: "Student not found",
    });
  }

  const [planRows] = await pool.query(
    `SELECT id
     FROM academic_plans
     WHERE student_id = ?
     LIMIT 1`,
    [studentId],
  );

  if ((planRows as any[]).length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "Entry semester cannot be overridden after an academic plan has already been created for the student",
    });
  }

  const body = await readBody<OverrideEntrySemesterBody>(event);
  const finalEntrySemester = Number(body.final_entry_semester);
  const systemAssignedEntrySemester =
    Number(student.system_assigned_entry_semester ?? student.starting_semester) || 0;
  const overrideReason = body.override_reason?.trim() || "";

  if (!Number.isInteger(finalEntrySemester) || finalEntrySemester < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Final entry semester must be at least 1",
    });
  }

  const isOverride = finalEntrySemester !== systemAssignedEntrySemester;

  if (isOverride && overrideReason.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "An override reason is required when changing the system-assigned entry semester",
    });
  }

  await pool.query(
    `UPDATE students
     SET starting_semester = ?,
         final_entry_semester = ?,
         is_entry_semester_override = ?,
         entry_semester_override_reason = ?,
         entry_semester_overridden_by = ?,
         entry_semester_overridden_at = ?
     WHERE id = ?`,
    [
      finalEntrySemester,
      finalEntrySemester,
      isOverride ? 1 : 0,
      isOverride ? overrideReason : null,
      isOverride ? session.user.id : null,
      isOverride ? new Date() : null,
      studentId,
    ],
  );

  return {
    student_id: studentId,
    matric_no: student.matric_no,
    system_assigned_entry_semester: systemAssignedEntrySemester,
    final_entry_semester: finalEntrySemester,
    is_entry_semester_override: isOverride,
    entry_semester_override_reason: isOverride ? overrideReason : null,
  };
});
