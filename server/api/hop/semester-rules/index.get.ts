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

  // Get query param for filtering by intake
  const query = getQuery(event);
  const intakeFilter = query.intake_year as string | undefined;

  // Build query
  let sql = `
    SELECT id, intake_year, min_credit, max_credit, entry_semester
    FROM semester_entry_rules
    WHERE program_id = ?
  `;
  const params: any[] = [programId];

  if (intakeFilter) {
    sql += ` AND intake_year = ?`;
    params.push(intakeFilter);
  }

  sql += ` ORDER BY intake_year DESC, min_credit ASC`;

  const [rows] = await pool.query(sql, params);

  return rows;
});
