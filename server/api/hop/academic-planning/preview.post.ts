import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";
import ExcelJS from "exceljs";

interface PreviewStudent {
  matric_no: string;
  student_name: string;
  entry_semester: number | null;
  total_credit_transferred: number | null;
  status: "ready" | "missing_entry_semester" | "already_has_plan" | "credit_mismatch";
  reason?: string;
}

interface FailedRecord {
  row: number;
  matric_no: string | null;
  reason: string;
}

export default defineEventHandler(async (event) => {
  // Authenticate user
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
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

  // Parse multipart form data
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
      intakeId = parseInt(field.data.toString());
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

  // Verify intake belongs to this program and get intake details
  const [intakeRows] = await pool.query(
    `SELECT id, intake_year, intake_type FROM academic_planning_intakes 
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

  // Get all students in this program with the matching intake year
  // Use LEFT JOIN to include reserved students (user_id = NULL)
  const [studentRows] = await pool.query(
    `SELECT 
      s.id,
      s.matric_no,
      COALESCE(u.name, s.matric_no) as student_name,
      s.starting_semester,
      s.total_credit_transferred
    FROM students s
    LEFT JOIN user u ON s.user_id = u.id
    WHERE s.program_id = ? AND s.intake_year = ?`,
    [programId, intake.intake_year],
  );

  const studentsMap = new Map<string, any>();
  for (const student of studentRows as any[]) {
    studentsMap.set(student.matric_no.toLowerCase(), student);
  }

  // Get students who already have academic plans for this intake
  const [existingPlanRows] = await pool.query(
    `SELECT student_id FROM academic_plans WHERE intake_id = ?`,
    [intakeId],
  );

  const studentsWithPlans = new Set<number>();
  for (const row of existingPlanRows as any[]) {
    studentsWithPlans.add(row.student_id);
  }

  // Get all courses for code-to-ID lookup and credit hours
  // (same as generate.post.ts — needed for transferred_courses validation)
  const [allCoursesRows] = await pool.query(
    `SELECT id, course_code, credit_hour FROM courses`,
  );
  const courseCodeToId = new Map<string, number>();
  const courseIdToCreditHour = new Map<number, number>();
  for (const course of allCoursesRows as any[]) {
    courseCodeToId.set(course.course_code.toUpperCase(), course.id);
    courseIdToCreditHour.set(course.id, course.credit_hour);
  }

  // Parse Excel file
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file has no worksheets",
    });
  }

  // Find column indices (matric_no + optional transferred_courses)
  const headerRow = worksheet.getRow(1);
  let matricNoCol = -1;
  let transferredCoursesCol = -1;

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
    }
  });

  if (matricNoCol === -1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file must have a 'matric_no' column",
    });
  }

  // Process rows
  const previewStudents: PreviewStudent[] = [];
  const failedRecords: FailedRecord[] = [];
  const processedMatricNos = new Set<string>();

  for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);
    if (!row.hasValues) continue;

    const matricNoValue = row.getCell(matricNoCol).value;
    if (!matricNoValue) continue;

    const matricNo = String(matricNoValue).trim();
    const matricNoLower = matricNo.toLowerCase();

    // Check for duplicates in Excel
    if (processedMatricNos.has(matricNoLower)) {
      failedRecords.push({
        row: rowNum,
        matric_no: matricNo,
        reason: "Duplicate entry in Excel file",
      });
      continue;
    }
    processedMatricNos.add(matricNoLower);

    // Find student in database
    const student = studentsMap.get(matricNoLower);
    if (!student) {
      failedRecords.push({
        row: rowNum,
        matric_no: matricNo,
        reason: "Student not found in system or different intake",
      });
      continue;
    }

    // Check if student already has a plan
    if (studentsWithPlans.has(student.id)) {
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

    // Check if student has entry semester set
    if (!student.starting_semester) {
      previewStudents.push({
        matric_no: student.matric_no,
        student_name: student.student_name,
        entry_semester: null,
        total_credit_transferred: student.total_credit_transferred,
        status: "missing_entry_semester",
        reason: "Entry semester not set - run Intake Assessment first",
      });
      continue;
    }

    // ── Credit Transfer Validation ──
    // Only runs when the Excel file contains a transferred_courses column.
    // Mirrors the same check in generate.post.ts (lines 322–364) and
    // intake-assessment/process.post.ts (lines 495–507).
    // If no column is present, skip validation (same behaviour as generate endpoint).
    if (transferredCoursesCol !== -1) {
      const transferredCoursesValue = row.getCell(transferredCoursesCol).value;

      if (transferredCoursesValue) {
        const courseCodes = String(transferredCoursesValue)
          .split(",")
          .map((code) => code.trim().toUpperCase())
          .filter((code) => code.length > 0);

        let transferredCoursesCredits = 0;
        for (const code of courseCodes) {
          // Support slash-separated course groups (e.g. "UCS3153/UCS3143") —
          // use the first code that matches, same as intake-assessment process.
          if (code.includes("/")) {
            const groupCodes = code
              .split("/")
              .map((c) => c.trim().toUpperCase())
              .filter((c) => c.length > 0);
            for (const groupCode of groupCodes) {
              const id = courseCodeToId.get(groupCode);
              if (id) {
                transferredCoursesCredits += courseIdToCreditHour.get(id) || 0;
                break;
              }
            }
          } else {
            const courseId = courseCodeToId.get(code);
            if (courseId) {
              transferredCoursesCredits += courseIdToCreditHour.get(courseId) || 0;
            }
          }
        }

        const dbCredits = student.total_credit_transferred || 0;

        // Only flag a mismatch when at least one side is non-zero
        if ((courseCodes.length > 0 || dbCredits > 0) && dbCredits !== transferredCoursesCredits) {
          previewStudents.push({
            matric_no: student.matric_no,
            student_name: student.student_name,
            entry_semester: student.starting_semester,
            total_credit_transferred: student.total_credit_transferred,
            status: "credit_mismatch",
            reason: `Credit mismatch: DB total_credit_transferred (${dbCredits}) does not match sum of transferred courses in Excel (${transferredCoursesCredits}). This student will be skipped during generation.`,
          });
          continue;
        }
      }
    }

    previewStudents.push({
      matric_no: student.matric_no,
      student_name: student.student_name,
      entry_semester: student.starting_semester,
      total_credit_transferred: student.total_credit_transferred,
      status: "ready",
    });
  }

  const readyCount = previewStudents.filter((s) => s.status === "ready").length;
  const skippedCount = previewStudents.filter(
    (s) => s.status === "already_has_plan"
  ).length;
  const missingEntryCount = previewStudents.filter(
    (s) => s.status === "missing_entry_semester"
  ).length;
  const creditMismatchCount = previewStudents.filter(
    (s) => s.status === "credit_mismatch"
  ).length;

  return {
    summary: {
      total_in_excel: processedMatricNos.size,
      ready_to_generate: readyCount,
      will_be_skipped: skippedCount,
      missing_entry_semester: missingEntryCount,
      credit_mismatch: creditMismatchCount,
      failed_records: failedRecords.length,
    },
    preview_students: previewStudents,
    failed_records: failedRecords,
  };
});
