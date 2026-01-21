import { pool } from "../utils/db";

export default defineEventHandler(async () => {
  const [rows] = await pool.query(
    "SELECT id, program_name FROM programs ORDER BY program_name",
  );
  return rows;
});
