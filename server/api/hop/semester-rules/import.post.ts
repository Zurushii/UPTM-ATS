import ExcelJS from "exceljs";
import { pool } from "~~/server/utils/db";
import {
  ensureSemesterEntryRuleBandColumns,
  getProgramCreditCeiling,
  validateSemesterEntryBands,
} from "~~/server/utils/semester-entry-bands";
import {
  ensureSemesterRuleJourneySlotsSeeded,
  replaceSemesterRuleJourneySlots,
  validateSemesterRuleJourneySlots,
  type SemesterRuleJourneySlot,
} from "~~/server/utils/semester-rule-journeys";
import {
  replaceSemesterRuleExceptionWindows,
  validateSemesterRuleExceptionWindows,
  type SemesterRuleExceptionWindow,
} from "~~/server/utils/semester-rule-exception-windows";
import { auth } from "~~/utils/auth";

interface ParsedImportRow {
  intake_type: string;
  entry_semester: number;
  transfer_min: number | null;
  transfer_max: number | null;
  legacy_threshold: number | null;
  reference_note: string | null;
  journey_slots: SemesterRuleJourneySlot[];
  exact_exception_windows: SemesterRuleExceptionWindow[];
}

interface ParsedJourneyWorksheetRow {
  intake_type: string;
  transfer_min: number;
  transfer_max: number;
  entry_semester: number;
  journey_slots: SemesterRuleJourneySlot[];
}

interface NormalizedImportBand {
  intake_type: string;
  entry_semester: number;
  transfer_min: number;
  transfer_max: number;
  representative_credit: number;
  reference_note: string | null;
  journey_slots: SemesterRuleJourneySlot[];
  exception_windows: SemesterRuleExceptionWindow[];
}

interface ParsedExceptionWorksheetRow {
  intake_type: string;
  transfer_min: number;
  transfer_max: number;
  entry_semester: number;
  slot_order: number;
  allowed_overload_credits: number;
  allowed_underload_credits: number;
  default_reason: string | null;
}

interface LegacyOverlapStandardization {
  intake_type: string;
  transferred_credit: number;
  kept_entry_semester: number;
  discarded_entry_semesters: number[];
}

const normalizeText = (value: unknown) => {
  if (value == null) {
    return "";
  }

  if (typeof value === "object") {
    if ("text" in (value as any) && typeof (value as any).text === "string") {
      return String((value as any).text).trim();
    }

    if (
      "richText" in (value as any) &&
      Array.isArray((value as any).richText)
    ) {
      return (value as any).richText
        .map((part: any) => String(part?.text || ""))
        .join("")
        .trim();
    }

    if ("result" in (value as any)) {
      return normalizeText((value as any).result);
    }
  }

  return String(value).trim();
};

const parseWholeNumber = (value: unknown) => {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const numericValue = Number(text);
  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue)) {
    return null;
  }

  return numericValue;
};

const getRowTexts = (row: ExcelJS.Row) =>
  Array.from({ length: row.cellCount }, (_, index) =>
    normalizeText(row.getCell(index + 1).value),
  );

const getHeaderIndex = (headers: string[], ...patterns: RegExp[]) =>
  headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));

const appendReferenceNote = (base: string | null, addition: string) => {
  const parts = [base?.trim(), addition.trim()].filter(
    (value): value is string => Boolean(value),
  );
  const merged = [...new Set(parts)].join(" | ");
  return merged.length > 255 ? `${merged.slice(0, 252)}...` : merged;
};

const mergeReferenceNotes = (notes: Array<string | null | undefined>) =>
  notes.reduce<string | null>(
    (merged, note) => (note ? appendReferenceNote(merged, note) : merged),
    null,
  );

const normalizeJourneySlots = (slots: SemesterRuleJourneySlot[]) =>
  [...slots]
    .map((slot) => ({
      slot_order: Math.max(Number(slot.slot_order) || 0, 1),
      semester_type: slot.semester_type === "S" ? "S" : "L",
      slot_role: String(slot.slot_role || "regular").toLowerCase() as
        | "regular"
        | "fyp1"
        | "fyp2"
        | "li",
    }))
    .sort((left, right) => left.slot_order - right.slot_order)
    .map((slot, index) => ({
      ...slot,
      slot_order: index + 1,
      semester_type:
        slot.slot_role === "li" || slot.slot_role === "fyp2"
          ? "L"
          : slot.semester_type,
    }));

const normalizeExceptionWindows = (windows: SemesterRuleExceptionWindow[]) =>
  [...windows]
    .map((window) => ({
      ...window,
      slot_order: Math.max(Number(window.slot_order) || 0, 1),
      transfer_min: Math.max(Number(window.transfer_min) || 0, 0),
      transfer_max: Math.max(
        Number(window.transfer_max) || Number(window.transfer_min) || 0,
        Math.max(Number(window.transfer_min) || 0, 0),
      ),
      allowed_overload_credits: Math.max(
        Number(window.allowed_overload_credits) || 0,
        0,
      ),
      allowed_underload_credits: Math.max(
        Number(window.allowed_underload_credits) || 0,
        0,
      ),
      default_reason: window.default_reason
        ? String(window.default_reason).trim() || null
        : null,
    }))
    .filter(
      (window) =>
        window.allowed_overload_credits > 0 ||
        window.allowed_underload_credits > 0,
    )
    .sort((left, right) => {
      if (left.slot_order !== right.slot_order) {
        return left.slot_order - right.slot_order;
      }

      if (left.transfer_min !== right.transfer_min) {
        return left.transfer_min - right.transfer_min;
      }

      return left.transfer_max - right.transfer_max;
    });

