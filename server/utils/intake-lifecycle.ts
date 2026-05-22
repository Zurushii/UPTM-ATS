import { pool } from "~~/server/utils/db";

export type IntakeLifecycleSemesterType = "L" | "S";
export type IntakeLifecyclePattern = [
  IntakeLifecycleSemesterType,
  IntakeLifecycleSemesterType,
  IntakeLifecycleSemesterType,
];

type QueryExecutor = {
  query: (sql: string, values?: any) => Promise<any>;
};

export interface ProgramIntakeLifecycleConfig {
  program_id: number;
  intake_type: string;
  lifecycle_pattern: IntakeLifecyclePattern;
  source: "configured" | "default";
}

let ensureIntakeLifecycleTablePromise: Promise<void> | null = null;

const normalizeLifecycleValue = (
  value: unknown,
): IntakeLifecycleSemesterType => (String(value || "").trim().toUpperCase() === "S" ? "S" : "L");

export const getDefaultIntakeLifecyclePattern = (
  intakeType?: string | null,
): IntakeLifecyclePattern => {
  const rawIntake = intakeType?.toLowerCase() || "";

  if (rawIntake.includes("may")) {
    return ["S", "L", "L"];
  }

  if (rawIntake.includes("aug")) {
    return ["L", "L", "S"];
  }

  if (rawIntake.includes("dec")) {
    return ["L", "S", "L"];
  }

  return ["L", "L", "S"];
};

export const normalizeIntakeLifecyclePattern = (
  pattern: unknown,
  fallbackIntakeType?: string | null,
): IntakeLifecyclePattern => {
  const fallback = getDefaultIntakeLifecyclePattern(fallbackIntakeType);

  if (!Array.isArray(pattern) || pattern.length === 0) {
    return fallback;
  }

  const normalized = pattern.map((value) => normalizeLifecycleValue(value));
  const completed = [
    normalized[0] || fallback[0],
    normalized[1] || fallback[1],
    normalized[2] || fallback[2],
  ] as IntakeLifecyclePattern;

  return completed;
};

export const formatIntakeLifecyclePattern = (
  pattern: IntakeLifecyclePattern,
) => pattern.map((value) => (value === "L" ? "Long" : "Short")).join(" -> ");

export const ensureProgramIntakeLifecyclesTable = async () => {
  if (!ensureIntakeLifecycleTablePromise) {
    ensureIntakeLifecycleTablePromise = pool
      .query(`
        CREATE TABLE IF NOT EXISTS program_intake_lifecycles (
          id INT AUTO_INCREMENT PRIMARY KEY,
          program_id INT NOT NULL,
          intake_type VARCHAR(50) NOT NULL,
          cycle_slot_1 ENUM('L', 'S') NOT NULL DEFAULT 'L',
          cycle_slot_2 ENUM('L', 'S') NOT NULL DEFAULT 'L',
          cycle_slot_3 ENUM('L', 'S') NOT NULL DEFAULT 'S',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

          CONSTRAINT fk_pil_program
            FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,

          UNIQUE KEY unique_program_intake_lifecycle (program_id, intake_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
      .then(() => undefined)
      .catch((error) => {
        ensureIntakeLifecycleTablePromise = null;
        throw error;
      });
  }

  await ensureIntakeLifecycleTablePromise;
};

export const getConfiguredIntakeLifecyclePattern = async ({
  programId,
  intakeType,
  executor = pool,
}: {
  programId: number;
  intakeType?: string | null;
  executor?: QueryExecutor;
}): Promise<IntakeLifecyclePattern | null> => {
  const normalizedIntakeType = String(intakeType || "").trim();
  if (!normalizedIntakeType) {
    return null;
  }

  await ensureProgramIntakeLifecyclesTable();

  const [rows] = await executor.query(
    `SELECT cycle_slot_1, cycle_slot_2, cycle_slot_3
     FROM program_intake_lifecycles
     WHERE program_id = ? AND intake_type = ?
     LIMIT 1`,
    [programId, normalizedIntakeType],
  );

  const row = (rows as any[])[0];
  if (!row) {
    return null;
  }

  return normalizeIntakeLifecyclePattern(
    [row.cycle_slot_1, row.cycle_slot_2, row.cycle_slot_3],
    normalizedIntakeType,
  );
};

export const resolveIntakeLifecyclePattern = async ({
  programId,
  intakeType,
  executor = pool,
}: {
  programId: number;
  intakeType?: string | null;
  executor?: QueryExecutor;
}): Promise<ProgramIntakeLifecycleConfig> => {
  const normalizedIntakeType = String(intakeType || "").trim();
  const configuredPattern = await getConfiguredIntakeLifecyclePattern({
    programId,
    intakeType: normalizedIntakeType,
    executor,
  });

  if (configuredPattern) {
    return {
      program_id: programId,
      intake_type: normalizedIntakeType,
      lifecycle_pattern: configuredPattern,
      source: "configured",
    };
  }

  return {
    program_id: programId,
    intake_type: normalizedIntakeType,
    lifecycle_pattern: getDefaultIntakeLifecyclePattern(normalizedIntakeType),
    source: "default",
  };
};

export const replaceProgramIntakeLifecyclePattern = async ({
  programId,
  intakeType,
  lifecyclePattern,
  executor = pool,
}: {
  programId: number;
  intakeType: string;
  lifecyclePattern: unknown;
  executor?: QueryExecutor;
}) => {
  const normalizedIntakeType = String(intakeType || "").trim();
  if (!normalizedIntakeType) {
    throw new Error("Intake type is required.");
  }

  const normalizedPattern = normalizeIntakeLifecyclePattern(
    lifecyclePattern,
    normalizedIntakeType,
  );

  await ensureProgramIntakeLifecyclesTable();

  await executor.query(
    `INSERT INTO program_intake_lifecycles (
       program_id,
       intake_type,
       cycle_slot_1,
       cycle_slot_2,
       cycle_slot_3
     ) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       cycle_slot_1 = VALUES(cycle_slot_1),
       cycle_slot_2 = VALUES(cycle_slot_2),
       cycle_slot_3 = VALUES(cycle_slot_3)`,
    [
      programId,
      normalizedIntakeType,
      normalizedPattern[0],
      normalizedPattern[1],
      normalizedPattern[2],
    ],
  );

  return normalizedPattern;
};

export const getLifecycleSemesterTypeForSlot = ({
  lifecyclePattern,
  slotOrder,
  slotRole,
}: {
  lifecyclePattern: IntakeLifecyclePattern;
  slotOrder: number;
  slotRole?: string | null;
}): IntakeLifecycleSemesterType => {
  if (slotRole === "li" || slotRole === "fyp2") {
    return "L";
  }

  const normalizedSlotOrder = Math.max(Number(slotOrder) || 1, 1);
  return (
    lifecyclePattern[(normalizedSlotOrder - 1) % lifecyclePattern.length] || "L"
  );
};
