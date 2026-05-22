import { pool } from "~~/server/utils/db";
import { ensureStudentEntrySemesterColumns } from "~~/server/utils/semester-entry-bands";
import { auth } from "~~/utils/auth";

interface ReviewStudentUpdate {
  student_id: number;
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

  const body = await readBody<{
    intake_year?: string;
    students?: ReviewStudentUpdate[];
  }>(event);

  const intakeYear = body.intake_year?.trim() || "";
  const requestedStudents = Array.isArray(body.students) ? body.students : [];

  if (!intakeYear) {
    throw createError({
      statusCode: 400,
      statusMessage: "intake_year is required",
    });
  }

  if (requestedStudents.length === 0) {
    return {
      updated_students: [],
      locked_students: [],
    };
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

  const studentIds = requestedStudents
    .map((student) => Number(student.student_id))
    .filter((studentId) => Number.isInteger(studentId) && studentId > 0);

  if (studentIds.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "At least one valid student_id is required",
    });
  }

  const [studentRows] = await pool.query(
    `SELECT id,
            matric_no,
            intake_year,
            system_assigned_entry_semester,
            final_entry_semester,
            starting_semester
     FROM students
     WHERE program_id = ?
       AND intake_year = ?
       AND id IN (?)`,
    [programId, intakeYear, studentIds],
  );

  const studentsById = new Map<number, any>();
  for (const student of studentRows as any[]) {
    studentsById.set(Number(student.id), student);
  }

  const [planRows] = await pool.query(
    `SELECT DISTINCT student_id
     FROM academic_plans
     WHERE student_id IN (?)`,
    [studentIds],
  );
  const lockedStudentIds = new Set<number>(
    (planRows as any[]).map((row) => Number(row.student_id)),
  );

  const connection = await pool.getConnection();
  const updatedStudents: any[] = [];
  const lockedStudents: any[] = [];

  try {
    await connection.beginTransaction();

    for (const requestedStudent of requestedStudents) {
      const studentId = Number(requestedStudent.student_id);
      const student = studentsById.get(studentId);
      if (!student) {
        continue;
      }

      if (lockedStudentIds.has(studentId)) {
        lockedStudents.push({
          student_id: studentId,
          matric_no: student.matric_no,
          reason:
            "Academic plan already exists. Starting semester cannot be changed here.",
        });
        continue;
      }

      const finalEntrySemester = Number(requestedStudent.final_entry_semester);
      if (!Number.isInteger(finalEntrySemester) || finalEntrySemester < 1) {
        throw createError({
          statusCode: 400,
          statusMessage: `Invalid final entry semester for ${student.matric_no}`,
        });
      }

      const systemAssignedEntrySemester =
        Number(
          student.system_assigned_entry_semester ?? student.starting_semester,
        ) || 0;
      const overrideReason = requestedStudent.override_reason?.trim() || "";
      const isOverride = finalEntrySemester !== systemAssignedEntrySemester;

      if (isOverride && overrideReason.length === 0) {
        throw createError({
          statusCode: 400,
          statusMessage: `Override reason is required for ${student.matric_no}`,
        });
      }

      await connection.query(
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

      updatedStudents.push({
        student_id: studentId,
        matric_no: student.matric_no,
        system_assigned_entry_semester: systemAssignedEntrySemester,
        final_entry_semester: finalEntrySemester,
        is_entry_semester_override: isOverride,
        entry_semester_override_reason: isOverride ? overrideReason : null,
      });
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    updated_students: updatedStudents,
    locked_students: lockedStudents,
  };
});
