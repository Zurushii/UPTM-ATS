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
          // ── Semester 1 students: follow program structure directly ──
          for (const course of allProgramCourses) {
            if (course.course_group) {
              const groupKey = `${course.semester}:${course.course_group}`;
              if (assignedCourseGroupsPerSem.has(groupKey)) continue;
              assignedCourseGroupsPerSem.add(groupKey);
            }

            const status = student.transferred_course_ids.has(course.course_id)
              ? "Transferred"
              : "Planned";

            courseAssignments.push({
              course_id: course.course_id,
              semester: course.semester,
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

          // 2. Fetch semester credit plans for this student's rule
          const [ruleRows] = await connection.query(
            `SELECT ser.id AS rule_id
             FROM semester_entry_rules ser
             WHERE ser.program_id = ? AND ser.intake_type = ? AND ser.entry_semester = ?
             LIMIT 1`,
            [programId, intake.intake_type, student.starting_semester],
          );

          let creditPlans: Array<{
            semester_number: number;
            semester_type: "L" | "S";
            is_li: boolean;
            target_credits: number;
          }> = [];

          if ((ruleRows as any[]).length > 0) {
            const ruleId = (ruleRows as any[])[0].rule_id;
            const [cpRows] = await connection.query(
              `SELECT semester_number, semester_type, is_li, target_credits
               FROM semester_credit_plans
               WHERE rule_id = ?
               ORDER BY semester_number ASC`,
              [ruleId],
            );
            creditPlans = (cpRows as any[]).map((r: any) => ({
              semester_number: r.semester_number,
              semester_type: r.semester_type as "L" | "S",
              is_li: !!r.is_li,
              target_credits: Number(r.target_credits),
            }));
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

            // Sort regular courses by their default semester (respect natural ordering)
            regularCourses.sort((a, b) => a.semester - b.semester);

            // Build quick-lookup map: semester_number → plan
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
            // Prefers under-minimum semesters first, then nearest by proximity
            // LI semesters are excluded — only non-LI semesters for regular courses
            const nonLiPlans = creditPlans.filter((p) => !p.is_li);
            function findNearestSemester(
              defaultSem: number,
              creditHour: number,
              minSemester: number, // must be > this (for prereq ordering)
              respectCapacity: boolean,
              longOnly: boolean = false, // if true, only consider Long (L) semesters
            ): (typeof creditPlans)[0] | null {
              const eligible = nonLiPlans.filter(
                (p) =>
                  p.semester_number > minSemester &&
                  (!longOnly || p.semester_type === "L"),
              );

              // Partition: under-minimum semesters vs others
              const underMin = eligible.filter((p) => {
                const used = semesterCreditsUsed.get(p.semester_number) || 0;
                return used < getMinCredit(p);
              });
              const rest = eligible.filter((p) => {
                const used = semesterCreditsUsed.get(p.semester_number) || 0;
                return used >= getMinCredit(p);
              });

              // Sort each group by proximity to default semester
              const byProximity = (
                a: (typeof creditPlans)[0],
                b: (typeof creditPlans)[0],
              ) =>
                Math.abs(a.semester_number - defaultSem) -
                Math.abs(b.semester_number - defaultSem);
              underMin.sort(byProximity);
              rest.sort(byProximity);

              // Try under-minimum semesters first, then the rest
              const candidates = [...underMin, ...rest];

              for (const plan of candidates) {
                const used = semesterCreditsUsed.get(plan.semester_number) || 0;
                if (!respectCapacity) {
                  // Even when ignoring target capacity, never exceed program hard max
                  if (used + creditHour <= getMaxCredit(plan)) {
                    return plan;
                  }
                } else {
                  if (used + creditHour <= getEffectiveCapacity(plan)) {
                    return plan;
                  }
                }
              }
              // If ignoring capacity and everything exceeds hard max, return the least-full
              if (!respectCapacity && candidates.length > 0) {
                return candidates.reduce((best, plan) => {
                  const bestUsed =
                    semesterCreditsUsed.get(best.semester_number) || 0;
                  const planUsed =
                    semesterCreditsUsed.get(plan.semester_number) || 0;
                  return planUsed < bestUsed ? plan : best;
                });
              }
              return null;
            }

            // IT courses will be assigned AFTER all regular courses are scheduled
            // (LI requires all other courses to be completed first)

            // ── Pre-schedule: Reserve long-only prerequisite chains (e.g., FYP1→FYP2) ──
            // FYP2 must go on a Long semester. If we schedule normally, FYP1 may land
            // on the last Long semester, leaving no Long semester for FYP2.
            // Solve by scheduling these chains in reverse: FYP2 first (latest Long),
            // then FYP1 on a semester before that.
            for (const course of regularCourses) {
              if (!isLongSemesterOnly(course)) continue;
              if (assignedCourseIds.has(course.course_id)) continue;

              // Build prerequisite chain: [FYP1, FYP2] (prereqs first)
              const chain: ProgramCourse[] = [course];
              let current = course;
              while (current.prerequisite_course_id) {
                const prereq = regularCourses.find(
                  (c) => c.course_id === current.prerequisite_course_id,
                );
                if (!prereq || assignedCourseIds.has(prereq.course_id)) break;
                chain.unshift(prereq);
                current = prereq;
              }

              // Schedule in reverse: dependent (FYP2) first → then prereqs before it
              let nextMustBeBefore = Infinity;

              for (let i = chain.length - 1; i >= 0; i--) {
                const c = chain[i];
                if (assignedCourseIds.has(c.course_id)) {
                  const existingSem =
                    courseAssignments.find((a) => a.course_id === c.course_id)
                      ?.semester ?? Infinity;
                  nextMustBeBefore = existingSem;
                  continue;
                }

                const cLongOnly = isLongSemesterOnly(c);

                // Prereq of this chain member that's already assigned (e.g., transferred)
                const prereqSem = c.prerequisite_course_id
                  ? (courseAssignments.find(
                      (a) => a.course_id === c.prerequisite_course_id,
                    )?.semester ?? 0)
                  : 0;

                // Eligible semesters: non-LI, before the dependent, after any prereq
                const eligible = nonLiPlans.filter(
                  (p) =>
                    p.semester_number < nextMustBeBefore &&
                    p.semester_number > prereqSem &&
                    (!cLongOnly || p.semester_type === "L"),
                );

                // Pick the latest semester with capacity
                let bestPlan: (typeof creditPlans)[0] | null = null;
                for (let j = eligible.length - 1; j >= 0; j--) {
                  const used =
                    semesterCreditsUsed.get(eligible[j].semester_number) || 0;
                  if (
                    used + c.credit_hour <=
                    getEffectiveCapacity(eligible[j])
                  ) {
                    bestPlan = eligible[j];
                    break;
                  }
                }
                // Fallback: latest that fits hard max
                if (!bestPlan) {
                  for (let j = eligible.length - 1; j >= 0; j--) {
                    const used =
                      semesterCreditsUsed.get(eligible[j].semester_number) || 0;
                    if (used + c.credit_hour <= getMaxCredit(eligible[j])) {
                      bestPlan = eligible[j];
                      break;
                    }
                  }
                }
                // Last fallback: just pick the latest eligible
                if (!bestPlan && eligible.length > 0) {
                  bestPlan = eligible[eligible.length - 1];
                }

                if (bestPlan) {
                  courseAssignments.push({
                    course_id: c.course_id,
                    semester: bestPlan.semester_number,
                    status: "Planned",
                  });
                  assignedCourseIds.add(c.course_id);
                  semesterCreditsUsed.set(
                    bestPlan.semester_number,
                    (semesterCreditsUsed.get(bestPlan.semester_number) || 0) +
                      c.credit_hour,
                  );
                  nextMustBeBefore = bestPlan.semester_number;
                }
              }
            }

            // First pass: assign courses whose prerequisites are already satisfied
            const unassigned: ProgramCourse[] = [];
            for (const course of regularCourses) {
              // Skip courses already assigned (e.g., long-only chains pre-scheduled above)
              if (assignedCourseIds.has(course.course_id)) continue;

              if (
                course.prerequisite_course_id &&
                !assignedCourseIds.has(course.prerequisite_course_id)
              ) {
                unassigned.push(course);
                continue;
              }

              // Get the prereq's assigned semester (if any) to enforce ordering
              const prereqSem = course.prerequisite_course_id
                ? (courseAssignments.find(
                    (a) => a.course_id === course.prerequisite_course_id,
                  )?.semester ?? 0)
                : 0;

              // Try the course's default semester first
              const defaultPlan = planSemMap.get(course.semester);
              let assigned = false;
              const longOnly = isLongSemesterOnly(course);

              if (
                defaultPlan &&
                !defaultPlan.is_li &&
                (!longOnly || defaultPlan.semester_type === "L") &&
                defaultPlan.semester_number > prereqSem
              ) {
                const used =
                  semesterCreditsUsed.get(defaultPlan.semester_number) || 0;
                if (
                  used + course.credit_hour <=
                  getEffectiveCapacity(defaultPlan)
                ) {
                  courseAssignments.push({
                    course_id: course.course_id,
                    semester: defaultPlan.semester_number,
                    status: "Planned",
                  });
                  assignedCourseIds.add(course.course_id);
                  semesterCreditsUsed.set(
                    defaultPlan.semester_number,
                    used + course.credit_hour,
                  );
                  assigned = true;
                }
              }

              // Overflow: find nearest semester with capacity
              if (!assigned) {
                const nearest = findNearestSemester(
                  course.semester,
                  course.credit_hour,
                  prereqSem,
                  true,
                  longOnly,
                );
                if (nearest) {
                  const used =
                    semesterCreditsUsed.get(nearest.semester_number) || 0;
                  courseAssignments.push({
                    course_id: course.course_id,
                    semester: nearest.semester_number,
                    status: "Planned",
                  });
                  assignedCourseIds.add(course.course_id);
                  semesterCreditsUsed.set(
                    nearest.semester_number,
                    used + course.credit_hour,
                  );
                  assigned = true;
                }
              }

              if (!assigned) unassigned.push(course);
            }

            // Second pass: assign deferred courses (prerequisites now satisfied)
            const stillUnassigned: ProgramCourse[] = [];
            for (const course of unassigned) {
              const prereqSem = course.prerequisite_course_id
                ? (courseAssignments.find(
                    (a) => a.course_id === course.prerequisite_course_id,
                  )?.semester ?? 0)
                : 0;

              // Try default semester first (if after prereq)
              const defaultPlan = planSemMap.get(course.semester);
              let assigned = false;
              const longOnly = isLongSemesterOnly(course);

              if (
                defaultPlan &&
                !defaultPlan.is_li &&
                defaultPlan.semester_number > prereqSem &&
                (!longOnly || defaultPlan.semester_type === "L")
              ) {
                const used =
                  semesterCreditsUsed.get(defaultPlan.semester_number) || 0;
                if (
                  used + course.credit_hour <=
                  getEffectiveCapacity(defaultPlan)
                ) {
                  courseAssignments.push({
                    course_id: course.course_id,
                    semester: defaultPlan.semester_number,
                    status: "Planned",
                  });
                  assignedCourseIds.add(course.course_id);
                  semesterCreditsUsed.set(
                    defaultPlan.semester_number,
                    used + course.credit_hour,
                  );
                  assigned = true;
                }
              }

              // Overflow: find nearest semester with capacity after prereq
              if (!assigned) {
                const nearest = findNearestSemester(
                  course.semester,
                  course.credit_hour,
                  prereqSem,
                  true,
                  longOnly,
                );
                if (nearest) {
                  const used =
                    semesterCreditsUsed.get(nearest.semester_number) || 0;
                  courseAssignments.push({
                    course_id: course.course_id,
                    semester: nearest.semester_number,
                    status: "Planned",
                  });
                  assignedCourseIds.add(course.course_id);
                  semesterCreditsUsed.set(
                    nearest.semester_number,
                    used + course.credit_hour,
                  );
                  assigned = true;
                }
              }

              if (!assigned) stillUnassigned.push(course);
            }

            // Final pass: force-assign remaining courses (exceed target if needed)
            for (const course of stillUnassigned) {
              const prereqSem = course.prerequisite_course_id
                ? (courseAssignments.find(
                    (a) => a.course_id === course.prerequisite_course_id,
                  )?.semester ?? 0)
                : 0;

              // Try nearest semester ignoring capacity
              const longOnly = isLongSemesterOnly(course);
              const nearest = findNearestSemester(
                course.semester,
                course.credit_hour,
                prereqSem,
                false, // ignore capacity
                longOnly,
              );
              if (nearest) {
                courseAssignments.push({
                  course_id: course.course_id,
                  semester: nearest.semester_number,
                  status: "Planned",
                });
                assignedCourseIds.add(course.course_id);
                semesterCreditsUsed.set(
                  nearest.semester_number,
                  (semesterCreditsUsed.get(nearest.semester_number) || 0) +
                    course.credit_hour,
                );
              } else if (nonLiPlans.length > 0) {
                // Last resort: assign to the last eligible non-LI semester
                // Must still respect prereq ordering and long-only constraint
                const eligibleLastResort = (
                  longOnly
                    ? nonLiPlans.filter((p) => p.semester_type === "L")
                    : nonLiPlans
                ).filter((p) => p.semester_number > prereqSem);
                if (eligibleLastResort.length > 0) {
                  const lastPlan =
                    eligibleLastResort[eligibleLastResort.length - 1];
                  courseAssignments.push({
                    course_id: course.course_id,
                    semester: lastPlan.semester_number,
                    status: "Planned",
                  });
                  assignedCourseIds.add(course.course_id);
                  semesterCreditsUsed.set(
                    lastPlan.semester_number,
                    (semesterCreditsUsed.get(lastPlan.semester_number) || 0) +
                      course.credit_hour,
                  );
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

              for (const itCourse of itCourses) {
                // Find first remaining LI semester after all regular courses
                const liPlan = creditPlans.find(
                  (p) => p.is_li && p.semester_number > lastScheduledSem,
                );
                if (liPlan) {
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
                } else {
                  // No LI after last course — use original LI if still available
                  const anyLi = creditPlans.find((p) => p.is_li);
                  if (anyLi) {
                    courseAssignments.push({
                      course_id: itCourse.course_id,
                      semester: anyLi.semester_number,
                      status: "Planned",
                    });
                    assignedCourseIds.add(itCourse.course_id);
                    semesterCreditsUsed.set(
                      anyLi.semester_number,
                      (semesterCreditsUsed.get(anyLi.semester_number) || 0) +
                        itCourse.credit_hour,
                    );
                  }
                }
              }
            }

            // ── 5. Post-assignment rebalancing ──
            // Move courses from over-target semesters to under-minimum semesters
            // to eliminate credit limit warnings in the UI.
            const MAX_REBALANCE_ITERATIONS = 50;
            for (let iter = 0; iter < MAX_REBALANCE_ITERATIONS; iter++) {
              // Find under-minimum non-LI semesters (that have at least some courses)
              const underMinPlans = nonLiPlans.filter((p) => {
                const used = semesterCreditsUsed.get(p.semester_number) || 0;
                return used > 0 && used < getMinCredit(p);
              });
              if (underMinPlans.length === 0) break;

              // Find donor semesters: over-target first, then at-target but above min
              const overTargetPlans = nonLiPlans.filter((p) => {
                const used = semesterCreditsUsed.get(p.semester_number) || 0;
                return used > getEffectiveCapacity(p);
              });
              const atTargetPlans = nonLiPlans.filter((p) => {
                const used = semesterCreditsUsed.get(p.semester_number) || 0;
                return (
                  used <= getEffectiveCapacity(p) && used > getMinCredit(p)
                );
              });
              const donorPlans = [...overTargetPlans, ...atTargetPlans];
              if (donorPlans.length === 0) break;

              let moved = false;
              for (const receiver of underMinPlans) {
                const receiverUsed =
                  semesterCreditsUsed.get(receiver.semester_number) || 0;
                if (receiverUsed >= getMinCredit(receiver)) continue;

                for (const donor of donorPlans) {
                  const donorUsed =
                    semesterCreditsUsed.get(donor.semester_number) || 0;
                  const donorMin = getMinCredit(donor);

                  // Find movable courses in the donor semester
                  const donorCourses = courseAssignments.filter(
                    (a) =>
                      a.semester === donor.semester_number &&
                      a.status === "Planned",
                  );

                  for (const assignment of donorCourses) {
                    const creditHour =
                      courseIdToCreditHour.get(assignment.course_id) || 0;
                    if (creditHour === 0) continue;

                    // Donor must stay >= min after losing course
                    if (donorUsed - creditHour < donorMin) continue;

                    // Receiver must not exceed hard max
                    const newReceiverUsed = receiverUsed + creditHour;
                    if (newReceiverUsed > getMaxCredit(receiver)) continue;

                    // Check prerequisite ordering:
                    // This course's prereq must be in earlier semester than receiver
                    const courseDetail = regularCourses.find(
                      (c) => c.course_id === assignment.course_id,
                    );
                    if (courseDetail?.prerequisite_course_id) {
                      const prereqAssignment = courseAssignments.find(
                        (a) =>
                          a.course_id === courseDetail.prerequisite_course_id,
                      );
                      if (
                        prereqAssignment &&
                        prereqAssignment.semester >= receiver.semester_number
                      )
                        continue;
                    }

                    // Long-semester-only courses cannot be moved to Short semesters
                    if (
                      courseDetail &&
                      isLongSemesterOnly(courseDetail) &&
                      receiver.semester_type !== "L"
                    )
                      continue;

                    // No dependent course should be in semester <= receiver
                    const dependents = courseAssignments.filter((a) => {
                      const dep = regularCourses.find(
                        (c) => c.course_id === a.course_id,
                      );
                      return (
                        dep?.prerequisite_course_id === assignment.course_id
                      );
                    });
                    if (
                      dependents.some(
                        (d) => d.semester <= receiver.semester_number,
                      )
                    )
                      continue;

                    // Move the course
                    assignment.semester = receiver.semester_number;
                    semesterCreditsUsed.set(
                      donor.semester_number,
                      donorUsed - creditHour,
                    );
                    semesterCreditsUsed.set(
                      receiver.semester_number,
                      newReceiverUsed,
                    );
                    moved = true;
                    break; // Re-evaluate after each move
                  }
                  if (moved) break;
                }
                if (moved) break;
              }
              if (!moved) break; // No more moves possible
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
