import { pool } from "~~/server/utils/db";

export interface AcademicPlanSemesterConfigInput {
  semester_number: number;
  semester_type: "L" | "S";
  is_li: boolean;
  target_credits: number;
}

let ensureTablePromise: Promise<void> | null = null;

export const ensureAcademicPlanSemesterConfigsTable = async () => {
  if (!ensureTablePromise) {
    ensureTablePromise = pool
      .query(`
        CREATE TABLE IF NOT EXISTS academic_plan_semester_configs (
          academic_plan_id INT NOT NULL,
          semester_number INT NOT NULL,
          semester_type ENUM('L', 'S') NOT NULL,
          is_li BOOLEAN NOT NULL DEFAULT FALSE,
          target_credits INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

          PRIMARY KEY (academic_plan_id, semester_number),
          CONSTRAINT fk_apsc_plan
            FOREIGN KEY (academic_plan_id) REFERENCES academic_plans(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
      .then(() => undefined)
      .catch((error) => {
        ensureTablePromise = null;
        throw error;
      });
  }

  await ensureTablePromise;
};

export const getAcademicPlanSemesterConfigs = async (academicPlanId: number) => {
  await ensureAcademicPlanSemesterConfigsTable();

  const [rows] = await pool.query(
    `SELECT semester_number, semester_type, is_li, target_credits
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
  }));
};

export const replaceAcademicPlanSemesterConfigs = async (
  academicPlanId: number,
  configs: AcademicPlanSemesterConfigInput[],
) => {
  await ensureAcademicPlanSemesterConfigsTable();

  await pool.query(
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
  ]);

  await pool.query(
    `INSERT INTO academic_plan_semester_configs (
      academic_plan_id,
      semester_number,
      semester_type,
      is_li,
      target_credits
    ) VALUES ?`,
    [values],
  );
};