const mergeContiguousExceptionWindows = (windows: SemesterRuleExceptionWindow[]) => {
  const grouped: SemesterRuleExceptionWindow[] = [];

  for (const window of normalizeExceptionWindows(windows)) {
    const previous = grouped.at(-1);
    if (
      previous &&
      previous.slot_order === window.slot_order &&
      previous.allowed_overload_credits === window.allowed_overload_credits &&
      previous.allowed_underload_credits === window.allowed_underload_credits &&
      previous.default_reason === window.default_reason &&
      previous.transfer_max + 1 === window.transfer_min
    ) {
      previous.transfer_max = window.transfer_max;
      continue;
    }

    grouped.push({ ...window });
  }

  return grouped;
};

const getSemesterBoundsForImport = ({
  semesterType,
  slotRole,
  longMin,
  longMax,
  shortMin,
  shortMax,
}: {
  semesterType: "L" | "S";
  slotRole: SemesterRuleJourneySlot["slot_role"];
  longMin: number;
  longMax: number;
  shortMin: number;
  shortMax: number;
}) => {
  if (slotRole === "li") {
    return null;
  }

  if (semesterType === "L") {
    return { min: longMin, max: longMax };
  }

  return { min: shortMin, max: shortMax };
};

const getJourneySlotColumnsFromHeaders = (
  headers: string[],
  entrySemester: number,
) =>
  headers
    .map((header, index) => ({ header: header.trim(), columnIndex: index }))
    .map(({ header, columnIndex }) => {
      const semesterMatch = header.match(/^SEM\s*(\d+)/i);
      if (!semesterMatch) {
        return null;
      }

      const semesterNumber = Number.parseInt(semesterMatch[1] || "", 10);
      if (!Number.isInteger(semesterNumber) || semesterNumber < entrySemester) {
        return null;
      }

      const headerUpper = header.toUpperCase();
      let slotRole: SemesterRuleJourneySlot["slot_role"] = "regular";

      if (
        headerUpper.includes("(LI)") ||
        headerUpper.includes(" LI") ||
        headerUpper.includes("LI)")
      ) {
        slotRole = "li";
      } else if (/FYP\s*2|FYP2|\(FYP2\)|\bFYP II\b/i.test(headerUpper)) {
        slotRole = "fyp2";
      } else if (/FYP\s*1|FYP1|\(FYP1\)|\bFYP\b/i.test(headerUpper)) {
        slotRole = "fyp1";
      }

      const isShort =
        slotRole !== "li" &&
        slotRole !== "fyp2" &&
        (headerUpper.endsWith(" S") ||
          headerUpper.endsWith("_S") ||
          headerUpper.includes("(S)") ||
          /\bS\s*$/.test(headerUpper));

      return {
        column_index: columnIndex,
        slot: {
          slot_order: semesterNumber - entrySemester + 1,
          semester_type: isShort ? ("S" as const) : ("L" as const),
          slot_role: slotRole,
        },
      };
    })
    .filter(
      (
        slot,
      ): slot is { column_index: number; slot: SemesterRuleJourneySlot } =>
        slot !== null,
    )
    .sort((left, right) => left.slot.slot_order - right.slot.slot_order)
    .map((entry, index) => ({
      column_index: entry.column_index,
      slot: {
        ...entry.slot,
        slot_order: index + 1,
        semester_type:
          entry.slot.slot_role === "li" || entry.slot.slot_role === "fyp2"
            ? "L"
            : entry.slot.semester_type,
      },
    }));

const parseJourneySlotsFromHeaders = (
  headers: string[],
  entrySemester: number,
) =>
  normalizeJourneySlots(
    getJourneySlotColumnsFromHeaders(headers, entrySemester).map(
      (entry) => entry.slot,
    ),
  );

