import { pool } from "~~/server/utils/db";
import { addColumnIfMissing } from "~~/server/utils/mysql-schema";

export interface AcademicPlanSemesterConfigInput {
  semester_number: number;
  semester_type: "L" | "S";
  is_li: boolean;
  target_credits: number;
  is_credit_exception: boolean;
  credit_exception_reason: string | null;
}

let ensureTablePromise: Promise<void> | null = null;

type QueryExecutor = {
  query: (sql: string, values?: any) => Promise<any>;
};

export const ensureAcademicPlanSemesterConfigsTable = async () => {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS academic_plan_semester_configs (
          academic_plan_id INT NOT NULL,
          semester_number INT NOT NULL,
          semester_type ENUM('L', 'S') NOT NULL,
          is_li BOOLEAN NOT NULL DEFAULT FALSE,
          target_credits INT NOT NULL DEFAULT 0,
          is_credit_exception BOOLEAN NOT NULL DEFAULT FALSE,
          credit_exception_reason TEXT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

          PRIMARY KEY (academic_plan_id, semester_number),
          CONSTRAINT fk_apsc_plan
            FOREIGN KEY (academic_plan_id) REFERENCES academic_plans(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await addColumnIfMissing({
        tableName: "academic_plan_semester_configs",
        columnName: "is_credit_exception",
        columnDefinition: "BOOLEAN NOT NULL DEFAULT FALSE",
      });
      await addColumnIfMissing({
        tableName: "academic_plan_semester_configs",
        columnName: "credit_exception_reason",
        columnDefinition: "TEXT NULL",
      });
    })().catch((error) => {
        ensureTablePromise = null;
        throw error;
      });
  }

  await ensureTablePromise;
};

export const getAcademicPlanSemesterConfigs = async (
  academicPlanId: number,
  executor: QueryExecutor = pool,
) => {
  await ensureAcademicPlanSemesterConfigsTable();

  const [rows] = await executor.query(
    `SELECT semester_number,
            semester_type,
            is_li,
            target_credits,
            is_credit_exception,
            credit_exception_reason
     FROM academic_plan_semester_configs
     WHERE academic_plan_id = ?
     ORDER BY semester_number ASC`,
    [academicPlanId],
  );

  return (rows as any[]).map((row) => ({
    semester_number: Number(row.semester_number),
    semester_type: row.semester_type as "L" | "S",
    is_li: !!row.is_li,
    target_credits: Number(row.target_credits),
    is_credit_exception: !!row.is_credit_exception,
    credit_exception_reason: row.credit_exception_reason ?? null,
  }));
};

export const replaceAcademicPlanSemesterConfigs = async (
  academicPlanId: number,
  configs: AcademicPlanSemesterConfigInput[],
  executor: QueryExecutor = pool,
) => {
  await ensureAcademicPlanSemesterConfigsTable();

  await executor.query(
    `DELETE FROM academic_plan_semester_configs WHERE academic_plan_id = ?`,
    [academicPlanId],
  );

  if (configs.length === 0) {
    return;
  }

  const values = configs.map((config) => [
    academicPlanId,
    config.semester_number,
    config.semester_type,
    config.is_li ? 1 : 0,
    config.target_credits,
    config.is_credit_exception ? 1 : 0,
    config.credit_exception_reason,
  ]);

  await executor.query(
    `INSERT INTO academic_plan_semester_configs (
      academic_plan_id,
      semester_number,
      semester_type,
      is_li,
      target_credits,
      is_credit_exception,
      credit_exception_reason
    ) VALUES ?`,
    [values],
  );
};
