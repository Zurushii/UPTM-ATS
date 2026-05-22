import ExcelJS from "exceljs";
import { pool } from "~~/server/utils/db";
import {
  CREDIT_COLUMN_HEADERS,
  assessNeedsFixForAcademicPlanRegeneration,
  parseTransferredCreditsFromExcel,
  resolveAcademicPlanRegenerationEntryInputs,
  validateTransferredCoursesForAcademicPlanRegeneration,
} from "~~/server/utils/academic-plan-regeneration";
import {
  generateAcademicPlansForIntakeStudents,
  type AcademicPlanFailedStudent,
  type AcademicPlanStudentInput,
} from "~~/server/utils/academic-plan-generation";
import { ensureStudentEntrySemesterColumns } from "~~/server/utils/semester-entry-bands";
import { auth } from "~~/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
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

  const formData = await readMultipartFormData(event);
  if (!formData) {
    throw createError({
      statusCode: 400,
      statusMessage: "No form data received",
    });
  }

  let fileBuffer: Buffer | null = null;
  let intakeId: number | null = null;

  for (const field of formData) {
    if (field.name === "file" && field.data) {
      fileBuffer = field.data;
    } else if (field.name === "intake_id" && field.data) {
      intakeId = Number.parseInt(field.data.toString(), 10);
    }
  }

  if (!fileBuffer) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file is required",
    });
  }

  if (!intakeId) {
    throw createError({
      statusCode: 400,
      statusMessage: "intake_id is required",
    });
  }

  const [intakeRows] = await pool.query(
    `SELECT id, intake_year, intake_type, session_id, status 
     FROM academic_planning_intakes 
     WHERE id = ? AND program_id = ?`,
    [intakeId, programId],
  );

  if ((intakeRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Academic planning intake not found",
    });
  }

  const intake = (intakeRows as any[])[0];

  if (intake.status === "completed") {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Cannot regenerate plans for an intake that has been marked as completed",
    });
  }

  const [studentRows] = await pool.query(
    `SELECT 
      s.id,
      s.matric_no,
      s.starting_semester,
      s.total_credit_transferred,
      s.system_assigned_entry_semester,
      s.final_entry_semester,
      s.is_entry_semester_override,
      s.intake_assessment_needs_fix,
      s.intake_assessment_error_reason
    FROM students s
    WHERE s.program_id = ? AND s.intake_year = ?`,
    [programId, intake.intake_year],
  );

  const studentsWithAssessment = (studentRows as any[]).filter(
    (student) => Number(student.starting_semester) > 0,
  );

  if (studentsWithAssessment.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Student Entry Assessment must be completed before generating academic plans. No students in this intake have been processed through Student Entry Assessment.",
    });
  }

  const studentsMap = new Map<string, any>();
  for (const student of studentRows as any[]) {
    studentsMap.set(String(student.matric_no).toLowerCase(), student);
  }

  const [existingPlanRows] = await pool.query(
    `SELECT student_id FROM academic_plans WHERE intake_id = ?`,
    [intakeId],
  );

  const studentsWithPlans = new Set<number>();
  for (const row of existingPlanRows as any[]) {
    studentsWithPlans.add(Number(row.student_id));
  }

  const [allCoursesRows] = await pool.query(
    `SELECT id, course_code, credit_hour FROM courses`,
  );
  const courseCodeToId = new Map<string, number>();
  const courseIdToCreditHour = new Map<number, number>();
  for (const course of allCoursesRows as any[]) {
    courseCodeToId.set(String(course.course_code).toUpperCase(), Number(course.id));
    courseIdToCreditHour.set(Number(course.id), Number(course.credit_hour) || 0);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file has no worksheets",
    });
  }

  const headerRow = worksheet.getRow(1);
  let matricNoCol = -1;
  let transferredCoursesCol = -1;
  let totalCreditTransferredCol = -1;

  headerRow.eachCell((cell, colNumber) => {
    const value = String(cell.value || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_");
    if (
      value === "matric_no" ||
      value === "matricno" ||
      value === "matric" ||
      value === "matric_number"
    ) {
      matricNoCol = colNumber;
    } else if (
      value === "transferred_courses" ||
      value === "transferredcourses" ||
      value === "transfer_courses"
    ) {
      transferredCoursesCol = colNumber;
    } else if (CREDIT_COLUMN_HEADERS.includes(value)) {
      totalCreditTransferredCol = colNumber;
    }
  });

  if (matricNoCol === -1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file must have a 'matric_no' column",
    });
  }

  const studentsToProcess: AcademicPlanStudentInput[] = [];
  const failedStudents: AcademicPlanFailedStudent[] = [];
  const processedMatricNos = new Set<string>();

  for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);
    if (!row.hasValues) continue;

    const matricNoValue = row.getCell(matricNoCol).value;
    if (!matricNoValue) continue;

    const matricNo = String(matricNoValue).trim();
    const matricNoLower = matricNo.toLowerCase();

    if (processedMatricNos.has(matricNoLower)) {
      continue;
    }
    processedMatricNos.add(matricNoLower);

    const student = studentsMap.get(matricNoLower);
    if (!student) continue;

    if (studentsWithPlans.has(Number(student.id))) continue;

    const needsFixAssessment = student.intake_assessment_needs_fix
      ? assessNeedsFixForAcademicPlanRegeneration(
          student.intake_assessment_error_reason,
        )
      : null;

    if (
      needsFixAssessment &&
      !needsFixAssessment.canRetryInAcademicPlanning
    ) {
      failedStudents.push({
        student_id: Number(student.id),
        matric_no: String(student.matric_no),
        reason:
          needsFixAssessment.blockReason ||
          "Needs Fix in Student Entry Assessment",
      });
      continue;
    }

    if (
      needsFixAssessment?.requiresTransferredCreditsColumn &&
      totalCreditTransferredCol === -1
    ) {
      failedStudents.push({
        student_id: Number(student.id),
        matric_no: String(student.matric_no),
        reason:
          needsFixAssessment.recoveryGuidance ||
          "Upload a regenerate file with a corrected total_credit_transferred value before regenerating this student.",
      });
      continue;
    }

    const parsedTransferredCredits = parseTransferredCreditsFromExcel(
      totalCreditTransferredCol !== -1
        ? row.getCell(totalCreditTransferredCol).value
        : null,
    );

    if (!parsedTransferredCredits.ok) {
      failedStudents.push({
        student_id: Number(student.id),
        matric_no: String(student.matric_no),
        reason:
          parsedTransferredCredits.reason ||
          "Invalid total_credit_transferred value in regenerate file.",
      });
      continue;
    }

    const effectiveTransferredCredits =
      parsedTransferredCredits.value ??
      (Number(student.total_credit_transferred) || 0);
    const resolvedEntryInputs =
      await resolveAcademicPlanRegenerationEntryInputs({
        programId,
        intakeType: String(intake.intake_type),
        sessionId: Number(intake.session_id),
        transferredCredits: effectiveTransferredCredits,
        student,
      });

    if (!resolvedEntryInputs) {
      failedStudents.push({
        student_id: Number(student.id),
        matric_no: String(student.matric_no),
        reason: `No semester-entry band covers ${effectiveTransferredCredits} transferred credits for ${intake.intake_type}.`,
      });
      continue;
    }

    if (
      needsFixAssessment?.requiresTransferredCoursesColumn &&
      transferredCoursesCol === -1
    ) {
      failedStudents.push({
        student_id: Number(student.id),
        matric_no: String(student.matric_no),
        reason:
          needsFixAssessment.recoveryGuidance ||
          "Upload a regenerate file with a corrected transferred_courses column before regenerating this student.",
      });
      continue;
    }

    const validation = validateTransferredCoursesForAcademicPlanRegeneration({
      rawValue:
        transferredCoursesCol !== -1
          ? row.getCell(transferredCoursesCol).value
          : null,
      hasTransferredCoursesColumn: transferredCoursesCol !== -1,
      dbCredits: effectiveTransferredCredits,
      courseCodeToId,
      courseIdToCreditHour,
    });

    if (!validation.ok) {
      failedStudents.push({
        student_id: Number(student.id),
        matric_no: String(student.matric_no),
        reason: validation.reason || "Transferred-course validation failed.",
      });
      continue;
    }

    studentsToProcess.push({
      student_id: Number(student.id),
      matric_no: String(student.matric_no),
      starting_semester: resolvedEntryInputs.effectiveStartingSemester,
      total_credit_transferred: effectiveTransferredCredits,
      transferred_course_ids: validation.courseIds,
      persist_transferred_course_ids: transferredCoursesCol !== -1,
      persist_total_credit_transferred:
        totalCreditTransferredCol !== -1 ||
        effectiveTransferredCredits !==
          (Number(student.total_credit_transferred) || 0),
      clear_intake_assessment_needs_fix:
        !!needsFixAssessment?.canRetryInAcademicPlanning,
      system_assigned_entry_semester:
        resolvedEntryInputs.systemAssignedEntrySemester,
      final_entry_semester: resolvedEntryInputs.finalEntrySemester,
      entry_semester_rule_id: resolvedEntryInputs.entrySemesterRuleId,
      entry_semester_assignment_note:
        resolvedEntryInputs.entrySemesterAssignmentNote,
      is_entry_semester_override:
        resolvedEntryInputs.isEntrySemesterOverride,
    });
  }

  return await generateAcademicPlansForIntakeStudents({
    intakeId,
    intakeType: String(intake.intake_type),
    intakeYear: String(intake.intake_year),
    programId,
    sessionId: Number(intake.session_id),
    studentsToProcess,
    initialFailedStudents: failedStudents,
    skippedExistingCount: studentsWithPlans.size,
  });
});
