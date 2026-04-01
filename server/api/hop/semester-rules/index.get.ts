import { pool } from "~~/server/utils/db";
import { ensureSemesterOneRulePlansBackfilled } from "~~/server/utils/semester-rule-plans";
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

  await ensureSemesterOneRulePlansBackfilled(programId);

  // Get query param for filtering by intake type
  const query = getQuery(event);
  const intakeFilter = query.intake_type as string | undefined;

  // Build query
  let sql = `
    SELECT id, intake_type, credit_transfer, entry_semester
    FROM semester_entry_rules
    WHERE program_id = ?
  `;
  const params: any[] = [programId];

  if (intakeFilter) {
    sql += ` AND intake_type = ?`;
    params.push(intakeFilter);
  }

  sql += ` ORDER BY intake_type ASC, credit_transfer DESC`;

  const [rows] = await pool.query(sql, params);

  return rows;
});
