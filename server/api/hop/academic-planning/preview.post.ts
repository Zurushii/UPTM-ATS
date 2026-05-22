import ExcelJS from "exceljs";
import {
  CREDIT_COLUMN_HEADERS,
  assessNeedsFixForAcademicPlanRegeneration,
  parseTransferredCreditsFromExcel,
  resolveAcademicPlanRegenerationEntryInputs,
  validateTransferredCoursesForAcademicPlanRegeneration,
} from "~~/server/utils/academic-plan-regeneration";
import { pool } from "~~/server/utils/db";
import { ensureStudentEntrySemesterColumns } from "~~/server/utils/semester-entry-bands";
import { auth } from "~~/utils/auth";

interface PreviewStudent {
  matric_no: string;
  student_name: string;
  entry_semester: number | null;
  total_credit_transferred: number | null;
  status:
    | "ready"
    | "missing_entry_semester"
    | "already_has_plan"
    | "credit_mismatch"
    | "needs_fix";
  reason?: string;
}

interface FailedRecord {
  row: number;
  matric_no: string | null;
  reason: string;
}

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

  const programId = hopData[0].program_id;
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
      intakeId = parseInt(field.data.toString(), 10);
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
    `SELECT id, intake_year, intake_type, session_id FROM academic_planning_intakes
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

  const [studentRows] = await pool.query(
    `SELECT 
      s.id,
      s.matric_no,
      COALESCE(u.name, s.matric_no) as student_name,
      s.starting_semester,
      s.total_credit_transferred,
      s.system_assigned_entry_semester,
      s.final_entry_semester,
      s.is_entry_semester_override,
      s.intake_assessment_needs_fix,
      s.intake_assessment_error_reason
    FROM students s
    LEFT JOIN user u ON s.user_id = u.id
    WHERE s.program_id = ? AND s.intake_year = ?`,
    [programId, intake.intake_year],
  );

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

  const previewStudents: PreviewStudent[] = [];
  const failedRecords: FailedRecord[] = [];
  const processedMatricNos = new Set<string>();
  let recoverableNeedsFixCount = 0;

  for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);
    if (!row.hasValues) continue;

    const matricNoValue = row.getCell(matricNoCol).value;
    if (!matricNoValue) continue;

    const matricNo = String(matricNoValue).trim();
    const matricNoLower = matricNo.toLowerCase();

    if (processedMatricNos.has(matricNoLower)) {
      failedRecords.push({
        row: rowNum,
        matric_no: matricNo,
        reason: "Duplicate entry in Excel file",
      });
      continue;
    }
    processedMatricNos.add(matricNoLower);

    const student = studentsMap.get(matricNoLower);
    if (!student) {
      failedRecords.push({
        row: rowNum,
        matric_no: matricNo,
        reason: "Student not found in system or different intake",
      });
      continue;
    }

    if (studentsWithPlans.has(Number(student.id))) {
      previewStudents.push({
        matric_no: student.matric_no,
        student_name: student.student_name,
        entry_semester: student.starting_semester,
        total_credit_transferred: student.total_credit_transferred,
        status: "already_has_plan",
        reason: "Already has an academic plan - will be skipped",
      });
      continue;
    }

    const needsFixAssessment = student.intake_assessment_needs_fix
      ? assessNeedsFixForAcademicPlanRegeneration(
          student.intake_assessment_error_reason,
        )
      : null;

    if (
      needsFixAssessment &&
      !needsFixAssessment.canRetryInAcademicPlanning
    ) {
      previewStudents.push({
        matric_no: student.matric_no,
        student_name: student.student_name,
        entry_semester: student.starting_semester,
        total_credit_transferred: student.total_credit_transferred,
        status: "needs_fix",
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
      previewStudents.push({
        matric_no: student.matric_no,
        student_name: student.student_name,
        entry_semester: student.starting_semester,
        total_credit_transferred: student.total_credit_transferred,
        status: "needs_fix",
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
      previewStudents.push({
        matric_no: student.matric_no,
        student_name: student.student_name,
        entry_semester: student.starting_semester,
        total_credit_transferred: student.total_credit_transferred,
        status: "credit_mismatch",
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
      previewStudents.push({
        matric_no: student.matric_no,
        student_name: student.student_name,
        entry_semester: null,
        total_credit_transferred: effectiveTransferredCredits,
        status: "missing_entry_semester",
        reason: `No semester-entry band covers ${effectiveTransferredCredits} transferred credits for ${intake.intake_type}.`,
      });
      continue;
    }

    if (
      needsFixAssessment?.requiresTransferredCoursesColumn &&
      transferredCoursesCol === -1
    ) {
      previewStudents.push({
        matric_no: student.matric_no,
        student_name: student.student_name,
        entry_semester: resolvedEntryInputs.effectiveStartingSemester,
        total_credit_transferred: effectiveTransferredCredits,
        status: "needs_fix",
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
      previewStudents.push({
        matric_no: student.matric_no,
        student_name: student.student_name,
        entry_semester: resolvedEntryInputs.effectiveStartingSemester,
        total_credit_transferred: effectiveTransferredCredits,
        status: "credit_mismatch",
        reason: validation.reason || "Transferred-course validation failed.",
      });
      continue;
    }

    previewStudents.push({
      matric_no: student.matric_no,
      student_name: student.student_name,
      entry_semester: resolvedEntryInputs.effectiveStartingSemester,
      total_credit_transferred: effectiveTransferredCredits,
      status: "ready",
      reason: needsFixAssessment?.canRetryInAcademicPlanning
        ? "Previously marked Needs Fix. This regenerate file now validates, and a successful generation will clear the flag automatically."
        : undefined,
    });

    if (needsFixAssessment?.canRetryInAcademicPlanning) {
      recoverableNeedsFixCount++;
    }
  }

  const readyCount = previewStudents.filter((s) => s.status === "ready").length;
  const skippedCount = previewStudents.filter(
    (s) => s.status === "already_has_plan",
  ).length;
  const missingEntryCount = previewStudents.filter(
    (s) => s.status === "missing_entry_semester",
  ).length;
  const creditMismatchCount = previewStudents.filter(
    (s) => s.status === "credit_mismatch",
  ).length;
  const needsFixCount = previewStudents.filter(
    (s) => s.status === "needs_fix",
  ).length;

  return {
    summary: {
      total_in_excel: processedMatricNos.size,
      ready_to_generate: readyCount,
      will_be_skipped: skippedCount,
      missing_entry_semester: missingEntryCount,
      credit_mismatch: creditMismatchCount,
      recoverable_needs_fix: recoverableNeedsFixCount,
      needs_fix: needsFixCount,
      failed_records: failedRecords.length,
    },
    preview_students: previewStudents,
    failed_records: failedRecords,
  };
});
