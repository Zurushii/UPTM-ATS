import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";
import ExcelJS from "exceljs";

interface StudentRecord {
  student_id?: number;
  matric_no?: string;
  transferred_credits: number;
}

interface ProcessedStudent {
  student_id: number;
  matric_no: string;
  intake: string;
  total_transferred_credit: number;
  entry_semester: number;
}

interface FailedRecord {
  row: number;
  matric_no: string | null;
  student_id: number | null;
  reason: string;
}

interface SemesterRule {
  min_credit: number;
  max_credit: number;
  entry_semester: number;
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
  let intake: string | null = null;
  let ruleSetIntake: string | null = null;

  for (const field of formData) {
    if (field.name === "file" && field.data) {
      fileBuffer = field.data;
    } else if (field.name === "intake" && field.data) {
      intake = field.data.toString();
    } else if (field.name === "rule_set_intake" && field.data) {
      ruleSetIntake = field.data.toString();
    }
  }

  if (!fileBuffer) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file is required",
    });
  }

  if (!intake) {
    throw createError({
      statusCode: 400,
      statusMessage: "Intake is required",
    });
  }

  if (!ruleSetIntake) {
    throw createError({
      statusCode: 400,
      statusMessage: "Semester entry rule set is required",
    });
  }

  // Get semester entry rules
  const [ruleRows] = await pool.query(
    `SELECT min_credit, max_credit, entry_semester 
     FROM semester_entry_rules 
     WHERE program_id = ? AND intake_year = ?
     ORDER BY min_credit ASC`,
    [programId, ruleSetIntake],
  );

  const rules = ruleRows as SemesterRule[];
  if (rules.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "No semester entry rules found for the selected rule set",
    });
  }

  // Get all students for the selected intake in this program
  const [studentRows] = await pool.query(
    `SELECT id, matric_no FROM students WHERE program_id = ? AND intake_year = ?`,
    [programId, intake],
  );

  const studentsMap = new Map<string, { id: number; matric_no: string }>();
  const studentsById = new Map<number, { id: number; matric_no: string }>();

  for (const student of studentRows as any[]) {
    studentsMap.set(student.matric_no.toLowerCase(), {
      id: student.id,
      matric_no: student.matric_no,
    });
    studentsById.set(student.id, {
      id: student.id,
      matric_no: student.matric_no,
    });
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

  // Find column indices
  const headerRow = worksheet.getRow(1);
  let studentIdCol = -1;
  let matricNoCol = -1;
  let creditCol = -1;

  headerRow.eachCell((cell, colNumber) => {
    const value = String(cell.value || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_");
    if (value === "student_id" || value === "studentid" || value === "id") {
      studentIdCol = colNumber;
    } else if (
      value === "matric_no" ||
      value === "matricno" ||
      value === "matric" ||
      value === "matric_number"
    ) {
      matricNoCol = colNumber;
    } else if (
      value === "total_credit_transferred" ||
      value === "transferred_credits" ||
      value === "credit" ||
      value === "credits" ||
      value === "total_credit" ||
      value === "credit_hours"
    ) {
      creditCol = colNumber;
    }
  });

  if (studentIdCol === -1 && matricNoCol === -1) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Excel file must have either 'student_id' or 'matric_no' column",
    });
  }

  if (creditCol === -1) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Excel file must have a credit column (total_credit_transferred, transferred_credits, credit, credits, total_credit, credit_hours)",
    });
  }

  // Process rows
  const processedStudents: ProcessedStudent[] = [];
  const failedRecords: FailedRecord[] = [];
  const processedMatricNos = new Set<string>();

  for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);

    // Skip empty rows
    if (!row.hasValues) continue;

    const studentIdValue =
      studentIdCol !== -1 ? row.getCell(studentIdCol).value : null;
    const matricNoValue =
      matricNoCol !== -1 ? row.getCell(matricNoCol).value : null;
    const creditValue = row.getCell(creditCol).value;

    // Parse credit value
    let credits = 0;
    if (typeof creditValue === "number") {
      credits = creditValue;
    } else if (creditValue !== null && creditValue !== undefined) {
      credits = parseFloat(String(creditValue));
    }

    if (isNaN(credits) || credits < 0) {
      failedRecords.push({
        row: rowNum,
        matric_no: matricNoValue ? String(matricNoValue) : null,
        student_id: studentIdValue ? Number(studentIdValue) : null,
        reason: "Invalid credit value",
      });
      continue;
    }

    // Find student
    let student: { id: number; matric_no: string } | undefined;

    if (matricNoValue) {
      const matricNo = String(matricNoValue).toLowerCase().trim();
      student = studentsMap.get(matricNo);
    } else if (studentIdValue) {
      const studentId = Number(studentIdValue);
      student = studentsById.get(studentId);
    }

    if (!student) {
      failedRecords.push({
        row: rowNum,
        matric_no: matricNoValue ? String(matricNoValue) : null,
        student_id: studentIdValue ? Number(studentIdValue) : null,
        reason: "Student not found or not in selected intake/program",
      });
      continue;
    }

    // Check for duplicates
    if (processedMatricNos.has(student.matric_no.toLowerCase())) {
      failedRecords.push({
        row: rowNum,
        matric_no: student.matric_no,
        student_id: student.id,
        reason: "Duplicate entry for this student",
      });
      continue;
    }

    // Determine entry semester based on rules
    let entrySemester = 1; // Default to semester 1
    for (const rule of rules) {
      if (credits >= rule.min_credit && credits <= rule.max_credit) {
        entrySemester = rule.entry_semester;
        break;
      }
    }

    // If credits exceed all rules, use the highest entry semester
    if (credits > rules[rules.length - 1].max_credit) {
      entrySemester = rules[rules.length - 1].entry_semester;
    }

    processedMatricNos.add(student.matric_no.toLowerCase());
    processedStudents.push({
      student_id: student.id,
      matric_no: student.matric_no,
      intake: intake,
      total_transferred_credit: credits,
      entry_semester: entrySemester,
    });
  }

  // Update students in database
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const student of processedStudents) {
      await connection.query(
        `UPDATE students 
         SET total_credit_transferred = ?, starting_semester = ?
         WHERE id = ?`,
        [
          student.total_transferred_credit,
          student.entry_semester,
          student.student_id,
        ],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to update student records",
    });
  } finally {
    connection.release();
  }

  return {
    summary: {
      total_records: processedStudents.length + failedRecords.length,
      successful: processedStudents.length,
      failed: failedRecords.length,
    },
    processed_students: processedStudents,
    failed_records: failedRecords,
  };
});
