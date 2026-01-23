import ExcelJS from "exceljs";

interface StudentData {
  student_id: number;
  matric_no: string;
  intake: string;
  total_transferred_credit: number;
  entry_semester: number;
}

export default defineEventHandler(async (event) => {
  // Read the processed students from request body
  const body = await readBody(event);
  const students: StudentData[] = body.students;

  if (!students || !Array.isArray(students) || students.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "No student data provided for export",
    });
  }

  // Create Excel workbook
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "UTPM ATS";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Academic Planning Input");

  // Define columns
  worksheet.columns = [
    { header: "student_id", key: "student_id", width: 12 },
    { header: "matric_no", key: "matric_no", width: 18 },
    { header: "intake", key: "intake", width: 10 },
    {
      header: "total_transferred_credit",
      key: "total_transferred_credit",
      width: 24,
    },
    { header: "entry_semester", key: "entry_semester", width: 16 },
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
    worksheet.addRow({
      student_id: student.student_id,
      matric_no: student.matric_no,
      intake: student.intake,
      total_transferred_credit: student.total_transferred_credit,
      entry_semester: student.entry_semester,
    });
  }

  // Auto-fit columns (approximate)
  worksheet.columns.forEach((column) => {
    if (column.width && column.width < 12) {
      column.width = 12;
    }
  });

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();

  // Set response headers
  setResponseHeaders(event, {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="academic_planning_input_${students[0]?.intake || "export"}.xlsx"`,
  });

  return buffer;
});
