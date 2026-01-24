import { pool } from "~~/server/utils/db";
import { auth } from "~~/utils/auth";

export default defineEventHandler(async (event) => {
  // Authenticate user
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
  }

  // Get query params for search
  const query = getQuery(event);
  const search = (query.search as string) || "";

  // Get all courses, optionally filtered by search
  let sql = `SELECT id, course_code, course_name, credit_hour FROM courses`;
  const params: any[] = [];

  if (search) {
    sql += ` WHERE course_code LIKE ? OR course_name LIKE ?`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY course_code ASC`;

  const [rows] = await pool.query(sql, params);

  return rows;
});