const standardizeLegacyThresholdRows = ({
  intakeType,
  rows,
}: {
  intakeType: string;
  rows: ParsedImportRow[];
}) => {
  const standardizedRows: ParsedImportRow[] = [];
  const overlapStandardizations: LegacyOverlapStandardization[] = [];
  const rowsByThreshold = new Map<number, ParsedImportRow[]>();

  for (const row of rows) {
    if (row.legacy_threshold == null) {
      continue;
    }

    const threshold = Number(row.legacy_threshold);
    if (!rowsByThreshold.has(threshold)) {
      rowsByThreshold.set(threshold, []);
    }
    rowsByThreshold.get(threshold)!.push(row);
  }

  const sortedThresholds = Array.from(rowsByThreshold.keys()).sort(
    (left, right) => left - right,
  );

  for (const threshold of sortedThresholds) {
    const thresholdRows = rowsByThreshold.get(threshold) || [];
    const sortedRows = [...thresholdRows].sort((left, right) => {
      if (left.entry_semester !== right.entry_semester) {
        return left.entry_semester - right.entry_semester;
      }

      if (left.journey_slots.length !== right.journey_slots.length) {
        return right.journey_slots.length - left.journey_slots.length;
      }

      const leftHasNote = left.reference_note ? 0 : 1;
      const rightHasNote = right.reference_note ? 0 : 1;
      return leftHasNote - rightHasNote;
    });

    const primaryRow = sortedRows[0];
    if (!primaryRow) {
      continue;
    }

    const discardedEntrySemesters = [
      ...new Set(
        sortedRows
          .slice(1)
          .map((row) => row.entry_semester)
          .filter((semester) => semester !== primaryRow.entry_semester),
      ),
    ].sort((left, right) => left - right);

    standardizedRows.push({
      ...primaryRow,
      reference_note:
        discardedEntrySemesters.length > 0
          ? appendReferenceNote(
              primaryRow.reference_note,
              `Legacy overlap defaulted to Sem ${primaryRow.entry_semester}. Override if needed.`,
            )
          : primaryRow.reference_note,
    });

    if (discardedEntrySemesters.length > 0) {
      overlapStandardizations.push({
        intake_type: intakeType,
        transferred_credit: threshold,
        kept_entry_semester: primaryRow.entry_semester,
        discarded_entry_semesters: discardedEntrySemesters,
      });
    }
  }

  return {
    standardizedRows,
    overlapStandardizations,
  };
};

const parseBandWorksheet = ({
  worksheet,
  longMin,
  longMax,
  shortMin,
  shortMax,
}: {
  worksheet: ExcelJS.Worksheet;
  longMin: number;
  longMax: number;
  shortMin: number;
  shortMax: number;
}) => {
  const parsedRows: ParsedImportRow[] = [];
  let currentIntakeType = "";
  let currentSectionEntrySemester: number | null = null;
  let headerRow: string[] = [];
  let currentSectionJourneySlots: SemesterRuleJourneySlot[] = [];
  let currentSectionJourneyColumns: Array<{
    column_index: number;
    slot: SemesterRuleJourneySlot;
  }> = [];

  worksheet.eachRow((row) => {
    const rowTexts = getRowTexts(row);
    const nonEmptyTexts = rowTexts.filter((value) => value.length > 0);

    if (nonEmptyTexts.length === 0) {
      return;
    }

    const firstCell = rowTexts[0] || "";
    const normalizedHeaders = rowTexts.map((value) => value.toUpperCase());
    const sectionMatch = firstCell.match(/^(.+?)\s*\(SEM(?:ESTER)?\s*(\d+)\)$/i);

    if (sectionMatch) {
      currentIntakeType = sectionMatch[1]!.trim();
      currentSectionEntrySemester = Number.parseInt(sectionMatch[2] || "", 10);
      headerRow = [];
      currentSectionJourneySlots = [];
      currentSectionJourneyColumns = [];
      return;
    }

    if (
      nonEmptyTexts.length === 1 &&
      /intake/i.test(firstCell) &&
      !/reference|program|transfer|semester/i.test(firstCell)
    ) {
      currentIntakeType = firstCell;
      currentSectionEntrySemester = null;
      headerRow = [];
      currentSectionJourneySlots = [];
      currentSectionJourneyColumns = [];
      return;
    }

    const hasBandHeader =
      normalizedHeaders.includes("INTAKE TYPE") ||
      normalizedHeaders.includes("REFERENCE NOTE") ||
      normalizedHeaders.includes("PROGRAM") ||
      normalizedHeaders.some((value) => /TRANSFER\s*MIN/i.test(value)) ||
      normalizedHeaders.some((value) => /CREDIT\s*TRANSFER/i.test(value));

    if (hasBandHeader) {
      headerRow = normalizedHeaders;
      currentSectionJourneySlots =
        currentSectionEntrySemester != null
          ? parseJourneySlotsFromHeaders(headerRow, currentSectionEntrySemester)
          : [];
      currentSectionJourneyColumns =
        currentSectionEntrySemester != null
          ? getJourneySlotColumnsFromHeaders(headerRow, currentSectionEntrySemester)
          : [];
      return;
    }

    if (headerRow.length === 0) {
      return;
    }

    const intakeTypeIndex = getHeaderIndex(headerRow, /^INTAKE TYPE$/i);
    const referenceNoteIndex = getHeaderIndex(headerRow, /^REFERENCE NOTE$/i);
    const transferMinIndex = getHeaderIndex(
      headerRow,
      /^TRANSFER\s*MIN$/i,
      /^BAND\s*TRANSFER\s*MIN$/i,
    );
    const transferMaxIndex = getHeaderIndex(
      headerRow,
      /^TRANSFER\s*MAX$/i,
      /^BAND\s*TRANSFER\s*MAX$/i,
    );
    const legacyThresholdIndex = getHeaderIndex(
      headerRow,
      /^CREDIT\s*TRANSFER$/i,
      /^TRANSFERRED\s*CREDITS?$/i,
    );
    const entrySemesterIndex = getHeaderIndex(
      headerRow,
      /^ENTRY\s*SEMESTER$/i,
      /^ENTRY\s*LEVEL$/i,
    );

    const intakeType =
      (intakeTypeIndex >= 0
        ? normalizeText(rowTexts[intakeTypeIndex])
        : currentIntakeType) || currentIntakeType;
    const entrySemester =
      (entrySemesterIndex >= 0
        ? parseWholeNumber(rowTexts[entrySemesterIndex])
        : currentSectionEntrySemester) ?? null;
    const transferMin =
      transferMinIndex >= 0 ? parseWholeNumber(rowTexts[transferMinIndex]) : null;
    const transferMax =
      transferMaxIndex >= 0 ? parseWholeNumber(rowTexts[transferMaxIndex]) : null;
    const legacyThreshold =
      transferMinIndex === -1 && transferMaxIndex === -1 && legacyThresholdIndex >= 0
        ? parseWholeNumber(rowTexts[legacyThresholdIndex])
        : null;

    if (
      !intakeType ||
      entrySemester == null ||
      (!Number.isInteger(transferMin) &&
        !Number.isInteger(transferMax) &&
        !Number.isInteger(legacyThreshold))
    ) {
      return;
    }

    const exactExceptionWindows =
      legacyThreshold != null
        ? currentSectionJourneyColumns
            .map(({ column_index, slot }) => {
              const targetCredits = parseWholeNumber(rowTexts[column_index]);
              if (targetCredits == null) {
                return null;
              }

              const bounds = getSemesterBoundsForImport({
                semesterType: slot.semester_type,
                slotRole: slot.slot_role,
                longMin,
                longMax,
                shortMin,
                shortMax,
              });

              if (!bounds) {
                return null;
              }

              const allowedOverload = Math.max(targetCredits - bounds.max, 0);
              const allowedUnderload = Math.max(bounds.min - targetCredits, 0);
              if (allowedOverload <= 0 && allowedUnderload <= 0) {
                return null;
              }

              return {
                slot_order: slot.slot_order,
                transfer_min: legacyThreshold,
                transfer_max: legacyThreshold,
                allowed_overload_credits: allowedOverload,
                allowed_underload_credits: allowedUnderload,
                default_reason: "Imported from legacy workbook.",
              } satisfies SemesterRuleExceptionWindow;
            })
            .filter(
              (window): window is SemesterRuleExceptionWindow => window !== null,
            )
        : [];

    parsedRows.push({
      intake_type: intakeType,
      entry_semester: entrySemester,
      transfer_min: transferMin,
      transfer_max: transferMax,
      legacy_threshold: legacyThreshold,
      reference_note:
        referenceNoteIndex >= 0
          ? normalizeText(rowTexts[referenceNoteIndex]) || null
          : null,
      journey_slots: currentSectionJourneySlots,
      exact_exception_windows: exactExceptionWindows,
    });
  });

  return parsedRows;
};

