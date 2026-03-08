import { auth } from "@@/utils/auth";
import { readMultipartFormData } from "h3";
import { pool } from "../../../utils/db";

/**
 * Parse course grades from result slip HTML table cells.
 * The UTPM result slip HTML has a table where course rows appear as groups of 6 cells:
 * [No, Subject Code, Subject Name, Cdt Hour, Grade, Status]
 * Header row: "No.", "Subject Code", "Subject Name", "Cdt Hour", "Grade", "Status"
 */
function parseGradesFromHTML(
  html: string,
): { code: string; grade: string; status: string }[] {
  // Extract all <td> cell contents, strip HTML tags
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const cells: string[] = [];
  let match;
  while ((match = tdRegex.exec(html)) !== null) {
    cells.push(
      match[1]
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .trim(),
    );
  }

  // Find the header row: look for "Subject Code" cell
  let headerIdx = -1;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === "Subject Code") {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) return [];

  // The header row starts at (headerIdx - 1) for "No."
  // Course data rows start after the 6-cell header row
  const dataStart = headerIdx - 1 + 6; // skip: No., Subject Code, Subject Name, Cdt Hour, Grade, Status

  const results: { code: string; grade: string; status: string }[] = [];

  for (let i = dataStart; i + 5 < cells.length; i += 6) {
    const no = cells[i];
    const code = cells[i + 1];
    const grade = cells[i + 4];
    const status = cells[i + 5];

    // Stop when we hit a non-numeric "No." cell (end of course rows)
    if (!no || !/^\d+$/.test(no)) break;
    // Validate course code looks like a code (alphanumeric, 4+ chars)
    if (!code || code.length < 4) break;

    results.push({ code, grade, status });
  }

  return results;
}

/**
 * Parse course grades from plain text (real PDF text extraction).
 */
