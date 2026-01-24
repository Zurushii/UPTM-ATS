import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";

interface CourseInput {
  course_code: string;
  course_name: string;
  credit_hour: number;
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

  const body = await readBody<CourseInput>(event);

  if (!body.course_code || body.course_code.trim().length < 3) {
    throw createError({
      statusCode: 400,
      statusMessage: "Course code is required",
    });
  }

  if (!body.course_name || body.course_name.trim().length < 3) {
    throw createError({
      statusCode: 400,
      statusMessage: "Course name is required",
    });
  }

  if (body.credit_hour === undefined || Number.isNaN(body.credit_hour)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Credit hour is required",
    });
  }

  if (body.credit_hour <= 0 || body.credit_hour > 30) {
    throw createError({
      statusCode: 400,
      statusMessage: "Credit hour must be between 1 and 30",
    });
  }

  const courseCode = body.course_code.trim().toUpperCase();
  const courseName = body.course_name.trim();

  // Enforce uniqueness (also backed by UNIQUE index)
  const [existingRows] = await pool.query(
    `SELECT id FROM courses WHERE course_code = ?`,
    [courseCode],
  );

  if ((existingRows as any[]).length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: "Course code already exists",
    });
  }

  const [result] = await pool.query(
    `INSERT INTO courses (course_code, course_name, credit_hour)
     VALUES (?, ?, ?)`,
    [courseCode, courseName, body.credit_hour],
  );

  return {
    success: true,
    id: (result as any).insertId,
    course_code: courseCode,
    course_name: courseName,
    credit_hour: body.credit_hour,
  };
});