const parseJourneyWorksheet = (worksheet: ExcelJS.Worksheet) => {
  const rows: ParsedJourneyWorksheetRow[] = [];
  let headerRow: string[] = [];

  worksheet.eachRow((row) => {
    const rowTexts = getRowTexts(row);
    const nonEmptyTexts = rowTexts.filter((value) => value.length > 0);

    if (nonEmptyTexts.length === 0) {
      return;
    }

    const normalizedHeaders = rowTexts.map((value) => value.toUpperCase());
    const hasJourneyHeader =
      normalizedHeaders.includes("INTAKE TYPE") &&
      normalizedHeaders.some((value) => /TRANSFER\s*MIN/i.test(value)) &&
      normalizedHeaders.some((value) => /TRANSFER\s*MAX/i.test(value)) &&
      normalizedHeaders.includes("ENTRY SEMESTER") &&
      normalizedHeaders.includes("SLOT ORDER") &&
      normalizedHeaders.includes("SEMESTER TYPE") &&
      normalizedHeaders.includes("SLOT ROLE");

    if (hasJourneyHeader) {
      headerRow = normalizedHeaders;
      return;
    }

    if (headerRow.length === 0) {
      return;
    }

    const intakeTypeIndex = getHeaderIndex(headerRow, /^INTAKE TYPE$/i);
    const transferMinIndex = getHeaderIndex(headerRow, /^TRANSFER\s*MIN$/i);
    const transferMaxIndex = getHeaderIndex(headerRow, /^TRANSFER\s*MAX$/i);
    const entrySemesterIndex = getHeaderIndex(headerRow, /^ENTRY\s*SEMESTER$/i);
    const slotOrderIndex = getHeaderIndex(headerRow, /^SLOT ORDER$/i);
    const semesterTypeIndex = getHeaderIndex(headerRow, /^SEMESTER TYPE$/i);
    const slotRoleIndex = getHeaderIndex(headerRow, /^SLOT ROLE$/i);

    const intakeType = normalizeText(rowTexts[intakeTypeIndex]);
    const transferMin = parseWholeNumber(rowTexts[transferMinIndex]);
    const transferMax = parseWholeNumber(rowTexts[transferMaxIndex]);
    const entrySemester = parseWholeNumber(rowTexts[entrySemesterIndex]);
    const slotOrder = parseWholeNumber(rowTexts[slotOrderIndex]);
    const semesterType = normalizeText(rowTexts[semesterTypeIndex]).toUpperCase();
    const slotRole = normalizeText(rowTexts[slotRoleIndex]);

    if (
      !intakeType ||
      transferMin == null ||
      transferMax == null ||
      entrySemester == null ||
      slotOrder == null ||
      !["L", "S"].includes(semesterType)
    ) {
      return;
    }

    rows.push({
      intake_type: intakeType,
      transfer_min: transferMin,
      transfer_max: transferMax,
      entry_semester: entrySemester,
      journey_slots: normalizeJourneySlots([
        {
          slot_order: slotOrder,
          semester_type: semesterType as "L" | "S",
          slot_role: (slotRole || "regular") as SemesterRuleJourneySlot["slot_role"],
        },
      ]),
    });
  });

  const grouped = new Map<string, ParsedJourneyWorksheetRow>();
  for (const row of rows) {
    const key = [
      row.intake_type.trim().toLowerCase(),
      row.transfer_min,
      row.transfer_max,
      row.entry_semester,
    ].join("::");
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...row,
        journey_slots: [...row.journey_slots],
      });
      continue;
    }

    existing.journey_slots.push(...row.journey_slots);
    existing.journey_slots = normalizeJourneySlots(existing.journey_slots);
  }

  return Array.from(grouped.values());
};

