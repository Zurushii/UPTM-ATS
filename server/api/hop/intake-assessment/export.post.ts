import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";
import ExcelJS from "exceljs";

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
    `SELECT hp.program_id, p.program_code 
     FROM head_of_programs hp
     JOIN programs p ON hp.program_id = p.id
     WHERE hp.user_id = ?`,
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
  const programCode = hopData[0].program_code;

  // Read intake year from request body
  const body = await readBody(event);
  const intakeYear: string = body?.intake_year;

  if (!intakeYear) {
    throw createError({
      statusCode: 400,
      statusMessage: "intake_year is required",
    });
  }

  // Get all students for this program and intake with their transferred courses
  const [studentRows] = await pool.query(
    `SELECT 
      s.id,
      s.matric_no,
      s.intake_year,
      s.total_credit_transferred,
      s.starting_semester
    FROM students s
    WHERE s.program_id = ? AND s.intake_year = ?
    ORDER BY s.matric_no`,
    [programId, intakeYear],
  );

  const students = studentRows as any[];

  if (students.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "No students found for this intake",
    });
  }

  // Get transferred courses for all students (bulk query)
  const studentIds = students.map((s) => s.id);
  const [transferredRows] = await pool.query(
    `SELECT stc.student_id, c.course_code
     FROM student_transferred_courses stc
     JOIN courses c ON stc.course_id = c.id
     WHERE stc.student_id IN (?)
     ORDER BY stc.student_id, c.course_code`,
    [studentIds],
  );

  // Group transferred courses by student
  const transferredByStudent = new Map<number, string[]>();
  for (const row of transferredRows as any[]) {
    if (!transferredByStudent.has(row.student_id)) {
      transferredByStudent.set(row.student_id, []);
    }
    transferredByStudent.get(row.student_id)!.push(row.course_code);
  }

  // Create Excel workbook
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "UTPM ATS";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Intake Assessment Export");

  // Define columns - matching the import format exactly
  worksheet.columns = [
    { header: "matric_no", key: "matric_no", width: 18 },
    { header: "intake_year", key: "intake_year", width: 12 },
    { header: "total_credit_transferred", key: "total_credit_transferred", width: 24 },
    { header: "starting_semester", key: "starting_semester", width: 18 },
    { header: "program_code", key: "program_code", width: 15 },
    { header: "transferred_courses", key: "transferred_courses", width: 40 },
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0E0E0" },
  };
  headerRow.alignment = { horizontal: "center" };

  // Add data rows
  for (const student of students) {
    const transferredCourses = transferredByStudent.get(student.id) || [];
    
    worksheet.addRow({
      matric_no: student.matric_no,
      intake_year: student.intake_year,
      total_credit_transferred: student.total_credit_transferred || 0,
      starting_semester: student.starting_semester || 1,
      program_code: programCode,
      transferred_courses: transferredCourses.join(","),
    });
  }

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();

  // Set response headers
  setResponseHeaders(event, {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="intake_assessment_${intakeYear}.xlsx"`,
  });

  return buffer;
});
