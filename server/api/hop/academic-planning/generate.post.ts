import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";
import ExcelJS from "exceljs";

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

interface StudentFromExcel {
  student_id: number;
  matric_no: string;
  starting_semester: number;
  transferred_course_ids: Set<number>;
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

  // Check if intake assessment has been completed
  // At least some students must have starting_semester set
  const studentsWithAssessment = (studentRows as any[]).filter(
    (s) => s.starting_semester !== null && s.starting_semester > 0
  );

  if (studentsWithAssessment.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Intake assessment must be completed before generating academic plans. No students in this intake have been processed through intake assessment.",
    });
  }

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

  // Get ALL program courses for the session (entire program structure)
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

  const allProgramCourses: ProgramCourse[] = courseRows as ProgramCourse[];

  // Get all courses for code-to-ID lookup and credit hours
  const [allCoursesRows] = await pool.query(`SELECT id, course_code, credit_hour FROM courses`);
  const courseCodeToId = new Map<string, number>();
  const courseIdToCreditHour = new Map<number, number>();
  for (const course of allCoursesRows as any[]) {
    courseCodeToId.set(course.course_code.toUpperCase(), course.id);
    courseIdToCreditHour.set(course.id, course.credit_hour);
  }

  // Parse Excel file to get list of students with their transferred courses
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
  let matricNoCol = -1;
  let transferredCoursesCol = -1;

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
    } else if (
      value === "transferred_courses" ||
      value === "transferredcourses" ||
      value === "transfer_courses"
    ) {
      transferredCoursesCol = colNumber;
    }
  });

  if (matricNoCol === -1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file must have a 'matric_no' column",
    });
  }

  // Collect students to process with their transferred courses
  const studentsToProcess: StudentFromExcel[] = [];
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

    // Parse transferred courses from Excel and validate credit sum
    const transferredCourseIds = new Set<number>();
    let transferredCoursesCredits = 0;
    let validationFailed = false;
    
    if (transferredCoursesCol !== -1) {
      const transferredCoursesValue = row.getCell(transferredCoursesCol).value;
      if (transferredCoursesValue) {
        const courseCodes = String(transferredCoursesValue)
          .split(",")
          .map((code) => code.trim().toUpperCase())
          .filter((code) => code.length > 0);

        for (const code of courseCodes) {
          const courseId = courseCodeToId.get(code);
          if (courseId) {
            transferredCourseIds.add(courseId);
            // Add credit hour to total
            const creditHour = courseIdToCreditHour.get(courseId) || 0;
            transferredCoursesCredits += creditHour;
          }
        }
      }
    }

    // Validate that total_credit_transferred matches the sum of transferred courses
    // Only validate if either value is non-zero
    const dbCredits = student.total_credit_transferred || 0;
    if (transferredCourseIds.size > 0 || dbCredits > 0) {
      if (dbCredits !== transferredCoursesCredits) {
        failedStudents.push({
          student_id: student.id,
          matric_no: student.matric_no,
          reason: `Credit mismatch: total_credit_transferred (${dbCredits}) does not match sum of transferred courses (${transferredCoursesCredits})`,
        });
        validationFailed = true;
      }
    }

    // Skip this student if validation failed
    if (validationFailed) {
      continue;
    }

    studentsToProcess.push({
      student_id: student.id,
      matric_no: student.matric_no,
      starting_semester: student.starting_semester,
      transferred_course_ids: transferredCourseIds,
    });
  }

  // Generate academic plans
  const connection = await pool.getConnection();
  let successfulPlans = 0;

  try {
    await connection.beginTransaction();

    for (const student of studentsToProcess) {
      try {
        // Create academic plan
        const [planResult] = await connection.query(
          `INSERT INTO academic_plans (student_id, intake_id, start_semester, status)
           VALUES (?, ?, ?, 'draft')`,
          [student.student_id, intakeId, student.starting_semester],
        );

        const planId = (planResult as any).insertId;

        // Prepare course assignments for the ENTIRE program structure
        const courseAssignments: Array<{
          course_id: number;
          semester: number;
          status: string;
        }> = [];

        // Track assigned course groups PER SEMESTER to handle grouped courses properly
        // Key: "semester:group_name", e.g., "1:MPU Elective"
        const assignedCourseGroupsPerSem = new Set<string>();

        // Process ALL courses from program structure
        for (const course of allProgramCourses) {
          // Handle grouped courses - only take one from each group PER SEMESTER
          if (course.course_group) {
            const groupKey = `${course.semester}:${course.course_group}`;
            if (assignedCourseGroupsPerSem.has(groupKey)) {
              continue; // Skip, already assigned a course from this group for this semester
            }
            assignedCourseGroupsPerSem.add(groupKey);
          }

          // Determine status: Transferred if in transferred list, otherwise Planned
          const status = student.transferred_course_ids.has(course.course_id)
            ? "Transferred"
            : "Planned";

          courseAssignments.push({
            course_id: course.course_id,
            semester: course.semester, // Use original program structure semester
            status: status,
          });
        }

        // Insert all course assignments
        if (courseAssignments.length > 0) {
          const values = courseAssignments.map((c) => [
            planId,
            c.course_id,
            c.semester,
            c.status,
          ]);

          await connection.query(
            `INSERT INTO academic_plan_details (academic_plan_id, course_id, semester, status)
             VALUES ?`,
            [values],
          );
        }

        successfulPlans++;
      } catch (err: any) {
        failedStudents.push({
          student_id: student.student_id,
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