const parseExceptionWorksheet = (worksheet: ExcelJS.Worksheet) => {
  const rows: ParsedExceptionWorksheetRow[] = [];
  let headerRow: string[] = [];

  worksheet.eachRow((row) => {
    const rowTexts = getRowTexts(row);
    const nonEmptyTexts = rowTexts.filter((value) => value.length > 0);

    if (nonEmptyTexts.length === 0) {
      return;
    }

    const normalizedHeaders = rowTexts.map((value) => value.toUpperCase());
    const hasExceptionHeader =
      normalizedHeaders.includes("INTAKE TYPE") &&
      normalizedHeaders.some((value) => /TRANSFER\s*MIN/i.test(value)) &&
      normalizedHeaders.some((value) => /TRANSFER\s*MAX/i.test(value)) &&
      normalizedHeaders.includes("ENTRY SEMESTER") &&
      normalizedHeaders.includes("SLOT ORDER") &&
      normalizedHeaders.some((value) => /ALLOWED\s*OVERLOAD/i.test(value)) &&
      normalizedHeaders.some((value) => /ALLOWED\s*UNDERLOAD/i.test(value));

    if (hasExceptionHeader) {
      headerRow = normalizedHeaders;
      return;
    }

    if (headerRow.length === 0) {
      return;
    }

    const intakeTypeIndex = getHeaderIndex(headerRow, /^INTAKE TYPE$/i);
    const transferMinIndex = getHeaderIndex(headerRow, /^TRANSFER\s*MIN$/i);
    const transferMaxIndex = getHeaderIndex(headerRow, /^TRANSFER\s*MAX$/i);
    const entrySemesterIndex = getHeaderIndex(headerRow, /^ENTRY\s*SEMESTER$/i);
    const slotOrderIndex = getHeaderIndex(headerRow, /^SLOT ORDER$/i);
    const overloadIndex = getHeaderIndex(
      headerRow,
      /^ALLOWED\s*OVERLOAD\s*CREDITS$/i,
    );
    const underloadIndex = getHeaderIndex(
      headerRow,
      /^ALLOWED\s*UNDERLOAD\s*CREDITS$/i,
    );
    const defaultReasonIndex = getHeaderIndex(
      headerRow,
      /^DEFAULT\s*REASON$/i,
    );

    const intakeType = normalizeText(rowTexts[intakeTypeIndex]);
    const transferMin = parseWholeNumber(rowTexts[transferMinIndex]);
    const transferMax = parseWholeNumber(rowTexts[transferMaxIndex]);
    const entrySemester = parseWholeNumber(rowTexts[entrySemesterIndex]);
    const slotOrder = parseWholeNumber(rowTexts[slotOrderIndex]);
    const overloadCredits = parseWholeNumber(rowTexts[overloadIndex]) ?? 0;
    const underloadCredits = parseWholeNumber(rowTexts[underloadIndex]) ?? 0;
    const defaultReason =
      defaultReasonIndex >= 0
        ? normalizeText(rowTexts[defaultReasonIndex]) || null
        : null;

    if (
      !intakeType ||
      transferMin == null ||
      transferMax == null ||
      entrySemester == null ||
      slotOrder == null ||
      (overloadCredits <= 0 && underloadCredits <= 0)
    ) {
      return;
    }

    rows.push({
      intake_type: intakeType,
      transfer_min: transferMin,
      transfer_max: transferMax,
      entry_semester: entrySemester,
      slot_order: slotOrder,
      allowed_overload_credits: overloadCredits,
      allowed_underload_credits: underloadCredits,
      default_reason: defaultReason,
    });
  });

  return rows;
};

