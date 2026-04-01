import ExcelJS from "exceljs";
import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";

type TemplateSection = {
  intake_type: string;
  entry_semester: number;
  semester_headers: string[];
};

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

const SECTION_ROW_COUNT = 4;

const TEMPLATE_SECTIONS: TemplateSection[] = [
  {
    intake_type: "August Intake",
    entry_semester: 2,
    semester_headers: [
      "SEM 2\nL",
      "SEM 3\nL",
      "SEM 4\nS",
      "SEM 5\nL",
      "SEM 6\nL",
      "SEM 7 (FYP1)\nS",
      "SEM 8 (LI)\nL",
      "SEM 9 (FYP2)\nL",
    ],
  },
  {
    intake_type: "August Intake",
    entry_semester: 3,
    semester_headers: [
      "SEM 3\nL",
      "SEM 4\nL",
      "SEM 5\nS",
      "SEM 6\nL",
      "SEM 7 (FYP1)\nL",
      "SEM 8 (LI)\nS",
      "SEM 9 (FYP2)\nL",
    ],
  },
  {
    intake_type: "August Intake",
    entry_semester: 4,
    semester_headers: [
      "SEM 4\nL",
      "SEM 5\nL",
      "SEM 6\nS",
      "SEM 7 (FYP1)\nL",
      "SEM 8 (LI)\nL",
      "SEM 9 (FYP2)\nS",
    ],
  },
];

