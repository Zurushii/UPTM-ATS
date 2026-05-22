import { pool } from "~~/server/utils/db";

type QueryExecutor = {
  query: (sql: string, values?: any) => Promise<any>;
};

const escapeIdentifier = (value: string) => `\`${String(value).replace(/`/g, "``")}\``;

export const hasIndex = async ({
  tableName,
  indexName,
  executor = pool,
}: {
  tableName: string;
  indexName: string;
  executor?: QueryExecutor;
}) => {
  const [rows] = await executor.query(
    `SELECT 1
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName],
  );

  return (rows as any[]).length > 0;
};

export const hasColumn = async ({
  tableName,
  columnName,
  executor = pool,
}: {
  tableName: string;
  columnName: string;
  executor?: QueryExecutor;
}) => {
  const [rows] = await executor.query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName],
  );

  return (rows as any[]).length > 0;
};

export const addColumnIfMissing = async ({
  tableName,
  columnName,
  columnDefinition,
  executor = pool,
}: {
  tableName: string;
  columnName: string;
  columnDefinition: string;
  executor?: QueryExecutor;
}) => {
  if (
    await hasColumn({
      tableName,
      columnName,
      executor,
    })
  ) {
    return false;
  }

  try {
    await executor.query(
      `ALTER TABLE ${escapeIdentifier(tableName)}
       ADD COLUMN ${escapeIdentifier(columnName)} ${columnDefinition}`,
    );
    return true;
  } catch (error: any) {
    if (error?.code === "ER_DUP_FIELDNAME") {
      return false;
    }

    throw error;
  }
};

export const dropIndexIfExists = async ({
  tableName,
  indexName,
  executor = pool,
}: {
  tableName: string;
  indexName: string;
  executor?: QueryExecutor;
}) => {
  if (
    !(await hasIndex({
      tableName,
      indexName,
      executor,
    }))
  ) {
    return false;
  }

  try {
    await executor.query(
      `ALTER TABLE ${escapeIdentifier(tableName)}
       DROP INDEX ${escapeIdentifier(indexName)}`,
    );
    return true;
  } catch (error: any) {
    if (error?.code === "ER_CANT_DROP_FIELD_OR_KEY") {
      return false;
    }

    throw error;
  }
};

export const addIndexIfMissing = async ({
  tableName,
  indexName,
  columns,
  unique = false,
  executor = pool,
}: {
  tableName: string;
  indexName: string;
  columns: string[];
  unique?: boolean;
  executor?: QueryExecutor;
}) => {
  if (
    await hasIndex({
      tableName,
      indexName,
      executor,
    })
  ) {
    return false;
  }

  const serializedColumns = columns
    .map((columnName) => escapeIdentifier(columnName))
    .join(", ");

  try {
    await executor.query(
      `ALTER TABLE ${escapeIdentifier(tableName)}
       ADD ${unique ? "UNIQUE " : ""}INDEX ${escapeIdentifier(indexName)} (${serializedColumns})`,
    );
    return true;
  } catch (error: any) {
    if (error?.code === "ER_DUP_KEYNAME") {
      return false;
    }

    throw error;
  }
};
