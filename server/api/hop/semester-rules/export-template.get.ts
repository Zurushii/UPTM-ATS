import ExcelJS from "exceljs";
import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";

const EXCEL_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const headerFill: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF3F4F6" },
};

const titleFill: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE8EEF7" },
};

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF1F2937" } },
  left: { style: "thin", color: { argb: "FF1F2937" } },
  bottom: { style: "thin", color: { argb: "FF1F2937" } },
  right: { style: "thin", color: { argb: "FF1F2937" } },
};

const STARTER_INTAKE_TYPE = "New Intake";
const STARTER_BAND_ROWS = 4;

const styleCell = (
  cell: ExcelJS.Cell,
  options?: {
    bold?: boolean;
    fill?: ExcelJS.Fill;
    horizontal?: "left" | "center" | "right";
    wrapText?: boolean;
    fontSize?: number;
  },
) => {
  cell.border = thinBorder;
  cell.alignment = {
    vertical: "middle",
    horizontal: options?.horizontal ?? "center",
    wrapText: options?.wrapText ?? false,
  };

  if (options?.fill) {
    cell.fill = options.fill;
  }

  if (options?.bold || options?.fontSize) {
    cell.font = {
      bold: options?.bold ?? false,
      size: options?.fontSize,
    };
  }
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
    styleCell(cell, {
      bold: columnNumber === 1,
      horizontal: "left",
      wrapText: true,
    });
  });
};

const fillBlankRows = (
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  rows: number,
  columnCount: number,
  valuesFactory?: (index: number) => Array<string | number | null>,
) => {
  for (let index = 0; index < rows; index++) {
    const rowNumber = startRow + index;
    const row = worksheet.getRow(rowNumber);
    row.height = 24;
    const presetValues = valuesFactory ? valuesFactory(index) : [];

    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber++) {
      const cell = row.getCell(columnNumber);
      if (presetValues[columnNumber - 1] != null) {
        cell.value = presetValues[columnNumber - 1] as string | number;
      }

      styleCell(cell, {
        horizontal: "center",
      });
    }
  }
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
    `SELECT
       p.program_code,
       p.program_name
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

  const program = hopData[0];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "UTPM ATS";
  workbook.created = new Date();

  const bandsSheet = workbook.addWorksheet("Entry Bands");
  bandsSheet.properties.defaultRowHeight = 20;

  bandsSheet.getCell("A1").value = "Entry Bands";
  bandsSheet.getCell("A1").font = { bold: true, size: 16 };
  bandsSheet.getCell("A2").value =
    "Replace the intake title, then add one non-overlapping transferred-credit range per row.";
  bandsSheet.getCell("A2").font = {
    italic: true,
    color: { argb: "FF4B5563" },
  };
  bandsSheet.getCell("A3").value =
    `Program: ${program.program_code} - ${program.program_name}`;
  bandsSheet.getCell("A3").font = { size: 11, color: { argb: "FF4B5563" } };

  const bandHeaders = [
    "TRANSFER MIN",
    "TRANSFER MAX",
    "ENTRY SEMESTER",
  ];

  const titleRowNumber = 5;
  const titleRow = bandsSheet.getRow(titleRowNumber);
  titleRow.height = 24;
  titleRow.getCell(1).value = STARTER_INTAKE_TYPE;
  styleCell(titleRow.getCell(1), {
    bold: true,
    fill: titleFill,
    horizontal: "left",
    fontSize: 12,
  });
  bandsSheet.mergeCells(titleRowNumber, 1, titleRowNumber, bandHeaders.length);

  const bandHeaderRow = bandsSheet.getRow(6);
  bandHeaderRow.height = 24;
  bandHeaders.forEach((header, index) => {
    const cell = bandHeaderRow.getCell(index + 1);
    cell.value = header;
    styleCell(cell, {
      bold: true,
      fill: headerFill,
      horizontal: "center",
      wrapText: true,
    });
  });

  fillBlankRows(
    bandsSheet,
    7,
    STARTER_BAND_ROWS,
    bandHeaders.length,
    (index) => [null, null, index + 1],
  );

  bandsSheet.getColumn(1).width = 18;
  bandsSheet.getColumn(2).width = 18;
  bandsSheet.getColumn(3).width = 18;

  const instructionsSheet = workbook.addWorksheet("Instructions");
  instructionsSheet.columns = [{ width: 26 }, { width: 96 }];
  instructionsSheet.properties.defaultRowHeight = 22;

  instructionsSheet.getCell("A1").value = "Semester Rules Template Guide";
  instructionsSheet.getCell("A1").font = { bold: true, size: 16 };
  instructionsSheet.getCell("A2").value =
    "Use the Entry Bands sheet to set one intake at a time. The rows below the intake title belong to that intake.";
  instructionsSheet.getCell("A2").font = {
    italic: true,
    color: { argb: "FF4B5563" },
  };
  instructionsSheet.getCell("A3").value =
    `Program: ${program.program_code} - ${program.program_name}`;
  instructionsSheet.getCell("A3").font = { size: 11, color: { argb: "FF4B5563" } };

  instructionsSheet.getCell("A5").value = "Topic";
  instructionsSheet.getCell("B5").value = "Guidance";
  styleCell(instructionsSheet.getCell("A5"), {
    bold: true,
    fill: headerFill,
    horizontal: "left",
  });
  styleCell(instructionsSheet.getCell("B5"), {
    bold: true,
    fill: headerFill,
    horizontal: "left",
  });

  const instructions: Array<[string, string]> = [
    [
      "How to use this template",
      "Fill in only the Entry Bands sheet. Replace 'New Intake' with the real intake name, then fill the transferred-credit groups underneath it.",
    ],
    [
      "Intake title",
      "Use an intake name such as 'May Intake' or 'August Intake'. Every credit range under the title belongs to that intake.",
    ],
    [
      "Transfer Min and Transfer Max",
      "Each row should cover one full transferred-credit range. Ranges for the same intake must not overlap.",
    ],
    [
      "Entry Semester",
      "Enter the semester where students in that transferred-credit range should start, for example 2, 3, or 4.",
    ],
    [
      "After import",
      "The system will generate the planned semesters automatically based on the intake, the starting semester, and the current program structure.",
    ],
    [
      "Legacy files",
      "You can still import the older workbook-style file when needed. This template is the simpler production-ready format for normal use.",
    ],
  ];

  let instructionRowNumber = 6;
  for (const [topic, guidance] of instructions) {
    styleInstructionRow(
      instructionsSheet,
      instructionRowNumber,
      topic,
      guidance,
    );
    instructionRowNumber += 1;
  }

  const buffer = await workbook.xlsx.writeBuffer();

  setHeader(event, "Content-Type", EXCEL_MIME_TYPE);
  setHeader(
    event,
    "Content-Disposition",
    'attachment; filename="semester_rules_entry_bands_template.xlsx"',
  );

  return buffer;
});
