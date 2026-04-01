import ExcelJS from "exceljs";
import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";

const EXCEL_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const headerFill: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE0E0E0" },
};

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD1D5DB" } },
  left: { style: "thin", color: { argb: "FFD1D5DB" } },
  bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
  right: { style: "thin", color: { argb: "FFD1D5DB" } },
};

const styleInstructionRow = (
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  topic: string,
  guidance: string,
) => {
  const row = worksheet.getRow(rowNumber);
  row.getCell(1).value = topic;
  row.getCell(2).value = guidance;

  row.eachCell((cell, columnNumber) => {
    cell.border = thinBorder;
    cell.alignment = {
      vertical: "top",
      horizontal: "left",
      wrapText: true,
    };

    if (columnNumber === 1) {
      cell.font = { bold: true };
    }
  });
};

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
  }

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

  const programCode = String(hopData[0].program_code);

  const body = await readBody(event);
  const intakeYear = String(body?.intake_year || "").trim();
  const rowCount = Math.max(10, Math.min(Number(body?.row_count) || 10, 100));

  if (!intakeYear) {
    throw createError({
      statusCode: 400,
      statusMessage: "intake_year is required",
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "UTPM ATS";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Intake Assessment Template");

  worksheet.columns = [
    { header: "matric_no", key: "matric_no", width: 20 },
    { header: "intake_year", key: "intake_year", width: 16 },
    {
      header: "total_credit_transferred",
      key: "total_credit_transferred",
      width: 26,
    },
    { header: "starting_semester", key: "starting_semester", width: 18 },
    { header: "program_code", key: "program_code", width: 16 },
    { header: "transferred_courses", key: "transferred_courses", width: 72 },
  ];

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = headerFill;
  headerRow.alignment = { horizontal: "left", vertical: "middle" };

  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: "A1",
    to: "F1",
  };

  for (let index = 0; index < rowCount; index++) {
    worksheet.addRow({
      matric_no: "",
      intake_year: intakeYear,
      total_credit_transferred: 0,
      starting_semester: 0,
      program_code: programCode,
      transferred_courses: "",
    });
  }

  const instructionsSheet = workbook.addWorksheet("Instructions");
  instructionsSheet.columns = [{ width: 24 }, { width: 96 }];
  instructionsSheet.properties.defaultRowHeight = 22;

  instructionsSheet.getCell("A1").value = "Intake Assessment Template Guide";
  instructionsSheet.getCell("A1").font = { bold: true, size: 16 };
  instructionsSheet.getCell("A2").value =
    "Use the first worksheet to fill the student intake data. Keep it as the first sheet if you plan to upload the workbook back into Intake Assessment.";
  instructionsSheet.getCell("A2").font = {
    italic: true,
    color: { argb: "FF4B5563" },
  };

  instructionsSheet.getCell("A4").value = "Topic";
  instructionsSheet.getCell("B4").value = "Guidance";
  instructionsSheet.getCell("A4").font = { bold: true };
  instructionsSheet.getCell("B4").font = { bold: true };
  instructionsSheet.getCell("A4").fill = headerFill;
  instructionsSheet.getCell("B4").fill = headerFill;
  instructionsSheet.getCell("A4").border = thinBorder;
  instructionsSheet.getCell("B4").border = thinBorder;
  instructionsSheet.getCell("A4").alignment = { horizontal: "left" };
  instructionsSheet.getCell("B4").alignment = { horizontal: "left" };

  const instructionRows: Array<[string, string]> = [
    [
      "What this template is",
      "The first sheet is a starter workbook for Intake Assessment. It follows the expected upload columns and includes 10 sample rows so HOP can begin from a clean format.",
    ],
    [
      "Keep sheet order",
      "If you upload this workbook back into the system, keep 'Intake Assessment Template' as the first worksheet because the processor reads the first sheet.",
    ],
    [
      "matric_no",
      "Enter the student matric number for each row. This is the main identifier used during intake processing.",
    ],
    [
      "intake_year",
      `This is prefilled as ${intakeYear}. Keep it matched to the active intake period for the processing run.`,
    ],
    [
      "total_credit_transferred",
      "Enter the total transferred credits as a number. Use 0 when the student has no transferred credits.",
    ],
    [
      "starting_semester",
      "Leave this as 0 or blank. The system calculates the real entry semester from the selected semester entry rules.",
    ],
    [
      "program_code",
      `This is prefilled as ${programCode}. Keep it aligned with your program when preparing the file.`,
    ],
    [
      "transferred_courses",
      "Enter transferred course codes as a comma-separated list, for example ITC2293,SWC3623. Leave blank when there are no transferred courses.",
    ],
    [
      "Before upload",
      "Check that the selected rule set exists, the active session intake matches the file intake, and the Excel column headers stay unchanged.",
    ],
    [
      "Upload step",
      "Go to Intake Assessment, choose the intake and rule set in Step 1, upload the completed workbook in Step 2, then continue to processing.",
    ],
  ];

  let instructionRowNumber = 5;
  for (const [topic, guidance] of instructionRows) {
    styleInstructionRow(
      instructionsSheet,
      instructionRowNumber,
      topic,
      guidance,
    );
    instructionRowNumber++;
  }

  const buffer = await workbook.xlsx.writeBuffer();

  setResponseHeaders(event, {
    "Content-Type": EXCEL_MIME_TYPE,
    "Content-Disposition": `attachment; filename="intake_assessment_template_${intakeYear}.xlsx"`,
  });

  return buffer;
});
