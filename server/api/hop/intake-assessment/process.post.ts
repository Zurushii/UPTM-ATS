import { pool } from "~~/server/utils/db";
import {
  ensureStudentEntrySemesterColumns,
  getProgramCreditCeiling,
  getSemesterEntryBands,
  validateSemesterEntryBands,
} from "~~/server/utils/semester-entry-bands";
import {
  resolveProgramSessionForIntake,
  resolveSemesterRuleSetForIntake,
} from "~~/server/utils/intake-planning-config";
import { resolveSemesterRuleJourney } from "~~/server/utils/semester-rule-journeys";
import { auth } from "~~/utils/auth";
import ExcelJS from "exceljs";

interface ProcessedStudent {
  student_id: number;
  matric_no: string;
  intake_year: string;
  total_credit_transferred: number;
  starting_semester: number;
  program_code: string;
  transferred_courses: string;
  // Internal fields
  entry_semester: number;
  system_assigned_entry_semester: number;
  final_entry_semester: number;
  entry_semester_rule_id: number | null;
  entry_semester_assignment_note: string | null;
  transferred_course_ids: number[];
  is_new_student: boolean; // true if student was created during processing
  has_error: boolean; // true if student was registered despite validation errors
  error_reason: string; // reason for error if has_error is true
  entry_semester_override_reason?: string | null;
  has_academic_plan?: boolean;
  academic_plan_lock_reason?: string | null;
}

interface FailedRecord {
  row: number;
  matric_no: string | null;
  student_id: number | null;
  reason: string;
  pre_registered: boolean; // true if student was still pre-registered despite the error
}

interface ExistingOrReservedStudent {
  id: number;
  matric_no: string;
  status: string;
  total_credit_transferred: number;
  starting_semester: number | null;
  system_assigned_entry_semester: number | null;
  final_entry_semester: number | null;
  entry_semester_assignment_note: string | null;
  entry_semester_override_reason: string | null;
}

const getRepresentativeCredit = (band: {
  credit_transfer?: number | null;
  transfer_min: number;
}) => {
  const representativeCredit = Number(band.credit_transfer);

  if (Number.isFinite(representativeCredit) && representativeCredit >= 0) {
    return representativeCredit;
  }

  return Math.max(Number(band.transfer_min) || 0, 0);
};

