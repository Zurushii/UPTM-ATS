import { pool } from "~~/server/utils/db";
import {
  getIntakeLifecyclePattern,
  getLastLongSemesterNumber,
} from "~~/server/utils/semester-rule-plans";
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
  prerequisite_course_id: number | null;
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
    `SELECT id, intake_year, intake_type, session_id, status 
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

  if (intake.status === "completed") {
    throw createError({
      statusCode: 400,
      statusMessage: "Cannot regenerate plans for an intake that has been marked as completed",
    });
  }

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
    (s) => s.starting_semester !== null && s.starting_semester > 0,
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
      pc.course_group,
      pc.prerequisite_course_id
    FROM program_courses pc
    JOIN courses c ON pc.course_id = c.id
    WHERE pc.session_id = ?
    ORDER BY pc.semester, pc.id`,
    [intake.session_id],
  );

  const allProgramCourses: ProgramCourse[] = courseRows as ProgramCourse[];

  // Get program credit limits (min/max per semester type)
  const [programLimitRows] = await pool.query(
    `SELECT long_sem_min_credit, long_sem_max_credit, short_sem_min_credit, short_sem_max_credit
     FROM programs WHERE id = ?`,
    [programId],
  );
  const programLimits = (programLimitRows as any[])[0] || {};
  const creditLimits = {
    long_min: programLimits.long_sem_min_credit ?? 12,
    long_max: programLimits.long_sem_max_credit ?? 20,
    short_min: programLimits.short_sem_min_credit ?? 6,
    short_max: programLimits.short_sem_max_credit ?? 10,
  };

  // --- Dynamic Cycle Detection from Program Structure ---
  const semesterStats = new Map<number, { credits: number; has_li: boolean }>();
  let maxProgramSemester = 0;

  for (const course of allProgramCourses) {
    if (course.semester > maxProgramSemester) {
      maxProgramSemester = course.semester;
    }
    if (!semesterStats.has(course.semester)) {
      semesterStats.set(course.semester, { credits: 0, has_li: false });
    }
    const stat = semesterStats.get(course.semester)!;
    if (course.course_type === "Industrial Training") {
      stat.has_li = true;
    }
  }

  for (let sem = 1; sem <= maxProgramSemester; sem++) {
    const stat = semesterStats.get(sem);
    if (!stat) continue;
    let baseCredits = 0;
    const countedGroups = new Set<string>();
    for (const course of allProgramCourses) {
      if (course.semester !== sem) continue;
      if (course.course_group) {
        if (!countedGroups.has(course.course_group)) {
          countedGroups.add(course.course_group);
          baseCredits += course.credit_hour;
        }
      } else {
        baseCredits += course.credit_hour;
      }
    }
    stat.credits = baseCredits;
  }

  const semesterOneLifecyclePattern = getIntakeLifecyclePattern(
    intake.intake_type,
  );
  const semesterOneLiSemester = getLastLongSemesterNumber(
    Array.from(semesterStats.keys())
      .sort((a, b) => a - b)
      .map((semesterNumber) => ({
        semester_number: semesterNumber,
        semester_type:
          semesterOneLifecyclePattern[(semesterNumber - 1) % 3],
      })),
  );
  // --------------------------------------------------------

  // Get all courses for code-to-ID lookup and credit hours
  const [allCoursesRows] = await pool.query(
    `SELECT id, course_code, credit_hour FROM courses`,
  );
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

        // Prepare course assignments
        const courseAssignments: Array<{
          course_id: number;
          semester: number;
          status: string;
        }> = [];

        // Track assigned course groups PER SEMESTER to handle grouped courses properly
        // Key: "semester:group_name", e.g., "1:MPU Elective"
        const assignedCourseGroupsPerSem = new Set<string>();

        if (student.starting_semester === 1) {
          // ── Semester 1 students: follow program structure, keeping LI on the last Long semester ──
          for (const course of allProgramCourses) {
            const targetSemester =
              course.course_type === "Industrial Training" &&
              semesterOneLiSemester
                ? semesterOneLiSemester
                : course.semester;

            if (course.course_group) {
              const groupKey = `${targetSemester}:${course.course_group}`;
              if (assignedCourseGroupsPerSem.has(groupKey)) continue;
              assignedCourseGroupsPerSem.add(groupKey);
            }

            const status = student.transferred_course_ids.has(course.course_id)
              ? "Transferred"
              : "Planned";

            courseAssignments.push({
              course_id: course.course_id,
              semester: targetSemester,
              status: status,
            });
          }
        } else {
          // ── Credit transfer students (starting_semester > 1): smart auto-schedule ──

          // 1. Add transferred courses first (keep their original semester)
          for (const course of allProgramCourses) {
            if (student.transferred_course_ids.has(course.course_id)) {
              if (course.course_group) {
                const groupKey = `${course.semester}:${course.course_group}`;
                if (assignedCourseGroupsPerSem.has(groupKey)) continue;
                assignedCourseGroupsPerSem.add(groupKey);
              }
              courseAssignments.push({
                course_id: course.course_id,
                semester: course.semester,
                status: "Transferred",
              });
            }
          }

          // ── INTAKE-BASED DYNAMIC SEMESTER CYCLES ──
          const rawIntake = intake.intake_type ? intake.intake_type.toLowerCase() : "";
          let baseCyclePattern: ("L" | "S")[] = ["L", "L", "S"]; // Default

          if (rawIntake.includes("may")) {
            baseCyclePattern = ["S", "L", "L"];
          } else if (rawIntake.includes("aug")) {
            baseCyclePattern = ["L", "L", "S"];
          } else if (rawIntake.includes("dec")) {
            baseCyclePattern = ["L", "S", "L"];
          }

          // 2. Dynamically determine semester credit plans from program structure
          let creditPlans: Array<{
            semester_number: number;
            semester_type: "L" | "S";
            is_li: boolean;
            target_credits: number;
          }> = [];

          for (let sem = student.starting_semester; sem <= maxProgramSemester; sem++) {
            const stat = semesterStats.get(sem);
            if (!stat) continue;

            // Calculate the relative semester position (1-based index)
            const relativeSem = sem - student.starting_semester + 1;
            
            // Map it back to the program's normal cycle using modulo
            let mappedSem = relativeSem;
            if (mappedSem > maxProgramSemester) {
                mappedSem = ((relativeSem - 1) % maxProgramSemester) + 1;
            }

            const mappedStat = semesterStats.get(mappedSem);
            
            // If it's a known LI relative semester, it must be Long
            const is_li = mappedStat?.has_li || false;
            let semType: "L" | "S" = "L";
            
            if (is_li) {
              semType = "L"; 
            } else {
              semType = baseCyclePattern[(relativeSem - 1) % 3];
            }

            creditPlans.push({
              semester_number: sem,
              semester_type: semType,
              is_li: is_li,
              target_credits: 0,
            });
          }

          // 3. Collect planned courses (not transferred, respecting groups)
          const plannedCourses: ProgramCourse[] = [];
          const plannedGroupsPerSem = new Set<string>();
          for (const course of allProgramCourses) {
            if (student.transferred_course_ids.has(course.course_id)) continue;
            if (course.course_group) {
              const groupKey = `${course.semester}:${course.course_group}`;
              if (assignedCourseGroupsPerSem.has(groupKey)) continue;
              if (plannedGroupsPerSem.has(groupKey)) continue;
              plannedGroupsPerSem.add(groupKey);
            }
            plannedCourses.push(course);
          }

          // 4. Smart scheduling using credit plans
          if (creditPlans.length > 0) {
            // Separate Industrial Training courses from regular courses
            const itCourses = plannedCourses.filter(
              (c) => c.course_type === "Industrial Training",
            );
            const regularCourses = plannedCourses.filter(
              (c) => c.course_type !== "Industrial Training",
            );

            const assignedCourseIds = new Set<number>(
              student.transferred_course_ids,
            );
            const semesterCreditsUsed = new Map<number, number>();

            // PRIORITY-BASED TOPOLOGICAL SCHEDULER
            // Builds the schedule logically semester-by-semester 

            // 1. Initialize Prerequisites & State Tracker
            const inDegree = new Map<number, number>();
            const prereqMap = new Map<number, number>(); // course_id -> prerequisite_course_id
            
            for (const c of regularCourses) {
               if (c.prerequisite_course_id) {
                  prereqMap.set(c.course_id, c.prerequisite_course_id);
                  inDegree.set(c.course_id, 1); // Simple 1-to-1 prereq mapping in this system
               } else {
                  inDegree.set(c.course_id, 0);
               }
            }

            // Courses already taken or officially scheduled in past semesters
            const completedCourses = new Set<number>(student.transferred_course_ids);
            
            // Build quick-lookup map: semester_number → plan (used by addExtraSemester)
            const planSemMap = new Map<number, (typeof creditPlans)[0]>();
            for (const plan of creditPlans) {
              planSemMap.set(plan.semester_number, plan);
            }

            // Helper: get the hard max credit for a semester based on its type
            function getMaxCredit(plan: (typeof creditPlans)[0]): number {
              return plan.semester_type === "L"
                ? creditLimits.long_max
                : creditLimits.short_max;
            }

            // Effective capacity = min(target_credits, program max credit for semester type)
            function getEffectiveCapacity(
              plan: (typeof creditPlans)[0],
            ): number {
              // If target_credits is 0 (not configured), use the program hard max
              if (!plan.target_credits) return getMaxCredit(plan);
              return Math.min(plan.target_credits, getMaxCredit(plan));
            }

            // Helper: check if a course can only go on Long semesters
            function isLongSemesterOnly(course: ProgramCourse): boolean {
              if (course.course_type === "Industrial Training") return true;
              if (
                course.course_type === "Final Year Project" &&
                /2|II/i.test(course.course_name)
              )
                return true;
              return false;
            }

            // Helper: get the min credit for a semester based on its type
            function getMinCredit(plan: (typeof creditPlans)[0]): number {
              return plan.semester_type === "L"
                ? creditLimits.long_min
                : creditLimits.short_min;
            }

            // Helper: find nearest semester with available capacity
            // Prefers under-minimum semesters first, then ascending order
            // LI semesters are excluded — only non-LI semesters for regular courses
            const nonLiPlans = creditPlans.filter((p) => !p.is_li);

            // Auto-extend: add a new non-LI semester following the physical intake pattern
            function addExtraSemester(
              afterSem: number,
              longOnly: boolean = false,
            ): (typeof creditPlans)[0] {
              const nextNum = afterSem + 1;
              const relativeSem = nextNum - student.starting_semester + 1;
              
              let semType = baseCyclePattern[(relativeSem - 1) % 3];
              // If we need a Long semester but the cycle gives Short, force Long
              if (longOnly && semType === "S") semType = "L";

              const newPlan = {
                semester_number: nextNum,
                semester_type: semType,
                is_li: false,
                target_credits: 0, // uses program hard max via getEffectiveCapacity
              };
              creditPlans.push(newPlan);
              nonLiPlans.push(newPlan);
              planSemMap.set(nextNum, newPlan);
              return newPlan;
            }

            // Helper: Find or create the exact target semester
            function getOrCreatePlanForSemester(targetSemNum: number, longOnly: boolean = false): (typeof creditPlans)[0] {
               let plan = nonLiPlans.find(p => p.semester_number === targetSemNum && (!longOnly || p.semester_type === 'L'));
               
               if (!plan) {
                  // Wait, it might exist but is Short when we need Long
                  if (longOnly) {
                     const existingShort = nonLiPlans.find(p => p.semester_number === targetSemNum);
                     if (existingShort) {
                        // Forcing it to long
                        existingShort.semester_type = "L";
                        return existingShort;
                     }
                  }

                  // Check if it exists in creditPlans as an LI semester natively mapping here.
                  // If so, we just steal it back and force it to regular, avoiding duplicate semester numbers!
                  const liVersion = creditPlans.find(p => p.semester_number === targetSemNum);
                  if (liVersion) {
                     liVersion.is_li = false;
                     liVersion.semester_type = longOnly ? "L" : (liVersion.semester_type || "L");
                     nonLiPlans.push(liVersion);
                     nonLiPlans.sort((a,b) => a.semester_number - b.semester_number);
                     return liVersion;
                  }
                  // Doesn't exist at all, we must ensure all intermediate semesters physically exist
                  const highestExisting = Math.max(...nonLiPlans.map(p => p.semester_number), student.starting_semester - 1);
                  for (let i = highestExisting + 1; i <= targetSemNum; i++) {
                     const isTarget = i === targetSemNum;
                     const reqLong = isTarget && longOnly;
                     
                     let intermediatePlan = nonLiPlans.find(p => p.semester_number === i);
                     if (!intermediatePlan) {
                         // Check if it exists natively in creditPlans as an LI block
                         const nativeLi = creditPlans.find(p => p.semester_number === i);
                         if (nativeLi) {
                            nativeLi.is_li = false;
                            nativeLi.semester_type = reqLong ? "L" : (nativeLi.semester_type || "L");
                            nonLiPlans.push(nativeLi);
                            intermediatePlan = nativeLi;
                         } else {
                            intermediatePlan = addExtraSemester(i - 1, reqLong);
                         }
                     } else if (reqLong && intermediatePlan.semester_type !== "L") {
                         intermediatePlan.semester_type = "L";
                     }
                     if (isTarget) {
                         plan = intermediatePlan;
                     }
                  }
                  nonLiPlans.sort((a,b) => a.semester_number - b.semester_number);
               }
               return plan as (typeof creditPlans)[0];
            }

            // 2. Semester-by-Semester Simulation Loop
            let currentSem = student.starting_semester;
            let unassignedRegularCourses = [...regularCourses];

            while (unassignedRegularCourses.length > 0) {
              const plan = getOrCreatePlanForSemester(currentSem, false); // Fetch the semester container
              const capacity = getEffectiveCapacity(plan);
              let usedCredits = semesterCreditsUsed.get(plan.semester_number) || 0;
              
              // Find all courses whose prerequisites are fully met as of the start of this semester
              const availablePool = unassignedRegularCourses.filter(c => {
                  const prereqId = prereqMap.get(c.course_id);
                  if (!prereqId) return true; // No prereq
                  return completedCourses.has(prereqId); // Prereq was completed in a strictly PREVIOUS semester
              });

              // If pool is empty but we still have courses, it means all remaining courses are blocked
              // by prerequisites that haven't been completed yet. We MUST move to the next semester.
              if (availablePool.length === 0) {
                 currentSem++;
                 continue;
              }

              // 3. Priority Sorting
              // Sort Available Pool strictly by:
              //   1. Original Semester (Ascending) -> Force early courses into gaps first
              //   2. Credit Hours (Descending) -> Pack larger courses first
              //   3. Stable ID fallback
              availablePool.sort((a, b) => {
                 if (a.semester !== b.semester) return a.semester - b.semester;
                 if (a.credit_hour !== b.credit_hour) return b.credit_hour - a.credit_hour;
                 return a.id - b.id; 
              });

              const scheduledThisSemester = new Set<number>();
              let coursesProcessedThisSem = 0;

              // 4. Pack the Semester
              for (const course of availablePool) {
                 const longOnly = isLongSemesterOnly(course);
                 
                 // Constraints Check
                 if (longOnly && plan.semester_type === "S") {
                    // Cannot place this course here. Skip it. It stays in the pool for a future long semester.
                    continue; 
                 }

                 if (usedCredits + course.credit_hour <= capacity) {
                    // Place course
                    courseAssignments.push({
                      course_id: course.course_id,
                      semester: plan.semester_number,
                      status: "Planned",
                    });
                    
                    assignedCourseIds.add(course.course_id);
                    scheduledThisSemester.add(course.course_id);
                    usedCredits += course.credit_hour;
                    semesterCreditsUsed.set(plan.semester_number, usedCredits);
                    coursesProcessedThisSem++;
                 }
              }

              // Remove scheduled courses from the unassigned list
              if (coursesProcessedThisSem > 0) {
                 unassignedRegularCourses = unassignedRegularCourses.filter(
                    c => !scheduledThisSemester.has(c.course_id)
                 );
                 
                 // Add newly scheduled courses to completed list ONLY AFTER the semester ends
                 // This enforces the rule that you cannot take a course AND its prereq in the exact same semester
                 for (const cid of scheduledThisSemester) {
                    completedCourses.add(cid);
                 }
              }

              // Move to the next semester sequentially
              currentSem++;
            }

            // ============================================================================
            // BACKFILL SMOOTHING PASS (V2)
            // The topological sort might naturally finish with the final semesters being 
            // underloaded (e.g., reaching the end of the required courses). 
            // We pull courses forward from earlier, heavier semesters to ensure the final 
            // semesters meet their required minimum credits where possible.
            // ============================================================================

            // 1. Find the highest semester that currently holds a regular course
            let lastRegularSem = 0;
            for (const a of courseAssignments) {
               if (a.semester > lastRegularSem) lastRegularSem = a.semester;
            }

            // 2. We evaluate the last active semester (lastRegularSem) AND the target next semester (if we skipped it for LI)
            const nextNaturalSem = lastRegularSem + 1;
            let nextPlan = getOrCreatePlanForSemester(nextNaturalSem, false);
            
            // We want to smooth both the nextNaturalSem (if it's a Short semester before LI) AND all generated regular semesters
            const semestersToSmooth = [];
            
            if (nextPlan.semester_type === "S") {
               semestersToSmooth.push(nextNaturalSem);
            }
            
            // Add all assigned regular semesters in backwards order so the backfill ripples all the way up the plan
            for (let s = lastRegularSem; s > student.starting_semester; s--) {
               semestersToSmooth.push(s);
            }

            for (const targetSem of semestersToSmooth) {
               const targetPlan = getOrCreatePlanForSemester(targetSem, false);
               const minTargetCredits = getMinCredit(targetPlan);
               const maxTargetCredits = getEffectiveCapacity(targetPlan);
               let currentTargetCredits = semesterCreditsUsed.get(targetSem) || 0;
               
               // If the target semester is below its minimum credit requirement, we need to pull courses forward
               if (currentTargetCredits < minTargetCredits) {
                  
                  // Iteratively step backwards through previous semesters to find courses to pull forward
                  for (let sem = targetSem - 1; sem >= student.starting_semester; sem--) {
                     if (currentTargetCredits >= minTargetCredits) break; // Reached the minimum goal

                     let usedCreditsHeavy = semesterCreditsUsed.get(sem) || 0;
                     if (usedCreditsHeavy <= 0) continue;
                     
                     const donorPlan = getOrCreatePlanForSemester(sem, false);
                     const minDonorCredits = getMinCredit(donorPlan);

                     // Get all courses currently assigned to this preceding semester
                     const coursesInHeavySem = courseAssignments
                        .filter(a => a.semester === sem)
                        .map(a => regularCourses.find(c => c.course_id === a.course_id))
                        .filter(c => c !== undefined) as ProgramCourse[];

                     // Sort them to pick the best candidates (smaller credits first to avoid overshooting too much)
                     coursesInHeavySem.sort((a,b) => a.credit_hour - b.credit_hour);

                     for (const course of coursesInHeavySem) {
                        if (currentTargetCredits >= minTargetCredits) break;
                        
                        // Check constraints
                        if (isLongSemesterOnly(course) && targetPlan.semester_type === "S") continue; // Can't move FYP2/LI to a Short sem
                        
                        // Does the target semester have capacity for this course?
                        if (currentTargetCredits + course.credit_hour > maxTargetCredits) continue;

                        // Check if pulling this course would drop the donor semester below *its* minimum.
                        // We strictly want to avoid creating a new underloaded semester while fixing this one.
                        if (usedCreditsHeavy - course.credit_hour < minDonorCredits) continue; 
                        
                        // Prerequisite Rule Check: 
                        // If we pull this course forward to targetSem, does it violate the rule that 
                        // it MUST be completed in a semester strictly BEFORE any course that depends on it?
                        let breaksPrereq = false;
                        for (const futureDependent of courseAssignments) {
                           // Find courses that mathematically depend on the course we are trying to move
                           const dependentCourseDetails = regularCourses.find(c => c.course_id === futureDependent.course_id);
                           if (dependentCourseDetails && dependentCourseDetails.prerequisite_course_id === course.course_id) {
                              // If we move this course to targetSem, it MUST be strictly less than the semester of the dependent course
                              if (targetSem >= futureDependent.semester) {
                                 breaksPrereq = true;
                                 break;
                              }
                           }
                        }
                        if (breaksPrereq) continue;

                        // Move it logically forward
                        const assignmentObj = courseAssignments.find(a => a.course_id === course.course_id && a.semester === sem);
                        if (assignmentObj) {
                           assignmentObj.semester = targetSem;
                           
                           usedCreditsHeavy -= course.credit_hour;
                           currentTargetCredits += course.credit_hour;
                           
                           semesterCreditsUsed.set(sem, usedCreditsHeavy);
                           semesterCreditsUsed.set(targetSem, currentTargetCredits);
                        }
                     }
                  }
               }
            }


            // ── Assign IT courses to LI semester AFTER all regular courses ──
            // LI requires all other courses to be completed first
            if (itCourses.length > 0) {
              // Find the latest semester with a scheduled regular course
              let lastScheduledSem = 0;
              for (const a of courseAssignments) {
                if (a.semester > lastScheduledSem)
                  lastScheduledSem = a.semester;
              }

              // Ensure IT courses go to the exact next semester to prevent zero-course gaps
              let targetSem = lastScheduledSem + 1;
              let liPlan = creditPlans.find(
                (p) => p.semester_number === targetSem,
              );

              // If liPlan already exists, we must ensure it's a Long semester.
              // If the natural cycle says it should be a Short semester, we skip it
              // and create the LI plan in the next semester (targetSem + 1) which will be Long.
              if (liPlan && liPlan.semester_type === "S") {
                 targetSem++;
                 liPlan = creditPlans.find(p => p.semester_number === targetSem);
                 
                 // If that semester also didn't physically exist, make sure we generate intermediate plans
                 if (!liPlan) {
                    getOrCreatePlanForSemester(targetSem, true);
                    liPlan = creditPlans.find(p => p.semester_number === targetSem);
                 }
              }

              if (!liPlan) {
                liPlan = {
                  semester_number: targetSem,
                  semester_type: "L" as "L",
                  is_li: true,
                  target_credits: 0,
                };
                creditPlans.push(liPlan);
              } else {
                liPlan.is_li = true;
                liPlan.semester_type = "L" as "L";
              }

              for (const itCourse of itCourses) {
                courseAssignments.push({
                  course_id: itCourse.course_id,
                  semester: liPlan.semester_number,
                  status: "Planned",
                });
                assignedCourseIds.add(itCourse.course_id);
                semesterCreditsUsed.set(
                  liPlan.semester_number,
                  (semesterCreditsUsed.get(liPlan.semester_number) || 0) +
                    itCourse.credit_hour,
                );
              }
            }

          } else {
            // No credit plans configured: fallback to original program structure semesters
            for (const course of plannedCourses) {
              courseAssignments.push({
                course_id: course.course_id,
                semester: course.semester,
                status: "Planned",
              });
            }
          }
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

    const totalStudents = (studentRows as any[]).length;
    const [successfulPlanRows] = await connection.query(
      `SELECT COUNT(DISTINCT ap.student_id) AS successful_plans
       FROM academic_plans ap
       JOIN students s ON s.id = ap.student_id
       WHERE ap.intake_id = ?
         AND s.program_id = ?
         AND s.intake_year = ?`,
      [intakeId, programId, intake.intake_year],
    );

    const successfulPlanCount = Number(
      (successfulPlanRows as any[])[0]?.successful_plans ?? 0,
    );
    const failedPlanCount = Math.max(totalStudents - successfulPlanCount, 0);

    // Update intake statistics using the full intake counts so regenerate
    // doesn't overwrite the dashboard totals with only the retry batch.
    await connection.query(
      `UPDATE academic_planning_intakes 
       SET status = 'generated',
           total_students = ?,
           successful_plans = ?,
           failed_plans = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        totalStudents,
        successfulPlanCount,
        failedPlanCount,
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
