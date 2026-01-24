import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";
import ExcelJS from "exceljs";

interface ImportedCourse {
  course_code: string;
  course_name: string;
  credit_hour: number;
  semester: number;
  course_type: string;
  course_group: string | null;
  prerequisite_code: string | null;
}

interface ImportResult {
  course_code: string;
  course_name: string;
  semester: number;
  status: "created" | "existing" | "added";
  course_id: number;
}

interface FailedImport {
  row: number;
  course_code: string | null;
  reason: string;
}

// Map Excel status values to our course_type enum
const courseTypeMap: Record<string, string> = {
  "core computing": "Core Computing",
  "corecomputing": "Core Computing",
  "core": "Core Computing",
  "free elective": "Free Elective",
  "freeelective": "Free Elective",
  "elective": "Free Elective",
  "compulsory": "Compulsory",
  "specialization": "Specialization",
  "discipline core": "Discipline Core",
  "disciplinecore": "Discipline Core",
  "final year project": "Final Year Project",
  "fyp": "Final Year Project",
  "industrial training": "Industrial Training",
  "internship": "Industrial Training",
  "li": "Industrial Training",
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
  let sessionId: number | null = null;

  for (const field of formData) {
    if (field.name === "file" && field.data) {
      fileBuffer = field.data;
    } else if (field.name === "session_id" && field.data) {
      sessionId = parseInt(field.data.toString());
    }
  }

  if (!fileBuffer) {
    throw createError({
      statusCode: 400,
      statusMessage: "Excel file is required",
    });
  }

  if (!sessionId) {
    throw createError({
      statusCode: 400,
      statusMessage: "session_id is required",
    });
  }

  // Verify session belongs to this program
  const [sessionRows] = await pool.query(
    `SELECT id FROM program_sessions WHERE id = ? AND program_id = ?`,
    [sessionId, programId],
  );

  if ((sessionRows as any[]).length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Session not found",
    });
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

  // Extract courses from Excel
  const importedCourses: ImportedCourse[] = [];
  const failedImports: FailedImport[] = [];
  let currentSemester = 1;
  let semestersPerYear = 3; // Default: 3 semesters per year

  // Find column indices from header row
  let courseCodeCol = -1;
  let courseNameCol = -1;
  let creditCol = -1;
  let statusCol = -1;
  let prereqCol = -1;

  // Track last non-empty values for merged cell handling
  let lastCredit = 0;
  let lastStatus = "";
  let lastPrereq = "";
  let currentCourseGroup: string | null = null;
  let groupCourseNames: string[] = [];

  // Scan for header row and semester headers
  for (let rowNum = 1; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);
    if (!row.hasValues) continue;

    // Get cell values, handling merged cells
    const getCellValue = (colNum: number): string => {
      const cell = row.getCell(colNum);
      if (cell.isMerged && cell.master) {
        return String(cell.master.value || "").trim();
      }
      return String(cell.value || "").trim();
    };

    const firstCellValue = getCellValue(1).toLowerCase();
    
    // Check if this is a semester header (e.g., "SEMESTER 1 / YEAR 1" or "SEMESTER 2 / YEAR 2")
    const semesterMatch = firstCellValue.match(/semester\s*(\d+)\s*[\/\\]?\s*year\s*(\d+)/i);
    if (semesterMatch) {
      const semNum = parseInt(semesterMatch[1]);
      const yearNum = parseInt(semesterMatch[2]);
      // Calculate actual semester: (year - 1) * semestersPerYear + semester
      currentSemester = (yearNum - 1) * semestersPerYear + semNum;
      // Reset group tracking for new semester
      currentCourseGroup = null;
      groupCourseNames = [];
      continue;
    }

    // Also handle simple "SEMESTER X" format
    const simpleSemesterMatch = firstCellValue.match(/^semester\s*(\d+)$/i);
    if (simpleSemesterMatch) {
      currentSemester = parseInt(simpleSemesterMatch[1]);
      currentCourseGroup = null;
      groupCourseNames = [];
      continue;
    }

    // Check if this is a header row
    if (firstCellValue === "#" || firstCellValue.includes("course code") || firstCellValue.includes("coursecode")) {
      row.eachCell((cell, colNumber) => {
        const value = String(cell.value || "").toLowerCase().trim().replace(/\s+/g, "_");
        if (value === "course_code" || value === "coursecode" || value === "code") {
          courseCodeCol = colNumber;
        } else if (value === "course_name" || value === "coursename" || value === "name") {
          courseNameCol = colNumber;
        } else if (value === "credit" || value === "credits" || value === "credit_hour" || value === "credithour") {
          creditCol = colNumber;
        } else if (value === "status" || value === "type" || value === "course_type") {
          statusCol = colNumber;
        } else if (value === "pre-req" || value === "prereq" || value === "prerequisite" || value === "pre_req") {
          prereqCol = colNumber;
        }
      });
      continue;
    }

    // Skip if we haven't found header yet
    if (courseCodeCol === -1) continue;

    // Skip total rows
    if (firstCellValue === "total" || getCellValue(courseCodeCol).toLowerCase() === "total") continue;

    // Parse data row
    let courseCode = getCellValue(courseCodeCol);
    const courseName = getCellValue(courseNameCol);
    const creditCell = row.getCell(creditCol);
    const statusValue = statusCol !== -1 ? getCellValue(statusCol) : "";
    const prereqValue = prereqCol !== -1 ? getCellValue(prereqCol) : "";

    // Skip empty rows
    if (!courseCode || courseCode === "") continue;

    // Check if course code has trailing "/" indicating it's part of a group
    const hasTrailingSlash = courseCode.endsWith("/") || courseCode.endsWith("\\");
    if (hasTrailingSlash) {
      courseCode = courseCode.replace(/[\/\\]+$/, "").trim();
    }

    // Check if credit cell is merged (slave cell in a merge range)
    // A slave cell is part of a merge but not the master/first cell
    const creditIsMergedSlave = creditCell.isMerged && creditCell.master && 
      (creditCell.master.row !== creditCell.row || creditCell.master.col !== creditCell.col);
    
    // Also check if credit value is null/undefined (another sign of merged cell)
    const rawCreditValue = creditCell.value;
    const creditIsNull = rawCreditValue === null || rawCreditValue === undefined;
    
    // Determine if credit cell is empty/merged
    const creditIsEmpty = creditIsMergedSlave || creditIsNull || String(rawCreditValue).trim() === "";

    let credit = 0;
    if (typeof rawCreditValue === "number") {
      credit = rawCreditValue;
    } else if (rawCreditValue && String(rawCreditValue).trim() !== "") {
      const parsed = parseInt(String(rawCreditValue));
      if (!isNaN(parsed)) {
        credit = parsed;
      }
    }

    // Determine if this course is part of a group:
    // 1. Has trailing "/" in course code, OR
    // 2. Credit cell is empty/merged (indicating shared credit with previous course)
    const isMergedWithPrevious = creditIsEmpty && lastCredit > 0;
    const isPartOfGroup = hasTrailingSlash || isMergedWithPrevious;

    // If part of group due to merged cells, use last known credit
    if (creditIsEmpty && lastCredit > 0) {
      credit = lastCredit;
    }

    // Handle merged status cells
    let status = statusValue;
    if (status && status !== "") {
      lastStatus = status;
    } else if (lastStatus) {
      status = lastStatus;
    }

    // Handle merged prereq cells  
    let prereq = prereqValue;
    if (prereq && prereq !== "" && prereq.toLowerCase() !== "none" && prereq !== "-") {
      lastPrereq = prereq;
    } else if (!prereq || prereq === "") {
      prereq = lastPrereq;
    }

    if (isNaN(credit) || credit <= 0) {
      failedImports.push({
        row: rowNum,
        course_code: courseCode,
        reason: "Invalid or missing credit value",
      });
      continue;
    }

    // Map course type
    const normalizedStatus = status.toLowerCase().replace(/\s+/g, " ").trim();
    const courseType = courseTypeMap[normalizedStatus] || "Core Computing";

    // Handle prerequisite
    const prerequisiteCode = prereq && prereq.toLowerCase() !== "none" && prereq !== "-" 
      ? prereq 
      : null;

    // Determine course group
    if (isPartOfGroup) {
      if (!currentCourseGroup) {
        // Start a new group - use a descriptive name based on the status
        currentCourseGroup = `${courseType} Elective`;
        
        // IMPORTANT: Retroactively update the PREVIOUS course to also be in this group
        // The previous course had the actual credit value but should be part of the group
        if (isMergedWithPrevious && importedCourses.length > 0) {
          const prevCourse = importedCourses[importedCourses.length - 1];
          // Only update if it's from the same semester and doesn't already have a group
          if (prevCourse.semester === currentSemester && !prevCourse.course_group) {
            prevCourse.course_group = currentCourseGroup;
            groupCourseNames.push(prevCourse.course_name);
          }
        }
      }
      groupCourseNames.push(courseName);
      
      // Add this course to the group
      importedCourses.push({
        course_code: courseCode,
        course_name: courseName,
        credit_hour: credit,
        semester: currentSemester,
        course_type: courseType,
        course_group: currentCourseGroup,
        prerequisite_code: prerequisiteCode,
      });
    } else {
      // This course has its own credit value, so it's not part of a merged group
      // Reset group tracking
      currentCourseGroup = null;
      groupCourseNames = [];
      
      // Update tracking for next potential group
      lastCredit = credit;
      lastStatus = status;
      lastPrereq = prereq || "";
      
      importedCourses.push({
        course_code: courseCode,
        course_name: courseName,
        credit_hour: credit,
        semester: currentSemester,
        course_type: courseType,
        course_group: null,
        prerequisite_code: prerequisiteCode,
      });
    }
  }

  if (importedCourses.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "No valid courses found in the Excel file. Make sure the file has proper headers (Course Code, Course Name, Credit, Status, Pre-Req) and semester sections.",
    });
  }

  // Get existing courses from database
  const [existingCoursesRows] = await pool.query(
    `SELECT id, course_code FROM courses`,
  );
  const existingCourses = new Map<string, number>();
  for (const course of existingCoursesRows as any[]) {
    existingCourses.set(course.course_code.toLowerCase(), course.id);
  }

  // Get courses already in this session's structure
  const [existingStructureRows] = await pool.query(
    `SELECT course_id FROM program_courses WHERE session_id = ?`,
    [sessionId],
  );
  const existingInSession = new Set<number>();
  for (const row of existingStructureRows as any[]) {
    existingInSession.add(row.course_id);
  }

  // Process imports
  const results: ImportResult[] = [];
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // First pass: create missing courses
    for (const course of importedCourses) {
      const codeKey = course.course_code.toLowerCase();
      
      if (!existingCourses.has(codeKey)) {
        // Create new course
        const [insertResult] = await connection.query(
          `INSERT INTO courses (course_code, course_name, credit_hour) VALUES (?, ?, ?)`,
          [course.course_code, course.course_name, course.credit_hour],
        );
        const newCourseId = (insertResult as any).insertId;
        existingCourses.set(codeKey, newCourseId);
      }
    }

    // Second pass: add to program structure
    for (const course of importedCourses) {
      const codeKey = course.course_code.toLowerCase();
      const courseId = existingCourses.get(codeKey)!;

      // Skip if already in session
      if (existingInSession.has(courseId)) {
        results.push({
          course_code: course.course_code,
          course_name: course.course_name,
          semester: course.semester,
          status: "existing",
          course_id: courseId,
        });
        continue;
      }

      // Resolve prerequisite
      let prerequisiteCourseId: number | null = null;
      if (course.prerequisite_code) {
        const prereqId = existingCourses.get(course.prerequisite_code.toLowerCase());
        if (prereqId) {
          prerequisiteCourseId = prereqId;
        }
      }

      // Insert into program_courses
      await connection.query(
        `INSERT INTO program_courses (session_id, course_id, semester, course_type, course_group, prerequisite_course_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, courseId, course.semester, course.course_type, course.course_group, prerequisiteCourseId],
      );

      existingInSession.add(courseId);
      
      results.push({
        course_code: course.course_code,
        course_name: course.course_name,
        semester: course.semester,
        status: existingCourses.has(codeKey) ? "added" : "created",
        course_id: courseId,
      });
    }

    await connection.commit();
  } catch (error: any) {
    await connection.rollback();
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to import courses: ${error.message}`,
    });
  } finally {
    connection.release();
  }

  const created = results.filter(r => r.status === "created").length;
  const added = results.filter(r => r.status === "added").length;
  const existing = results.filter(r => r.status === "existing").length;

  return {
    success: true,
    summary: {
      total_processed: importedCourses.length,
      courses_created: created,
      courses_added: added,
      already_exists: existing,
      failed: failedImports.length,
    },
    results,
    failed: failedImports,
  };
});
