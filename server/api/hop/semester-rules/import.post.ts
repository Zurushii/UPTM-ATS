import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";
import ExcelJS from "exceljs";

interface ParsedRule {
  intake_type: string;
  credit_transfer: number;
  entry_semester: number;
  credit_plans: Array<{
    semester_number: number;
    semester_type: "L" | "S" | "LI";
    target_credits: number;
  }>;
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
      statusMessage: "No file uploaded",
    });
  }

  const fileField = formData.find((f) => f.name === "file");
  if (!fileField || !fileField.data) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file is required",
    });
  }

  // Parse Excel file using exceljs
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileField.data as any);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file is empty",
    });
  }

  const parsedRules: ParsedRule[] = [];
  let currentIntakeType = "";
  let currentEntrySemester = 0;
  let headerRow: string[] = [];

  worksheet.eachRow((row, rowNumber) => {
    const rowValues = row.values as any[];
    if (!rowValues || rowValues.length === 0) return;

    // ExcelJS row.values is 1-indexed, first element is undefined
    const firstCell = String(rowValues[1] || "").trim();

    // Check if this is a section header (e.g., "August Intake(SEM 2)")
    const sectionMatch = firstCell.match(/^(.+?)\s*\(SEM\s*(\d+)\)$/i);
    if (sectionMatch) {
      currentIntakeType = sectionMatch[1].trim();
      currentEntrySemester = parseInt(sectionMatch[2]);
      return;
    }

    // Check if this is a column header row
    if (firstCell.toUpperCase() === "PROGRAM") {
      headerRow = rowValues.map((cell: any) =>
        String(cell || "").trim().toUpperCase(),
      );

      return;
    }

    // Skip if no intake type set yet
    if (
      !currentIntakeType ||
      currentEntrySemester === 0 ||
      headerRow.length === 0
    ) {
      return;
    }

    // Parse data row
    const creditTransferIdx = headerRow.findIndex(
      (h) => h && h.includes("CREDIT") && h.includes("TRANSFER"),
    );

    if (creditTransferIdx === -1) return;

    const creditTransfer = parseInt(rowValues[creditTransferIdx]);
    if (isNaN(creditTransfer)) return;



    // Parse semester credits from columns
    const creditPlans: ParsedRule["credit_plans"] = [];

    for (let colIdx = 0; colIdx < headerRow.length; colIdx++) {
      const header = headerRow[colIdx];
      if (!header) continue;

      // Match SEM columns like "SEM 2", "SEM 3 L", "SEM 6 (FYP1) S", etc.
      const semMatch = header.match(/^SEM\s*(\d+)/i);
      if (semMatch) {
        const semNumber = parseInt(semMatch[1]);
        const credits = parseInt(rowValues[colIdx]);

        if (!isNaN(credits) && credits > 0) {
          // Determine semester type from header
          const headerUpper = header.toUpperCase();

          // Check for Industrial Training (LI)
          const isLI = headerUpper.includes("(LI)") || headerUpper.includes(" LI");

          // Check if header ends with S or contains (S) or has " S " or "_S"
          const isShort =
            !isLI && (
              headerUpper.endsWith(" S") ||
              headerUpper.endsWith("_S") ||
              headerUpper.includes("(S)") ||
              /\bS\s*$/.test(headerUpper)
            );

          // Default: if neither LI nor Short, default to Long
          const semesterType: "L" | "S" | "LI" = isLI ? "LI" : isShort ? "S" : "L";

          creditPlans.push({
            semester_number: semNumber,
            semester_type: semesterType,
            target_credits: credits,
          });
        }
      }
    }

    parsedRules.push({
      intake_type: currentIntakeType,
      credit_transfer: creditTransfer,
      entry_semester: currentEntrySemester,
      credit_plans: creditPlans,
    });
  });

  if (parsedRules.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "No valid rules found in the Excel file. Make sure the format matches the expected structure.",
    });
  }

  // Insert rules and credit plans into database
  let insertedRules = 0;
  let insertedPlans = 0;

  for (const rule of parsedRules) {
    try {
      // Check if rule already exists
      const [existing] = await pool.query(
        `SELECT id FROM semester_entry_rules 
         WHERE program_id = ? AND intake_type = ? AND credit_transfer = ?`,
        [programId, rule.intake_type, rule.credit_transfer],
      );

      let ruleId: number;

      if ((existing as any[]).length > 0) {
        // Update existing rule
        ruleId = (existing as any[])[0].id;
        await pool.query(
          `UPDATE semester_entry_rules SET entry_semester = ? WHERE id = ?`,
          [rule.entry_semester, ruleId],
        );
      } else {
        // Insert new rule
        const [result] = await pool.query(
          `INSERT INTO semester_entry_rules (program_id, intake_type, credit_transfer, entry_semester)
           VALUES (?, ?, ?, ?)`,
          [
            programId,
            rule.intake_type,
            rule.credit_transfer,
            rule.entry_semester,
          ],
        );
        ruleId = (result as any).insertId;
        insertedRules++;
      }

      // Delete existing credit plans for this rule
      await pool.query(`DELETE FROM semester_credit_plans WHERE rule_id = ?`, [
        ruleId,
      ]);

      // Insert credit plans
      if (rule.credit_plans.length > 0) {
        const planValues = rule.credit_plans.map((plan) => [
          ruleId,
          plan.semester_number,
          plan.semester_type,
          plan.target_credits,
        ]);

        await pool.query(
          `INSERT INTO semester_credit_plans (rule_id, semester_number, semester_type, target_credits)
           VALUES ?`,
          [planValues],
        );
        insertedPlans += rule.credit_plans.length;
      }
    } catch (error: any) {
      console.error(`Error inserting rule:`, error);
      // Continue with other rules
    }
  }

  return {
    message: "Import completed successfully",
    summary: {
      total_rules_parsed: parsedRules.length,
      rules_inserted: insertedRules,
      credit_plans_inserted: insertedPlans,
    },
  };
});
