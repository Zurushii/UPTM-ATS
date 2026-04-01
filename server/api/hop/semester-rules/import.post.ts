import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";
import ExcelJS from "exceljs";

interface ParsedRule {
  intake_type: string;
  credit_transfer: number;
  entry_semester: number;
  credit_plans: Array<{
    semester_number: number;
    semester_type: "L" | "S";
    is_li: boolean;
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
        String(cell || "")
          .trim()
          .toUpperCase(),
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
          const isLI =
            headerUpper.includes("(LI)") || headerUpper.includes(" LI");

          // Check if header ends with S or contains (S) or has " S " or "_S"
          const isShort =
            !isLI &&
            (headerUpper.endsWith(" S") ||
              headerUpper.endsWith("_S") ||
              headerUpper.includes("(S)") ||
              /\bS\s*$/.test(headerUpper));

          // LI is always Long semester; otherwise check Short/Long
          const semesterType: "L" | "S" = isLI ? "L" : isShort ? "S" : "L";

          creditPlans.push({
            semester_number: semNumber,
            semester_type: semesterType,
            is_li: isLI,
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
          plan.is_li,
          plan.target_credits,
        ]);

        await pool.query(
          `INSERT INTO semester_credit_plans (rule_id, semester_number, semester_type, is_li, target_credits)
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

  // Auto-create base rules (entry_semester=1) for each unique intake type that doesn't have one
  const uniqueIntakeTypes = [...new Set(parsedRules.map((r) => r.intake_type))];
  let baseRulesCreated = 0;

  for (const intakeType of uniqueIntakeTypes) {
    const [baseCheck] = await pool.query(
      `SELECT id FROM semester_entry_rules
       WHERE program_id = ? AND intake_type = ? AND credit_transfer = 0 AND entry_semester = 1`,
      [programId, intakeType],
    );

    if ((baseCheck as any[]).length === 0) {
      // Create base rule
      const [baseResult] = await pool.query(
        `INSERT INTO semester_entry_rules (program_id, intake_type, credit_transfer, entry_semester)
         VALUES (?, ?, 0, 1)`,
        [programId, intakeType],
      );

      const baseRuleId = (baseResult as any).insertId;

      // Get program credit limit ranges
      const [progRows] = await pool.query(
        `SELECT short_sem_min_credit, short_sem_max_credit FROM programs WHERE id = ?`,
        [programId],
      );
      const prog = (progRows as any[])[0];
      const shortMin = prog?.short_sem_min_credit ?? 6;
      const shortMax = prog?.short_sem_max_credit ?? 10;

      // Get the latest session that has program_courses for this program
      const [sessionRows] = await pool.query(
        `SELECT s.id AS session_id
         FROM program_sessions s
         WHERE s.program_id = ?
           AND EXISTS (
             SELECT 1
             FROM program_courses pc
             WHERE pc.session_id = s.id
           )
         ORDER BY s.id DESC
         LIMIT 1`,
        [programId],
      );

      if ((sessionRows as any[]).length > 0) {
        const latestSessionId = (sessionRows as any[])[0].session_id;

        // Get total credits per semester from program structure
        const [semCredits] = await pool.query(
          `SELECT pc.semester, SUM(c.credit_hour) AS total_credits
           FROM program_courses pc
           JOIN courses c ON pc.course_id = c.id
           WHERE pc.session_id = ?
           GROUP BY pc.semester
           ORDER BY pc.semester ASC`,
          [latestSessionId],
        );

        const planValues: any[][] = [];
        for (const row of semCredits as any[]) {
          const credits = Number(row.total_credits);
          const semType =
            credits >= shortMin && credits <= shortMax ? "S" : "L";
          planValues.push([baseRuleId, row.semester, semType, 0, credits]);
        }

        if (planValues.length > 0) {
          await pool.query(
            `INSERT INTO semester_credit_plans (rule_id, semester_number, semester_type, is_li, target_credits)
             VALUES ?`,
            [planValues],
          );
        }
      }

      baseRulesCreated++;
      insertedRules++;
    }
  }

  return {
    message: "Import completed successfully",
    summary: {
      total_rules_parsed: parsedRules.length,
      rules_inserted: insertedRules,
      credit_plans_inserted: insertedPlans,
      base_rules_created: baseRulesCreated,
    },
  };
});