const getExcelColumnLetter = (columnNumber: number) => {
  let current = columnNumber;
  let result = "";

  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }

  return result;
};

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
       hp.program_id,
       p.program_code,
       p.program_name,
       p.total_credit_required,
       p.duration_semesters,
       p.long_sem_min_credit,
       p.long_sem_max_credit,
       p.short_sem_min_credit,
       p.short_sem_max_credit
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
  const totalCredits = Number(program.total_credit_required) || 120;
  const durationSemesters = Math.max(Number(program.duration_semesters) || 9, 1);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "UTPM ATS";
  workbook.created = new Date();

  const templateSheet = workbook.addWorksheet("Semester Rules Template");
  templateSheet.properties.defaultRowHeight = 20;

  templateSheet.getCell("A1").value = "Semester Entry Rules Guide Template";
  templateSheet.getCell("A1").font = { bold: true, size: 16 };
  templateSheet.getCell("A2").value =
    "This export follows the HOP guide template style. It is meant as a worksheet guide and does not need to match the raw system import layout.";
  templateSheet.getCell("A2").font = {
    italic: true,
    color: { argb: "FF4B5563" },
  };
  templateSheet.getCell("A3").value = `Program: ${program.program_code} - ${program.program_name}`;
  templateSheet.getCell("A3").font = { size: 11, color: { argb: "FF4B5563" } };

  let currentRowNumber = 5;
  let maxColumnCount = 1;

  const sections = TEMPLATE_SECTIONS.filter(
    (section) => section.entry_semester <= durationSemesters,
  );

  for (const section of sections) {
    const maxSupportedSemester = Math.max(durationSemesters, section.entry_semester);
    const visibleSemesterHeaders = section.semester_headers.filter((header) => {
      const match = header.match(/^SEM\s*(\d+)/i);
      return match ? Number(match[1]) <= maxSupportedSemester : true;
    });

    if (visibleSemesterHeaders.length === 0) {
      continue;
    }

    const headers = [
      "PROGRAM",
      "CREDIT\nTRANSFER",
      "CREDIT\nNEEDED",
      ...visibleSemesterHeaders,
      "CREDIT\nEARNED",
      "TOTAL\nCREDIT",
    ];

    maxColumnCount = Math.max(maxColumnCount, headers.length);

    templateSheet.mergeCells(
      currentRowNumber,
      1,
      currentRowNumber,
      headers.length,
    );

    const titleCell = templateSheet.getCell(currentRowNumber, 1);
    titleCell.value = `${section.intake_type}(SEM ${section.entry_semester})`;
    styleCell(titleCell, {
      bold: true,
      fill: titleFill,
      horizontal: "left",
      fontSize: 12,
    });
    currentRowNumber++;

    const headerRow = templateSheet.getRow(currentRowNumber);
    headerRow.height = 42;

    headers.forEach((header, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = header;
      styleCell(cell, {
        bold: true,
        fill: headerFill,
        wrapText: true,
      });
    });
    currentRowNumber++;

    const dataStartRow = currentRowNumber;
    const semesterColumnStart = 4;
    const creditEarnedColumn = semesterColumnStart + visibleSemesterHeaders.length;
    const totalCreditColumn = creditEarnedColumn + 1;
    const creditTransferColumnLetter = getExcelColumnLetter(2);
    const creditNeededColumnLetter = getExcelColumnLetter(3);
    const totalCreditColumnLetter = getExcelColumnLetter(totalCreditColumn);

    for (let rowOffset = 0; rowOffset < SECTION_ROW_COUNT; rowOffset++) {
      const row = templateSheet.getRow(currentRowNumber);
      row.height = 26;

      row.getCell(totalCreditColumn).value = totalCredits;
      row.getCell(3).value = {
        formula: `IF(${creditTransferColumnLetter}${currentRowNumber}=\"\",\"\",${totalCreditColumnLetter}${currentRowNumber}-${creditTransferColumnLetter}${currentRowNumber})`,
      };
      row.getCell(creditEarnedColumn).value = {
        formula: `IF(${creditNeededColumnLetter}${currentRowNumber}=\"\",\"\",${creditNeededColumnLetter}${currentRowNumber})`,
      };

      for (let columnNumber = 1; columnNumber <= headers.length; columnNumber++) {
        styleCell(row.getCell(columnNumber), {
          horizontal: columnNumber === 1 ? "left" : "center",
        });
      }

      currentRowNumber++;
    }

    const dataEndRow = currentRowNumber - 1;
    if (dataEndRow > dataStartRow) {
      templateSheet.mergeCells(dataStartRow, 1, dataEndRow, 1);
    }

    const programCell = templateSheet.getCell(dataStartRow, 1);
    programCell.value = program.program_code;
    styleCell(programCell, {
      bold: true,
      horizontal: "center",
      wrapText: true,
    });

    currentRowNumber += 2;
  }

  for (let columnNumber = 1; columnNumber <= maxColumnCount; columnNumber++) {
    const column = templateSheet.getColumn(columnNumber);

    if (columnNumber === 1) {
      column.width = 16;
      continue;
    }

    if (columnNumber <= 3 || columnNumber >= maxColumnCount - 1) {
      column.width = 13;
      continue;
    }

    column.width = 11;
  }

  const instructionsSheet = workbook.addWorksheet("Instructions");
  instructionsSheet.columns = [{ width: 24 }, { width: 96 }];
  instructionsSheet.properties.defaultRowHeight = 22;

  instructionsSheet.getCell("A1").value = "Semester Rules Guide Notes";
  instructionsSheet.getCell("A1").font = { bold: true, size: 16 };
  instructionsSheet.getCell("A2").value =
    "This workbook begins from a blank guide template for HOP. It is designed to help build semester entry rules from scratch rather than export the rules already saved in the system.";
  instructionsSheet.getCell("A2").font = {
    italic: true,
    color: { argb: "FF4B5563" },
  };

  instructionsSheet.getCell("A4").value = "Topic";
  instructionsSheet.getCell("B4").value = "Guidance";
  styleCell(instructionsSheet.getCell("A4"), {
    bold: true,
    fill: headerFill,
    horizontal: "left",
  });
  styleCell(instructionsSheet.getCell("B4"), {
    bold: true,
    fill: headerFill,
    horizontal: "left",
  });

  const instructionRows: Array<[string, string]> = [
    [
      "What this template is",
      "The first sheet follows the blank guide layout from the provided sample image. It starts with empty rule rows so HOP can create semester entry rules from nothing.",
    ],
    [
      "Blank starter rows",
      "Each section includes 4 empty rows. Enter the transferred-credit threshold and semester distribution for your real rule set.",
    ],
    [
      "Program column",
      `The PROGRAM column is prefilled with ${program.program_code} as a reference for the workbook.`,
    ],
    [
      "Credit needed and earned",
      "CREDIT NEEDED and CREDIT EARNED are formula-driven. Once you enter CREDIT TRANSFER, Excel will calculate both values automatically.",
    ],
    [
      "Total credit",
      `TOTAL CREDIT is prefilled with ${totalCredits}, based on your current program credit requirement.`,
    ],
    [
      "Semester labels",
      "The semester headers follow the exact guide layout shown in the sample, including L, S, FYP1, LI, and FYP2 markers.",
    ],
    [
      "Program credit limits",
      `Current limits: Long semester ${program.long_sem_min_credit}-${program.long_sem_max_credit} credits, Short semester ${program.short_sem_min_credit}-${program.short_sem_max_credit} credits.`,
    ],
    [
      "Import reminder",
      "This workbook is a guide template. The raw Semester Entry Rules importer still expects the existing import layout, so use this file for planning and preparation rather than direct upload.",
    ],
  ];

  let instructionRowNumber = 5;
  for (const [topic, guidance] of instructionRows) {
    styleInstructionRow(instructionsSheet, instructionRowNumber, topic, guidance);
    instructionRowNumber++;
  }

  const buffer = await workbook.xlsx.writeBuffer();

  setResponseHeaders(event, {
    "Content-Type": EXCEL_MIME_TYPE,
    "Content-Disposition": `attachment; filename="semester_rules_template_${program.program_code}.xlsx"`,
  });

  return buffer;
});
