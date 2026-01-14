import { pool } from "../utils/db";

export const findStudentByMatricAndProgram = async (
  matricNo: string,
  programId: number
) => {
  const [rows]: any = await pool.query(
    `
    SELECT *
    FROM students
    WHERE matric_no = ?
      AND program_id = ?
    `,
    [matricNo, programId]
  );

  return rows[0] || null;
};

export const updateCreditTransfer = async (
  studentId: number,
  intakeYear: string,
  totalCredit: number
) => {
  await pool.query(
    `
    UPDATE students
    SET
      intake_year = ?,
      total_credit_transferred = ?
    WHERE id = ?
    `,
    [intakeYear, totalCredit, studentId]
  );
};