const getNormalizedBandsForIntake = ({
  intakeType,
  rows,
  creditCeiling,
}: {
  intakeType: string;
  rows: ParsedImportRow[];
  creditCeiling: number;
}) => {
  const normalizedBands: NormalizedImportBand[] = [];
  const explicitBands = rows.filter(
    (row) => row.transfer_min != null && row.transfer_max != null,
  );
  const { standardizedRows: legacyRows, overlapStandardizations } =
    standardizeLegacyThresholdRows({
      intakeType,
      rows,
    });

  for (const row of explicitBands) {
    normalizedBands.push({
      intake_type: intakeType,
      entry_semester: row.entry_semester,
      transfer_min: Number(row.transfer_min),
      transfer_max: Number(row.transfer_max),
      representative_credit: Number(row.transfer_min),
      reference_note: row.reference_note,
      journey_slots: row.journey_slots,
      exception_windows: [],
    });
  }

  if (legacyRows.length > 0) {
    const firstLegacyThreshold = Number(legacyRows[0]!.legacy_threshold);

    if (firstLegacyThreshold > 0) {
      normalizedBands.push({
        intake_type: intakeType,
        entry_semester: 1,
        transfer_min: 0,
        transfer_max: Math.max(firstLegacyThreshold - 1, 0),
        representative_credit: 0,
        reference_note: "System generated Semester 1 band from legacy import.",
        journey_slots: [],
        exception_windows: [],
      });
    }

    let groupStartIndex = 0;
    while (groupStartIndex < legacyRows.length) {
      const groupEntrySemester = legacyRows[groupStartIndex]!.entry_semester;
      let groupEndIndex = groupStartIndex;

      while (
        groupEndIndex + 1 < legacyRows.length &&
        legacyRows[groupEndIndex + 1]!.entry_semester === groupEntrySemester
      ) {
        groupEndIndex += 1;
      }

      const groupRows = legacyRows.slice(groupStartIndex, groupEndIndex + 1);
      const nextGroupFirstRow = legacyRows[groupEndIndex + 1] || null;
      const transferMin = Number(groupRows[0]!.legacy_threshold);
      const transferMax = nextGroupFirstRow
        ? Math.max(Number(nextGroupFirstRow.legacy_threshold) - 1, transferMin)
        : Math.max(
            Number(groupRows[groupRows.length - 1]!.legacy_threshold),
            transferMin,
          );
      const groupedExceptionWindows = mergeContiguousExceptionWindows(
        groupRows.flatMap((row, rowIndex) => {
          const currentThreshold = Number(row.legacy_threshold);
          const nextThreshold = Number(
            groupRows[rowIndex + 1]?.legacy_threshold ?? transferMax + 1,
          );
          const rowTransferMax = Math.max(
            Math.min(nextThreshold - 1, transferMax),
            currentThreshold,
          );

          return row.exact_exception_windows.map((window) => ({
            ...window,
            transfer_min: currentThreshold,
            transfer_max: rowTransferMax,
          }));
        }),
      );

      normalizedBands.push({
        intake_type: intakeType,
        entry_semester: groupEntrySemester,
        transfer_min: transferMin,
        transfer_max: transferMax,
        representative_credit: transferMin,
        reference_note: mergeReferenceNotes(
          groupRows.map((row) => row.reference_note),
        ),
        journey_slots: groupRows[0]?.journey_slots || [],
        exception_windows: groupedExceptionWindows,
      });

      groupStartIndex = groupEndIndex + 1;
    }
  }

  return {
    normalizedBands: normalizedBands.sort((left, right) => {
      if (left.transfer_min !== right.transfer_min) {
        return left.transfer_min - right.transfer_min;
      }

      if (left.transfer_max !== right.transfer_max) {
        return left.transfer_max - right.transfer_max;
      }

      return left.entry_semester - right.entry_semester;
    }),
    overlapStandardizations,
  };
};

