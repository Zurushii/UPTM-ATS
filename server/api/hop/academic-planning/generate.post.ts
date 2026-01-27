import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";
import ExcelJS from "exceljs";

interface CreditPlan {
  semester_number: number;
  semester_type: "L" | "S";
  target_credits: number;
}

interface ProgramCourse {
  id: number;
  course_id: number;
  course_code: string;
  course_name: string;
  credit_hour: number;
  semester: number;
  course_type: string;
  course_group: string | null;
}

interface FailedStudent {
  student_id: number;
  matric_no: string;
  reason: string;
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
  let intakeId: number | null = null;

  for (const field of formData) {
    if (field.name === "file" && field.data) {
      fileBuffer = field.data;
    } else if (field.name === "intake_id" && field.data) {
      intakeId = parseInt(field.data.toString());
    }
  }

  if (!fileBuffer) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file is required",
    });
  }

  if (!intakeId) {
    throw createError({
      statusCode: 400,
      statusMessage: "intake_id is required",
    });
  }

  // Verify intake belongs to this program and get intake details
  const [intakeRows] = await pool.query(
    `SELECT id, intake_year, intake_type, session_id 
     FROM academic_planning_intakes 
     WHERE id = ? AND program_id = ?`,
    [intakeId, programId],
  );

  if ((intakeRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Academic planning intake not found",
    });
  }

  const intake = (intakeRows as any[])[0];

  // Get all students in this program with the matching intake year
  const [studentRows] = await pool.query(
    `SELECT 
      s.id,
      s.matric_no,
      s.starting_semester,
      s.total_credit_transferred
    FROM students s
    WHERE s.program_id = ? AND s.intake_year = ?`,
    [programId, intake.intake_year],
  );

  const studentsMap = new Map<string, any>();
  for (const student of studentRows as any[]) {
    studentsMap.set(student.matric_no.toLowerCase(), student);
  }

  // Get students who already have academic plans for this intake
  const [existingPlanRows] = await pool.query(
    `SELECT student_id FROM academic_plans WHERE intake_id = ?`,
    [intakeId],
  );

  const studentsWithPlans = new Set<number>();
  for (const row of existingPlanRows as any[]) {
    studentsWithPlans.add(row.student_id);
  }

  // Get semester entry rules with credit plans for this intake type
  const [ruleRows] = await pool.query(
    `SELECT id, credit_transfer, entry_semester 
     FROM semester_entry_rules 
     WHERE program_id = ? AND intake_type = ?`,
    [programId, intake.intake_type],
  );

  // Get credit plans for each rule
  const creditPlansByRule = new Map<number, CreditPlan[]>();
  const creditPlansByEntrySem = new Map<number, CreditPlan[]>();

  for (const rule of ruleRows as any[]) {
    const [planRows] = await pool.query(
      `SELECT semester_number, semester_type, target_credits 
       FROM semester_credit_plans 
       WHERE rule_id = ?
       ORDER BY semester_number`,
      [rule.id],
    );
    creditPlansByRule.set(rule.id, planRows as CreditPlan[]);
    creditPlansByEntrySem.set(rule.entry_semester, planRows as CreditPlan[]);
  }

  // Get program structure (courses by semester) for the session
  const [courseRows] = await pool.query(
    `SELECT 
      pc.id,
      pc.course_id,
      c.course_code,
      c.course_name,
      c.credit_hour,
      pc.semester,
      pc.course_type,
      pc.course_group
    FROM program_courses pc
    JOIN courses c ON pc.course_id = c.id
    WHERE pc.session_id = ?
    ORDER BY pc.semester, pc.id`,
    [intake.session_id],
  );

  // Group courses by semester
  const coursesBySemester = new Map<number, ProgramCourse[]>();
  for (const course of courseRows as any[]) {
    if (!coursesBySemester.has(course.semester)) {
      coursesBySemester.set(course.semester, []);
    }
    coursesBySemester.get(course.semester)!.push(course as ProgramCourse);
  }

  // Parse Excel file to get list of matric numbers to process
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file has no worksheets",
    });
  }

  // Find matric_no column
  const headerRow = worksheet.getRow(1);
  let matricNoCol = -1;

  headerRow.eachCell((cell, colNumber) => {
    const value = String(cell.value || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_");
    if (
      value === "matric_no" ||
      value === "matricno" ||
      value === "matric" ||
      value === "matric_number"
    ) {
      matricNoCol = colNumber;
    }
  });

  if (matricNoCol === -1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file must have a 'matric_no' column",
    });
  }

  // Collect students to process
  const studentsToProcess: any[] = [];
  const failedStudents: FailedStudent[] = [];
  const processedMatricNos = new Set<string>();

  for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);
    if (!row.hasValues) continue;

    const matricNoValue = row.getCell(matricNoCol).value;
    if (!matricNoValue) continue;

    const matricNo = String(matricNoValue).trim();
    const matricNoLower = matricNo.toLowerCase();

    // Skip duplicates
    if (processedMatricNos.has(matricNoLower)) continue;
    processedMatricNos.add(matricNoLower);

    // Find student
    const student = studentsMap.get(matricNoLower);
    if (!student) continue;

    // Skip if already has plan
    if (studentsWithPlans.has(student.id)) continue;

    // Check if has entry semester
    if (!student.starting_semester) {
      failedStudents.push({
        student_id: student.id,
        matric_no: student.matric_no,
        reason: "Entry semester not set",
      });
      continue;
    }

    studentsToProcess.push(student);
  }

  // Generate academic plans
  const connection = await pool.getConnection();
  let successfulPlans = 0;

  try {
    await connection.beginTransaction();

    for (const student of studentsToProcess) {
      try {
        const entrySemester = student.starting_semester;
        
        // Get credit plan for this entry semester
        const creditPlan = creditPlansByEntrySem.get(entrySemester);
        
        if (!creditPlan || creditPlan.length === 0) {
          failedStudents.push({
            student_id: student.id,
            matric_no: student.matric_no,
            reason: `No credit plan found for entry semester ${entrySemester}`,
          });
          continue;
        }

        // Create academic plan
        const [planResult] = await connection.query(
          `INSERT INTO academic_plans (student_id, intake_id, start_semester, status)
           VALUES (?, ?, ?, 'draft')`,
          [student.id, intakeId, entrySemester],
        );

        const planId = (planResult as any).insertId;

        // Assign courses to semesters based on credit plan
        // Start from entry semester and work through the credit plan
        const coursesToAssign: Array<{ course_id: number; semester: number }> = [];
        const assignedCourseGroups = new Set<string>();

        for (let i = 0; i < creditPlan.length; i++) {
          const semPlan = creditPlan[i];
          const actualSemester = entrySemester + i;
          
          // Get courses for this semester from program structure
          // Map from program structure semester to actual student semester
          const structureSemester = i + 1; // Program structure starts from semester 1
          const semesterCourses = coursesBySemester.get(structureSemester) || [];
          
          let creditsAssigned = 0;
          
          for (const course of semesterCourses) {
            // Handle grouped courses (MPU, electives) - only take one from each group
            if (course.course_group) {
              if (assignedCourseGroups.has(course.course_group)) {
                continue; // Skip, already assigned a course from this group
              }
              assignedCourseGroups.add(course.course_group);
            }

            // Check credit limit for this semester
            if (creditsAssigned + course.credit_hour <= semPlan.target_credits) {
              coursesToAssign.push({
                course_id: course.course_id,
                semester: actualSemester,
              });
              creditsAssigned += course.credit_hour;
            }
          }
        }

        // Insert course assignments
        if (coursesToAssign.length > 0) {
          const values = coursesToAssign.map((c) => [
            planId,
            c.course_id,
            c.semester,
          ]);

          await connection.query(
            `INSERT INTO academic_plan_details (academic_plan_id, course_id, semester)
             VALUES ?`,
            [values],
          );
        }

        successfulPlans++;
      } catch (err: any) {
        failedStudents.push({
          student_id: student.id,
          matric_no: student.matric_no,
          reason: err.message || "Unknown error during plan generation",
        });
      }
    }

    // Update intake statistics
    await connection.query(
      `UPDATE academic_planning_intakes 
       SET status = 'generated',
           total_students = ?,
           successful_plans = ?,
           failed_plans = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        studentsToProcess.length + failedStudents.length,
        successfulPlans,
        failedStudents.length,
        intakeId,
      ],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to generate academic plans",
    });
  } finally {
    connection.release();
  }

  return {
    summary: {
      total_processed: studentsToProcess.length,
      successful: successfulPlans,
      failed: failedStudents.length,
      skipped_existing: studentsWithPlans.size,
    },
    failed_students: failedStudents,
  };
});