const getCoverageRangeLabel = (band: {
  transfer_min: number;
  transfer_max: number;
}) => {
  const transferMin = Math.max(Number(band.transfer_min) || 0, 0);
  const transferMax = Math.max(Number(band.transfer_max) || 0, 0);

  return transferMin === transferMax
    ? `${transferMin}`
    : `${transferMin}-${transferMax}`;
};

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
  let intakeType: string | null = null;

  for (const field of formData) {
    if (field.name === "file" && field.data) {
      fileBuffer = field.data;
    } else if (field.name === "intake" && field.data) {
      intake = field.data.toString();
    } else if (field.name === "intake_type" && field.data) {
      intakeType = field.data.toString();
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

  // Validate intake matches current session
  const [sessionRows] = await pool.query(
    `SELECT active_intake_period FROM program_current_session WHERE program_id = ?`,
    [programId],
  );
  const currentSession = (sessionRows as any[])[0] || null;

  if (!currentSession) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Current session is not set. Please configure the current session before processing an intake.",
    });
  }

  if (intake !== currentSession.active_intake_period) {
    throw createError({
      statusCode: 400,
      statusMessage: `Intake ${intake} does not match the current session ${currentSession.active_intake_period}. Update the current session to process a different intake.`,
    });
  }

  await ensureStudentEntrySemesterColumns();

  const creditCeiling = await getProgramCreditCeiling(programId);
  const resolvedRuleSet =
    intakeType && intakeType.trim()
      ? {
          status: "resolved" as const,
          value: {
            intake_type: intakeType.trim(),
            resolution_source: "month_token" as const,
          },
          reason: "",
          candidates: [],
        }
      : await resolveSemesterRuleSetForIntake({
          programId,
          intakeYear: intake,
        });
  const effectiveIntakeType = resolvedRuleSet.value?.intake_type || "";

  if (!effectiveIntakeType) {
    throw createError({
      statusCode: 400,
      statusMessage:
        resolvedRuleSet.reason ||
        "The system could not resolve a semester rule set for this intake.",
    });
  }

  const resolvedProgramSession = await resolveProgramSessionForIntake({
    programId,
    intakeYear: intake,
  });
  const matchedProgramSessionId = resolvedProgramSession.value?.id ?? null;

  if (!matchedProgramSessionId) {
    throw createError({
      statusCode: 400,
      statusMessage:
        resolvedProgramSession.reason ||
        "The system could not resolve a program structure for this intake.",
    });
  }

  const entryBands = await getSemesterEntryBands(programId, effectiveIntakeType);
  const bandValidation = validateSemesterEntryBands({
    bands: entryBands,
    creditCeiling,
  });

  if (entryBands.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "No semester entry rules found for the resolved intake type",
    });
  }

  if (!bandValidation.is_valid) {
    throw createError({
      statusCode: 400,
      statusMessage:
        bandValidation.issues[0]?.message ||
        "The selected semester-entry band table is incomplete or overlapping. Fix the rule set before running Student Entry Assessment.",
    });
  }

  // Get all students in this program (regardless of intake - they may already exist)
  const [studentRows] = await pool.query(
    `SELECT id,
            matric_no,
            intake_year,
            status,
            total_credit_transferred,
            starting_semester,
            system_assigned_entry_semester,
            final_entry_semester,
            entry_semester_assignment_note,
            entry_semester_override_reason
     FROM students
     WHERE program_id = ?`,
    [programId],
  );

  const studentsMap = new Map<
    string,
    {
      id: number;
      matric_no: string;
      status: string;
      total_credit_transferred: number;
      starting_semester: number | null;
      system_assigned_entry_semester: number | null;
      final_entry_semester: number | null;
      entry_semester_assignment_note: string | null;
      entry_semester_override_reason: string | null;
    }
  >();

  for (const student of studentRows as any[]) {
    studentsMap.set(student.matric_no.toLowerCase(), {
      id: student.id,
      matric_no: student.matric_no,
      status: student.status,
      total_credit_transferred: Number(student.total_credit_transferred) || 0,
      starting_semester:
        student.starting_semester == null
          ? null
          : Number(student.starting_semester),
      system_assigned_entry_semester:
        student.system_assigned_entry_semester == null
          ? null
          : Number(student.system_assigned_entry_semester),
      final_entry_semester:
        student.final_entry_semester == null
          ? null
          : Number(student.final_entry_semester),
      entry_semester_assignment_note:
        student.entry_semester_assignment_note ?? null,
      entry_semester_override_reason:
        student.entry_semester_override_reason ?? null,
    });
  }

  const [existingPlanRows] = await pool.query(
    `SELECT DISTINCT student_id FROM academic_plans`,
  );
  const studentsWithAcademicPlans = new Set<number>(
    (existingPlanRows as any[]).map((row) => Number(row.student_id)),
  );

  // Get all courses for lookup (bulk fetch for performance) - include credit_hour
  const [courseRows] = await pool.query(
    `SELECT id, course_code, credit_hour FROM courses`,
  );

  const courseCodeToId = new Map<string, number>();
  const courseIdToCreditHour = new Map<number, number>();
  for (const course of courseRows as any[]) {
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

  // Find column indices
  const headerRow = worksheet.getRow(1);
  let studentIdCol = -1;
  let matricNoCol = -1;
  let creditCol = -1;
  let transferredCoursesCol = -1;
  let intakeYearCol = -1;
  let startingSemesterCol = -1;
  let programCodeCol = -1;

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
    } else if (
      value === "transferred_courses" ||
      value === "transferredcourses" ||
      value === "transfer_courses"
    ) {
      transferredCoursesCol = colNumber;
    } else if (
      value === "intake_year" ||
      value === "intakeyear" ||
      value === "intake"
    ) {
      intakeYearCol = colNumber;
    } else if (
      value === "starting_semester" ||
      value === "startingsemester" ||
      value === "entry_semester" ||
      value === "entrysemester"
    ) {
      startingSemesterCol = colNumber;
    } else if (
      value === "program_code" ||
      value === "programcode" ||
      value === "program"
    ) {
      programCodeCol = colNumber;
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
    const transferredCoursesValue =
      transferredCoursesCol !== -1
        ? row.getCell(transferredCoursesCol).value
        : null;
    const intakeYearValue =
      intakeYearCol !== -1 ? row.getCell(intakeYearCol).value : null;
    const startingSemesterValue =
      startingSemesterCol !== -1
        ? row.getCell(startingSemesterCol).value
        : null;
    const programCodeValue =
      programCodeCol !== -1 ? row.getCell(programCodeCol).value : null;

    // 1. First validate intake_year matches the selected intake from Step 1
    if (
      intakeYearCol !== -1 &&
      intakeYearValue !== null &&
      intakeYearValue !== undefined
    ) {
      const excelIntakeYear = String(intakeYearValue).trim();
      if (excelIntakeYear !== intake) {
        failedRecords.push({
          row: rowNum,
          matric_no: matricNoValue ? String(matricNoValue) : null,
          student_id: studentIdValue ? Number(studentIdValue) : null,
          reason: `Intake mismatch: Excel intake_year (${excelIntakeYear}) does not match selected intake (${intake})`,
          pre_registered: false,
        });
        continue;
      }
    }

    // 2. Validate program_code matches the HoP's program
    if (
      programCodeCol !== -1 &&
      programCodeValue !== null &&
      programCodeValue !== undefined
    ) {
      const excelProgramCode = String(programCodeValue).trim().toUpperCase();
      if (excelProgramCode !== programCode.toUpperCase()) {
        failedRecords.push({
          row: rowNum,
          matric_no: matricNoValue ? String(matricNoValue) : null,
          student_id: studentIdValue ? Number(studentIdValue) : null,
          reason: `Program mismatch: Excel program_code (${excelProgramCode}) does not match your program (${programCode})`,
          pre_registered: false,
        });
        continue;
      }
    }

    // 3. Validate starting_semester must be empty or 0
    if (
      startingSemesterCol !== -1 &&
      startingSemesterValue !== null &&
      startingSemesterValue !== undefined
    ) {
      const semesterVal =
        typeof startingSemesterValue === "number"
          ? startingSemesterValue
          : parseFloat(String(startingSemesterValue).trim());

      // Must be empty (NaN after parse of empty string) or 0
      if (!isNaN(semesterVal) && semesterVal !== 0) {
        failedRecords.push({
          row: rowNum,
          matric_no: matricNoValue ? String(matricNoValue) : null,
          student_id: studentIdValue ? Number(studentIdValue) : null,
          reason: `Invalid starting_semester: must be empty or 0, got ${semesterVal}`,
          pre_registered: false,
        });
        continue;
      }
    }

    // 4. Validate matric_no is provided
    if (!matricNoValue) {
      failedRecords.push({
        row: rowNum,
        matric_no: null,
        student_id: studentIdValue ? Number(studentIdValue) : null,
        reason: "matric_no is required for processing",
        pre_registered: false,
      });
      continue;
    }

    const matricNo = String(matricNoValue).trim();
    const matricNoLower = matricNo.toLowerCase();

    // 5. Find or mark student for creation
    let student: ExistingOrReservedStudent | undefined;
    let isNewStudent = false;

    const existingStudent = studentsMap.get(matricNoLower);

    if (existingStudent) {
      student = existingStudent;
      // If student is still reserved (not yet registered), treat as new
      isNewStudent = existingStudent.status === "reserved";
    } else {
      // Student doesn't exist - will create as reserved
      isNewStudent = true;
      // Create a placeholder - actual ID will be assigned after INSERT
      student = {
        id: -1,
        matric_no: matricNo,
        status: "reserved",
        total_credit_transferred: 0,
        starting_semester: null,
        system_assigned_entry_semester: null,
        final_entry_semester: null,
        entry_semester_assignment_note: null,
        entry_semester_override_reason: null,
      };
    }

    // 5. Parse and validate credit value
    let credits = 0;
    let creditError: string | null = null;
    if (typeof creditValue === "number") {
      credits = creditValue;
    } else if (creditValue !== null && creditValue !== undefined) {
      credits = parseFloat(String(creditValue));
    }

    if (isNaN(credits) || credits < 0) {
      // Still pre-register the student with 0 credits
      creditError = "Invalid credit value — registered with 0 credits";
      credits = 0;
    }

    // 6. Check for duplicates — skip entirely (cannot register the same student twice)
    if (processedMatricNos.has(student.matric_no.toLowerCase())) {
      failedRecords.push({
        row: rowNum,
        matric_no: student.matric_no,
        student_id: student.id,
        reason: "Duplicate entry for this student",
        pre_registered: false,
      });
      continue;
    }

    const hasAcademicPlan =
      student.id > 0 && studentsWithAcademicPlans.has(Number(student.id));

    if (hasAcademicPlan) {
      const lockedSemester =
        student.final_entry_semester ??
        student.system_assigned_entry_semester ??
        student.starting_semester ??
        0;
      processedMatricNos.add(student.matric_no.toLowerCase());
      processedStudents.push({
        student_id: student.id,
        matric_no: student.matric_no,
        intake_year: intake,
        total_credit_transferred: student.total_credit_transferred || 0,
        starting_semester: lockedSemester,
        program_code: programCode,
        transferred_courses: "",
        entry_semester: lockedSemester,
        system_assigned_entry_semester:
          student.system_assigned_entry_semester ?? lockedSemester,
        final_entry_semester: lockedSemester,
        entry_semester_rule_id: null,
        entry_semester_assignment_note:
          student.entry_semester_assignment_note ||
          "Locked because an academic plan already exists for this student.",
        transferred_course_ids: [],
        is_new_student: false,
        has_error: false,
        error_reason: "",
        entry_semester_override_reason:
          student.entry_semester_override_reason ?? null,
        has_academic_plan: true,
        academic_plan_lock_reason:
          "Academic plan already exists. Starting semester cannot be changed here.",
      });
      continue;
    }

    const matchingBand = entryBands.find(
      (band) => credits >= band.transfer_min && credits <= band.transfer_max,
    );

    if (!matchingBand) {
        failedRecords.push({
          row: rowNum,
          matric_no: student.matric_no,
          student_id: student.id > 0 ? student.id : null,
          reason: `No semester rule covered ${credits} transferred credits for ${effectiveIntakeType}`,
          pre_registered: false,
        });
        continue;
    }

    const entrySemester = matchingBand.entry_semester;
    const coverageRange = getCoverageRangeLabel(matchingBand);
    const resolvedJourney = await resolveSemesterRuleJourney({
      programId,
      intakeType: effectiveIntakeType,
      entrySemester,
      transferredCredits: credits,
      sessionId: matchedProgramSessionId,
      ruleId: matchingBand.id,
    });
    const assignmentNote =
      resolvedJourney.explanation ||
      `${effectiveIntakeType} + ${credits} transferred credits matched Semester ${matchingBand.entry_semester} band (${coverageRange}) and will follow the configured band journey.`;

    // 7. Parse and validate transferred courses
    const transferredCourseIds: number[] = [];
    const invalidCoursesList: string[] = [];
    let transferredCoursesCredits = 0;
    let courseError: string | null = null;

    if (transferredCoursesValue) {
      const courseCodes = String(transferredCoursesValue)
        .split(",")
        .map((code) => code.trim().toUpperCase())
        .filter((code) => code.length > 0);

      for (const code of courseCodes) {
        // Check if this is a slash-separated course group (e.g., "UCS3153/UCS3143/UCS3163")
        if (code.includes("/")) {
          const groupCodes = code
            .split("/")
            .map((c) => c.trim().toUpperCase())
            .filter((c) => c.length > 0);

          // Find the first matching course from the group
          let matchedCourseId: number | undefined;
          let matchedCreditHour = 0;
          for (const groupCode of groupCodes) {
            const id = courseCodeToId.get(groupCode);
            if (id) {
              matchedCourseId = id;
              matchedCreditHour = courseIdToCreditHour.get(id) || 0;
              break;
            }
          }

          if (matchedCourseId) {
            transferredCourseIds.push(matchedCourseId);
            transferredCoursesCredits += matchedCreditHour;
          } else {
            // None of the codes in the group were found
            invalidCoursesList.push(code);
          }
        } else {
          const courseId = courseCodeToId.get(code);
          if (courseId) {
            transferredCourseIds.push(courseId);
            // Add credit hour to total
            const creditHour = courseIdToCreditHour.get(courseId) || 0;
            transferredCoursesCredits += creditHour;
          } else {
            invalidCoursesList.push(code);
          }
        }
      }

      // If any course codes don't exist in the system — register without transferred courses
      if (invalidCoursesList.length > 0) {
        courseError = `Invalid course(s) not found in system: ${invalidCoursesList.join(", ")} — registered without transferred courses`;
        transferredCourseIds.length = 0; // Clear course ids, don't link invalid courses
      } else if (
        // 8. Validate that total_credit_transferred matches the sum of transferred courses
        transferredCourseIds.length > 0 &&
        credits !== transferredCoursesCredits
      ) {
        courseError = `Credit mismatch: total_credit_transferred (${credits}) does not match sum of transferred courses (${transferredCoursesCredits}) — registered with provided credits, no courses linked`;
        transferredCourseIds.length = 0; // Don't link courses if credits don't reconcile
      }
    }

    // Combine errors
    const hasError = !!(creditError || courseError);
    const errorReason = [creditError, courseError].filter(Boolean).join(" | ");

    // Add to failed records list for visibility (but still register)
    if (hasError) {
      failedRecords.push({
        row: rowNum,
        matric_no: student.matric_no,
        student_id: student.id,
        reason: errorReason,
        pre_registered: true,
      });
    }

    processedMatricNos.add(student.matric_no.toLowerCase());
    processedStudents.push({
      student_id: student.id,
      matric_no: student.matric_no,
      intake_year: intake,
      // Always keep the original credit value from Excel — needed for academic planning generation
      total_credit_transferred: credits,
      starting_semester: entrySemester,
      program_code: programCode,
      // Only store transferred_courses string if courses are valid; drop if unresolvable
      transferred_courses: hasError
        ? ""
        : (transferredCoursesValue ? String(transferredCoursesValue) : ""),
      entry_semester: entrySemester,
      system_assigned_entry_semester: entrySemester,
      final_entry_semester: entrySemester,
      entry_semester_rule_id:
        matchingBand.is_system_default || Number(matchingBand.id) <= 0
          ? null
          : matchingBand.id,
      entry_semester_assignment_note: assignmentNote,
      // Only link course IDs if they are fully valid and reconciled
      transferred_course_ids: hasError ? [] : transferredCourseIds,
      is_new_student: isNewStudent,
      has_error: hasError,
      error_reason: errorReason,
      entry_semester_override_reason: null,
      has_academic_plan: false,
      academic_plan_lock_reason: null,
    });
  }

  // Update students in database
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Process students in database - create new or update existing
    for (const student of processedStudents) {
      if (student.has_academic_plan) {
        continue;
      }

      if (student.student_id === -1) {
        // Brand new student - create as reserved
        const [insertResult] = await connection.query(
          `INSERT INTO students (
             user_id,
             status,
             matric_no,
             program_id,
             intake_year,
             total_credit_transferred,
             starting_semester,
             system_assigned_entry_semester,
             final_entry_semester,
             entry_semester_rule_id,
             entry_semester_assignment_note,
             intake_assessment_needs_fix,
             intake_assessment_error_reason,
             is_entry_semester_override,
             entry_semester_override_reason,
             entry_semester_overridden_by,
             entry_semester_overridden_at
           )
           VALUES (NULL, 'reserved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, NULL, NULL, NULL)`,
          [
            student.matric_no,
            programId,
            student.intake_year,
            student.total_credit_transferred,
            student.final_entry_semester,
            student.system_assigned_entry_semester,
            student.final_entry_semester,
            student.entry_semester_rule_id,
            student.entry_semester_assignment_note,
            student.has_error ? 1 : 0,
            student.has_error ? student.error_reason : null,
          ],
        );
        // Update student_id with the newly created ID
        student.student_id = (insertResult as any).insertId;
      } else {
        // Update existing student (either reserved or active)
        await connection.query(
          `UPDATE students 
           SET total_credit_transferred = ?,
               starting_semester = ?,
               system_assigned_entry_semester = ?,
               final_entry_semester = ?,
               entry_semester_rule_id = ?,
               entry_semester_assignment_note = ?,
               intake_assessment_needs_fix = ?,
               intake_assessment_error_reason = ?,
               is_entry_semester_override = FALSE,
               entry_semester_override_reason = NULL,
               entry_semester_overridden_by = NULL,
               entry_semester_overridden_at = NULL
           WHERE id = ?`,
          [
            student.total_credit_transferred,
            student.final_entry_semester,
            student.system_assigned_entry_semester,
            student.final_entry_semester,
            student.entry_semester_rule_id,
            student.entry_semester_assignment_note,
            student.has_error ? 1 : 0,
            student.has_error ? student.error_reason : null,
            student.student_id,
          ],
        );
      }

      // Delete existing transferred courses for this student
      await connection.query(
        `DELETE FROM student_transferred_courses WHERE student_id = ?`,
        [student.student_id],
      );

      // Insert new transferred courses (batch insert)
      if (student.transferred_course_ids.length > 0) {
        const values = student.transferred_course_ids.map((courseId) => [
          student.student_id,
          courseId,
        ]);
        await connection.query(
          `INSERT INTO student_transferred_courses (student_id, course_id) VALUES ?`,
          [values],
        );
      }
    }

    await connection.commit();
  } catch (error: any) {
    await connection.rollback();
    console.error("Failed to update student records:", error?.message || error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to update student records",
      message: error?.message || "Unknown database error",
    });
    
  } finally {
    connection.release();
  }

  // Strictly failed = those not in processedStudents (duplicate, missing matric_no, wrong intake/program)
  const strictFailedRecords = failedRecords.filter((f) => !f.pre_registered);

  return {
    summary: {
      total_records: processedStudents.length + strictFailedRecords.length,
      successful: processedStudents.filter(
        (s) => !s.has_error && !s.has_academic_plan,
      ).length,
      failed: strictFailedRecords.length,
      registered_with_errors: processedStudents.filter((s) => s.has_error).length,
      locked_existing_plans: processedStudents.filter((s) => s.has_academic_plan)
        .length,
      new_students: processedStudents.filter((s) => s.is_new_student).length,
      updated_students: processedStudents.filter(
        (s) => !s.is_new_student && !s.has_academic_plan,
      ).length,
    },
    processed_students: processedStudents.map((s) => ({
      student_id: s.student_id,
      matric_no: s.matric_no,
      intake_year: s.intake_year,
      total_credit_transferred: s.total_credit_transferred,
      starting_semester: s.starting_semester,
      program_code: s.program_code,
      transferred_courses: s.transferred_courses,
      entry_semester: s.entry_semester,
      system_assigned_entry_semester: s.system_assigned_entry_semester,
      final_entry_semester: s.final_entry_semester,
      entry_semester_assignment_note: s.entry_semester_assignment_note,
      entry_semester_override_reason: s.entry_semester_override_reason ?? null,
      is_new_student: s.is_new_student,
      has_error: s.has_error,
      error_reason: s.error_reason,
      has_academic_plan: !!s.has_academic_plan,
      academic_plan_lock_reason: s.academic_plan_lock_reason ?? null,
    })),
    failed_records: strictFailedRecords,
    error_registered_records: failedRecords.filter((f) => f.pre_registered),
  };
});