function parseGradesFromText(text: string): { code: string; grade: string }[] {
  const results: { code: string; grade: string }[] = [];
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Match lines containing a course code pattern (3 letters + 4 digits)
    const codeMatch = line.match(/\b([A-Z]{2,4}\d{4})\b/i);
    if (!codeMatch) continue;

    const code = codeMatch[1].toUpperCase();

    // Try to extract grade from after the course code
    const afterCode = line.substring(
      line.toUpperCase().indexOf(code) + code.length,
    );
    const parts = afterCode
      .split(/\s{2,}|\t+/)
      .map((p) => p.trim())
      .filter(Boolean);

    let grade = "";
    // Look for grade after credit hour
    for (let i = 0; i < parts.length; i++) {
      if (/^[1-6]$/.test(parts[i]) && i + 1 < parts.length) {
        const g = parts[i + 1];
        if (/^[A-Da-d][+\-]?$/.test(g) || /^F$/i.test(g)) {
          grade = g.toUpperCase();
          break;
        }
      }
    }

    // Fallback regex
    if (!grade) {
      const gradeMatches = afterCode.match(/\b([A-D][+\-]?|F)\b/gi);
      if (gradeMatches && gradeMatches.length > 0) {
        grade = gradeMatches[0].toUpperCase();
      }
    }

    if (grade) {
      results.push({ code, grade });
    }
  }

  return results;
}

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "STUDENT") {
    throw createError({ statusCode: 403, statusMessage: "Student only" });
  }

  // Get student record
  const [studentRows] = await pool.query(
    `SELECT s.id, s.matric_no FROM students s WHERE s.user_id = ?`,
    [session.user.id],
  );

  const student = (studentRows as any[])[0];
  if (!student) {
    throw createError({
      statusCode: 404,
      statusMessage: "Student profile not found",
    });
  }

  // Get latest academic plan
  const [planRows] = await pool.query(
    `SELECT id FROM academic_plans WHERE student_id = ? ORDER BY created_at DESC LIMIT 1`,
    [student.id],
  );

  const plan = (planRows as any[])[0];
  if (!plan) {
    throw createError({
      statusCode: 400,
      statusMessage: "No academic plan found",
    });
  }

  // Parse multipart form data
  const formData = await readMultipartFormData(event);
  if (!formData) {
    throw createError({
      statusCode: 400,
      statusMessage: "No form data received",
    });
  }

  const fileField = formData.find((f) => f.name === "result_slip");
  const semesterField = formData.find((f) => f.name === "semester");

  if (!fileField || !semesterField) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields: result_slip, semester",
    });
  }

  const semester = parseInt(semesterField.data.toString(), 10);
  if (isNaN(semester) || semester < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid semester number",
    });
  }

  const filename = fileField.filename || "result_slip";
  const ext = filename.split(".").pop()?.toLowerCase();

  // Only parse PDF files (which may actually be HTML saved as .pdf)
  if (ext !== "pdf") {
    return {
      parsed: false,
      reason:
        "Auto-parsing is only supported for PDF files. Please mark results manually.",
      results: [],
    };
  }

  // Get courses for this semester from the academic plan
  const [planCourses] = await pool.query(
    `SELECT apd.course_id, c.course_code, c.course_name
     FROM academic_plan_details apd
     JOIN courses c ON c.id = apd.course_id
     WHERE apd.academic_plan_id = ? AND apd.semester = ? AND apd.status != 'Transferred'`,
    [plan.id, semester],
  );

  const courses = planCourses as {
    course_id: number;
    course_code: string;
    course_name: string;
  }[];

  // Detect if file is HTML (UTPM result slips are HTML saved as .pdf) or actual PDF
  const fileContent = fileField.data.toString("utf-8");
  const isHTML =
    fileContent.trimStart().startsWith("<!") ||
    fileContent.trimStart().startsWith("<html") ||
    fileContent.includes("<table");

  let parsedGrades: { code: string; grade: string }[] = [];

  if (isHTML) {
    // Parse HTML table structure
    const htmlGrades = parseGradesFromHTML(fileContent);
    parsedGrades = htmlGrades.map((g) => ({
      code: g.code,
      grade: g.grade,
    }));
  } else {
    // Try real PDF parsing
    try {
      const { PDFParse } = await import("pdf-parse");
      const pdfBuffer = fileField.data;
      const parser = new PDFParse({
        data: new Uint8Array(
          pdfBuffer.buffer,
          pdfBuffer.byteOffset,
          pdfBuffer.byteLength,
        ),
      });
      const textResult = await parser.getText();
      const pdfText = textResult.text || "";
      await parser.destroy();

      if (!pdfText.trim()) {
        return {
          parsed: false,
          reason:
            "PDF has no readable text (may be a scanned image). Please mark results manually.",
          results: [],
        };
      }

      parsedGrades = parseGradesFromText(pdfText);
    } catch (error: any) {
      return {
        parsed: false,
        reason: "Could not read PDF. Please mark results manually.",
        results: [],
      };
    }
  }

  if (parsedGrades.length === 0) {
    return {
      parsed: false,
      reason:
        "Could not extract any grades from the file. Please mark results manually.",
      results: [],
    };
  }

  // Match parsed grades against the student's planned courses
  const failGrades = new Set(["F"]);
  const results: {
    course_id: number;
    course_code: string;
    grade: string;
    status: "Passed" | "Failed";
  }[] = [];
  const unmatched: string[] = [];

  for (const course of courses) {
    const match = parsedGrades.find(
      (g) => g.code.toUpperCase() === course.course_code.toUpperCase(),
    );
    if (match) {
      results.push({
        course_id: course.course_id,
        course_code: course.course_code,
        grade: match.grade,
        status: failGrades.has(match.grade) ? "Failed" : "Passed",
      });
    } else {
      unmatched.push(course.course_code);
    }
  }

  return {
    parsed: true,
    results,
    unmatched,
    total_courses: courses.length,
    matched_count: results.length,
  };
});
