import { processBulkCreditTransfer } from "../../../services/creditTransfer.service";
import { auth } from "@@/utils/auth";
import { pool } from "../../../utils/db";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({
    headers: event.node.req.headers,
  });

  if (!session || session.user.role !== "HOP") {
    throw createError({
      statusCode: 403,
      statusMessage: "Forbidden",
    });
  }

  const body = await readBody(event);

  if (!body?.records || !Array.isArray(body.records)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid request payload",
    });
  }

  // Get HoP program
  const [hopRows]: any = await pool.query(
    `
    SELECT program_id
    FROM head_of_programs
    WHERE user_id = ?
    `,
    [session.user.id]
  );

  if (!hopRows.length) {
    throw createError({
      statusCode: 403,
      statusMessage: "HoP program not found",
    });
  }

  const programId = hopRows[0].program_id;

  const result = await processBulkCreditTransfer(programId, body.records);

  return result;
});