const formatValidationMessage = (
  intakeType: string,
  issues: { message: string }[],
) =>
  `Invalid semester-entry band table for ${intakeType}: ${issues
    .map((issue) => issue.message)
    .join(" ")}`;

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
  const [programRows] = await pool.query(
    `SELECT
       long_sem_min_credit,
       long_sem_max_credit,
       short_sem_min_credit,
       short_sem_max_credit
     FROM programs
     WHERE id = ?`,
    [programId],
  );
  const program = (programRows as any[])[0] || {};
  const longMin = Number(program.long_sem_min_credit ?? 12);
  const longMax = Number(program.long_sem_max_credit ?? 20);
  const shortMin = Number(program.short_sem_min_credit ?? 6);
  const shortMax = Number(program.short_sem_max_credit ?? 10);
  const creditCeiling = await getProgramCreditCeiling(programId);
  await ensureSemesterEntryRuleBandColumns();

  const formData = await readMultipartFormData(event);
  if (!formData) {
    throw createError({
      statusCode: 400,
      statusMessage: "No file uploaded",
    });
  }

  const fileField = formData.find((field) => field.name === "file");
  if (!fileField?.data) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file is required",
    });
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileField.data as any);

  const bandsWorksheet =
    workbook.getWorksheet("Entry Bands") ||
    workbook.getWorksheet("Semester Entry Bands Template") ||
    workbook.worksheets[0];

  if (!bandsWorksheet) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file is empty",
    });
  }

  const parsedRows = parseBandWorksheet({
    worksheet: bandsWorksheet,
    longMin,
    longMax,
    shortMin,
    shortMax,
  });
  const parsedJourneyRows = workbook.getWorksheet("Band Journeys")
    ? parseJourneyWorksheet(workbook.getWorksheet("Band Journeys")!)
    : [];
  const parsedExceptionRows = workbook.getWorksheet("Exception Windows")
    ? parseExceptionWorksheet(workbook.getWorksheet("Exception Windows")!)
    : [];

  if (parsedRows.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "No valid semester-entry bands were found in the Excel file.",
    });
  }

  const rowsByIntake = new Map<string, ParsedImportRow[]>();
  for (const row of parsedRows) {
    if (!rowsByIntake.has(row.intake_type)) {
      rowsByIntake.set(row.intake_type, []);
    }
    rowsByIntake.get(row.intake_type)!.push(row);
  }

  const normalizedBandsByIntake = new Map<string, NormalizedImportBand[]>();
  const overlapStandardizations: LegacyOverlapStandardization[] = [];

  for (const [intakeType, rows] of rowsByIntake.entries()) {
    const normalizedResult = getNormalizedBandsForIntake({
      intakeType,
      rows,
      creditCeiling,
    });
    overlapStandardizations.push(...normalizedResult.overlapStandardizations);

    const validation = validateSemesterEntryBands({
      bands: normalizedResult.normalizedBands.map((band, index) => ({
        id: index + 1,
        transfer_min: band.transfer_min,
        transfer_max: band.transfer_max,
        entry_semester: band.entry_semester,
      })),
      creditCeiling,
    });

    if (!validation.is_valid) {
      throw createError({
        statusCode: 400,
        statusMessage: formatValidationMessage(intakeType, validation.issues),
      });
    }

    normalizedBandsByIntake.set(intakeType, normalizedResult.normalizedBands);
  }

  for (const journeyRow of parsedJourneyRows) {
    const intakeBands = normalizedBandsByIntake.get(journeyRow.intake_type);

    if (!intakeBands) {
      throw createError({
        statusCode: 400,
        statusMessage: `Journey sheet references an unknown intake type: ${journeyRow.intake_type}.`,
      });
    }

    const matchingBand = intakeBands.find(
      (band) =>
        band.transfer_min === journeyRow.transfer_min &&
        band.transfer_max === journeyRow.transfer_max &&
        band.entry_semester === journeyRow.entry_semester,
    );

    if (!matchingBand) {
      throw createError({
        statusCode: 400,
        statusMessage: `Journey sheet row for ${journeyRow.intake_type} ${journeyRow.transfer_min}-${journeyRow.transfer_max} does not match any imported band.`,
      });
    }

    matchingBand.journey_slots = normalizeJourneySlots(journeyRow.journey_slots);
  }

  const exceptionRowsByBand = new Map<string, ParsedExceptionWorksheetRow[]>();
  for (const exceptionRow of parsedExceptionRows) {
    const key = [
      exceptionRow.intake_type.trim().toLowerCase(),
      exceptionRow.transfer_min,
      exceptionRow.transfer_max,
      exceptionRow.entry_semester,
    ].join("::");

    if (!exceptionRowsByBand.has(key)) {
      exceptionRowsByBand.set(key, []);
    }

    exceptionRowsByBand.get(key)!.push(exceptionRow);
  }

  for (const [key, rows] of exceptionRowsByBand.entries()) {
    const [normalizedIntakeType, transferMinText, transferMaxText, entrySemesterText] =
      key.split("::");
    const intakeBands = Array.from(normalizedBandsByIntake.entries()).find(
      ([intakeType]) => intakeType.trim().toLowerCase() === normalizedIntakeType,
    )?.[1];

    if (!intakeBands) {
      throw createError({
        statusCode: 400,
        statusMessage: `Exception Windows sheet references an unknown intake type: ${rows[0]?.intake_type || normalizedIntakeType}.`,
      });
    }

    const transferMin = Number(transferMinText);
    const transferMax = Number(transferMaxText);
    const entrySemester = Number(entrySemesterText);
    const matchingBand = intakeBands.find(
      (band) =>
        band.transfer_min === transferMin &&
        band.transfer_max === transferMax &&
        band.entry_semester === entrySemester,
    );

    if (!matchingBand) {
      throw createError({
        statusCode: 400,
        statusMessage: `Exception Windows row for ${rows[0]?.intake_type || normalizedIntakeType} ${transferMin}-${transferMax} does not match any imported band.`,
      });
    }

    matchingBand.exception_windows = mergeContiguousExceptionWindows(
      rows.map((exceptionRow) => ({
        slot_order: exceptionRow.slot_order,
        transfer_min: exceptionRow.transfer_min,
        transfer_max: exceptionRow.transfer_max,
        allowed_overload_credits: exceptionRow.allowed_overload_credits,
        allowed_underload_credits: exceptionRow.allowed_underload_credits,
        default_reason: exceptionRow.default_reason,
      })),
    );
  }

  let insertedRules = 0;
  let insertedJourneySlots = 0;
  let insertedExceptionWindows = 0;

  for (const [intakeType, normalizedBands] of normalizedBandsByIntake.entries()) {
    const importedRangeKeys = new Set(
      normalizedBands.map((band) => `${band.transfer_min}:${band.transfer_max}`),
    );

    const [existingRows] = await pool.query(
      `SELECT id,
              COALESCE(transfer_min, credit_transfer) AS transfer_min,
              COALESCE(transfer_max, credit_transfer) AS transfer_max
       FROM semester_entry_rules
       WHERE program_id = ? AND intake_type = ?`,
      [programId, intakeType],
    );

    const staleRuleIds = (existingRows as any[])
      .filter((row) => {
        const key = `${Number(row.transfer_min)}:${Number(row.transfer_max)}`;
        return !importedRangeKeys.has(key);
      })
      .map((row) => Number(row.id))
      .filter((id) => id > 0);

    if (staleRuleIds.length > 0) {
      const placeholders = staleRuleIds.map(() => "?").join(", ");
      await pool.query(
        `DELETE FROM semester_entry_rules WHERE id IN (${placeholders})`,
        staleRuleIds,
      );
    }

    for (const band of normalizedBands) {
      const [existingBandRows] = await pool.query(
        `SELECT id
         FROM semester_entry_rules
         WHERE program_id = ?
           AND intake_type = ?
           AND COALESCE(transfer_min, credit_transfer) = ?
           AND COALESCE(transfer_max, credit_transfer) = ?
         LIMIT 1`,
        [programId, intakeType, band.transfer_min, band.transfer_max],
      );

      let ruleId = 0;

      if ((existingBandRows as any[]).length > 0) {
        ruleId = Number((existingBandRows as any[])[0].id);
        await pool.query(
          `UPDATE semester_entry_rules
           SET credit_transfer = ?,
               transfer_min = ?,
               transfer_max = ?,
               entry_semester = ?,
               reference_note = ?
           WHERE id = ?`,
          [
            band.representative_credit,
            band.transfer_min,
            band.transfer_max,
            band.entry_semester,
            band.reference_note,
            ruleId,
          ],
        );
      } else {
        const [insertResult] = await pool.query(
          `INSERT INTO semester_entry_rules (
             program_id,
             intake_type,
             credit_transfer,
             transfer_min,
             transfer_max,
             entry_semester,
             reference_note
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            programId,
            intakeType,
            band.representative_credit,
            band.transfer_min,
            band.transfer_max,
            band.entry_semester,
            band.reference_note,
          ],
        );

        ruleId = Number((insertResult as any).insertId);
        insertedRules += 1;
      }

      const slotsToSave =
        band.journey_slots.length > 0
          ? normalizeJourneySlots(band.journey_slots)
          : [];

      if (slotsToSave.length > 0) {
        const validation = await validateSemesterRuleJourneySlots({
          slots: slotsToSave,
          entrySemester: Number(band.entry_semester),
        });

        if (validation.issues.length > 0) {
          throw createError({
            statusCode: 400,
            statusMessage:
              validation.issues[0]?.message ||
              `Journey for ${band.intake_type} ${band.transfer_min}-${band.transfer_max} is invalid.`,
          });
        }

        await replaceSemesterRuleJourneySlots({
          ruleId,
          slots: slotsToSave,
        });
        insertedJourneySlots += slotsToSave.length;

        const exceptionValidation = validateSemesterRuleExceptionWindows({
          windows: band.exception_windows,
          bandTransferMin: band.transfer_min,
          bandTransferMax: band.transfer_max,
          slotCount: slotsToSave.length,
          slotRolesByOrder: new Map(
            slotsToSave.map((slot) => [slot.slot_order, slot.slot_role]),
          ),
        });

        if (exceptionValidation.issues.length > 0) {
          throw createError({
            statusCode: 400,
            statusMessage:
              exceptionValidation.issues[0]?.message ||
              `Exception windows for ${band.intake_type} ${band.transfer_min}-${band.transfer_max} are invalid.`,
          });
        }

        await replaceSemesterRuleExceptionWindows({
          ruleId,
          windows: band.exception_windows,
        });
        insertedExceptionWindows += band.exception_windows.length;
      } else {
        const seededSlots = await ensureSemesterRuleJourneySlotsSeeded({
          rule: {
            id: ruleId,
            program_id: programId,
            intake_type: intakeType,
            credit_transfer: band.representative_credit,
            transfer_min: band.transfer_min,
            transfer_max: band.transfer_max,
            entry_semester: band.entry_semester,
            reference_note: band.reference_note,
          },
          programId,
        });

        insertedJourneySlots += seededSlots.length;

        const exceptionValidation = validateSemesterRuleExceptionWindows({
          windows: band.exception_windows,
          bandTransferMin: band.transfer_min,
          bandTransferMax: band.transfer_max,
          slotCount: seededSlots.length,
          slotRolesByOrder: new Map(
            seededSlots.map((slot) => [slot.slot_order, slot.slot_role]),
          ),
        });

        if (exceptionValidation.issues.length > 0) {
          throw createError({
            statusCode: 400,
            statusMessage:
              exceptionValidation.issues[0]?.message ||
              `Exception windows for ${band.intake_type} ${band.transfer_min}-${band.transfer_max} are invalid.`,
          });
        }

        await replaceSemesterRuleExceptionWindows({
          ruleId,
          windows: band.exception_windows,
        });
        insertedExceptionWindows += band.exception_windows.length;
      }
    }
  }

  return {
    message: "Import completed successfully",
    summary: {
      total_rules_parsed: Array.from(normalizedBandsByIntake.values()).reduce(
        (sum, bands) => sum + bands.length,
        0,
      ),
      rules_inserted: insertedRules,
      journey_slots_inserted: insertedJourneySlots,
      exception_windows_inserted: insertedExceptionWindows,
      overlap_standardization_count: overlapStandardizations.length,
      overlap_standardizations: overlapStandardizations,
    },
  };
});
