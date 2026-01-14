import {
  findStudentByMatricAndProgram,
  updateCreditTransfer,
} from "../repositories/student.repository";
import { pool } from "../utils/db";

const INTAKE_REGEX = /^(05|08|12)\d{2}$/;

export const processBulkCreditTransfer = async (
  programId: number,
  records: {
    matric_no: string;
    intake_year: string;
    total_credit_transferred: number;
  }[]
) => {
  const results: any[] = [];

  // Get program credit limit
  const [programRows]: any = await pool.query(
    `SELECT total_credit_required FROM programs WHERE id = ?`,
    [programId]
  );

  const maxCredit = programRows[0]?.total_credit_required;

  for (const record of records) {
    const { matric_no, intake_year, total_credit_transferred } = record;

    // Validation
    if (!INTAKE_REGEX.test(intake_year)) {
      results.push({
        matric_no,
        status: "failed",
        reason: "Invalid intake format",
      });
      continue;
    }

    if (total_credit_transferred < 0 || total_credit_transferred > maxCredit) {
      results.push({
        matric_no,
        status: "failed",
        reason: "Invalid credit amount",
      });
      continue;
    }

    const student = await findStudentByMatricAndProgram(matric_no, programId);

    if (!student) {
      results.push({
        matric_no,
        status: "failed",
        reason: "Student not found under this program",
      });
      continue;
    }

    // OVERWRITE (LOCKED BEHAVIOR)
    await updateCreditTransfer(
      student.id,
      intake_year,
      total_credit_transferred
    );

    results.push({
      matric_no,
      status: "success",
    });
  }

  return {
    summary: {
      total_records: records.length,
      success: results.filter((r) => r.status === "success").length,
      failed: results.filter((r) => r.status === "failed").length,
    },
    results,
  };
};
