const mysql = require("mysql2/promise");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const DOCUMENT_TABLES = Object.freeze([
  { table: "fatture", dateColumn: "data_documento" },
  { table: "proformas", dateColumn: "data_documento" },
  { table: "payments", dateColumn: "data_pagamento" },
]);

function quoteIdentifier(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Identificatore SQL non valido: ${value}`);
  }
  return `\`${value}\``;
}

async function tableExists(connection, table) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function loadColumns(connection, table) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function loadUniqueIndexes(connection, table) {
  const [rows] = await connection.execute(
    `SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND NON_UNIQUE = 0
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [table]
  );
  const indexes = new Map();
  for (const row of rows) {
    if (!indexes.has(row.INDEX_NAME)) indexes.set(row.INDEX_NAME, []);
    indexes.get(row.INDEX_NAME).push(row.COLUMN_NAME);
  }
  return indexes;
}

async function migrateDocumentTable(connection, { table, dateColumn }) {
  if (!(await tableExists(connection, table))) {
    return { table, skipped: true, reason: "table_missing" };
  }

  const quotedTable = quoteIdentifier(table);
  const quotedDateColumn = quoteIdentifier(dateColumn);
  const activeNumberColumn = "numero_progressivo_attivo";
  const activeYearColumn = "anno_progressivo_attivo";
  const activeCodeColumn = "numero_documento_attivo";
  const activeProgressiveIndex = `uk_${table}_progressivo_attivo`;
  const activeCodeIndex = `uk_${table}_numero_attivo`;
  const requiredColumns = ["numero_progressivo", "numero", "stato", dateColumn];
  const columns = await loadColumns(connection, table);
  const missingRequired = requiredColumns.filter((column) => !columns.has(column));
  if (missingRequired.length) {
    throw new Error(
      `${table}: colonne richieste mancanti (${missingRequired.join(", ")}).`
    );
  }

  if (!columns.has(activeNumberColumn)) {
    await connection.query(
      `ALTER TABLE ${quotedTable}
       ADD COLUMN ${quoteIdentifier(activeNumberColumn)} INT
       GENERATED ALWAYS AS (
         CASE WHEN \`stato\` = 'ANNULLATA' THEN NULL ELSE \`numero_progressivo\` END
       ) STORED`
    );
  }

  if (!columns.has(activeYearColumn)) {
    await connection.query(
      `ALTER TABLE ${quotedTable}
       ADD COLUMN ${quoteIdentifier(activeYearColumn)} SMALLINT
       GENERATED ALWAYS AS (
         CASE WHEN \`stato\` = 'ANNULLATA' THEN NULL ELSE YEAR(${quotedDateColumn}) END
       ) STORED`
    );
  }

  if (!columns.has(activeCodeColumn)) {
    await connection.query(
      `ALTER TABLE ${quotedTable}
       ADD COLUMN ${quoteIdentifier(activeCodeColumn)} VARCHAR(191)
       GENERATED ALWAYS AS (
         CASE WHEN \`stato\` = 'ANNULLATA' THEN NULL ELSE LEFT(\`numero\`, 191) END
       ) STORED`
    );
  }

  let uniqueIndexes = await loadUniqueIndexes(connection, table);
  const expectedProgressiveColumns = [activeYearColumn, activeNumberColumn];
  const currentActiveProgressiveIndex = uniqueIndexes.get(
    activeProgressiveIndex
  );
  if (
    !currentActiveProgressiveIndex ||
    currentActiveProgressiveIndex.join(",") !==
      expectedProgressiveColumns.join(",")
  ) {
    if (currentActiveProgressiveIndex) {
      await connection.query(
        `ALTER TABLE ${quotedTable} DROP INDEX ${quoteIdentifier(
          activeProgressiveIndex
        )}`
      );
    }
    await connection.query(
      `ALTER TABLE ${quotedTable}
       ADD UNIQUE KEY ${quoteIdentifier(activeProgressiveIndex)} (
         ${quoteIdentifier(activeYearColumn)},
         ${quoteIdentifier(activeNumberColumn)}
       )`
    );
  }

  uniqueIndexes = await loadUniqueIndexes(connection, table);
  const expectedCodeColumns = [activeYearColumn, activeCodeColumn];
  const currentActiveCodeIndex = uniqueIndexes.get(activeCodeIndex);
  if (
    !currentActiveCodeIndex ||
    currentActiveCodeIndex.join(",") !== expectedCodeColumns.join(",")
  ) {
    if (currentActiveCodeIndex) {
      await connection.query(
        `ALTER TABLE ${quotedTable} DROP INDEX ${quoteIdentifier(
          activeCodeIndex
        )}`
      );
    }
    await connection.query(
      `ALTER TABLE ${quotedTable}
       ADD UNIQUE KEY ${quoteIdentifier(activeCodeIndex)} (
         ${quoteIdentifier(activeYearColumn)},
         ${quoteIdentifier(activeCodeColumn)}
       )`
    );
  }

  uniqueIndexes = await loadUniqueIndexes(connection, table);
  const legacyIndexes = [...uniqueIndexes.entries()]
    .filter(
      ([indexName, indexColumns]) =>
        indexName !== "PRIMARY" &&
        indexName !== activeProgressiveIndex &&
        indexName !== activeCodeIndex &&
        indexColumns.length === 1 &&
        ["numero_progressivo", "numero"].includes(indexColumns[0])
    )
    .map(([indexName]) => indexName);

  for (const indexName of legacyIndexes) {
    await connection.query(
      `ALTER TABLE ${quotedTable} DROP INDEX ${quoteIdentifier(indexName)}`
    );
  }

  return { table, skipped: false, removedLegacyIndexes: legacyIndexes };
}

async function runDocumentNumberMigration() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  });

  try {
    const [[lock]] = await connection.query(
      "SELECT GET_LOCK(CONCAT(DATABASE(), ':document_number_migration'), 10) AS acquired"
    );
    if (Number(lock.acquired) !== 1) {
      throw new Error("Un'altra migrazione delle numerazioni è già in corso.");
    }

    const results = [];
    for (const config of DOCUMENT_TABLES) {
      results.push(await migrateDocumentTable(connection, config));
    }
    console.log(
      `Document numbering schema ready: ${results
        .filter((result) => !result.skipped)
        .map((result) => result.table)
        .join(", ")}`
    );
    return results;
  } finally {
    await connection
      .query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':document_number_migration'))")
      .catch(() => {});
    await connection.end();
  }
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function runDocumentNumberMigrationWithRetry({
  maxAttempts = Number(process.env.DOCUMENT_NUMBER_MIGRATION_MAX_ATTEMPTS || 5),
  initialDelayMs = Number(
    process.env.DOCUMENT_NUMBER_MIGRATION_RETRY_DELAY_MS || 2000
  ),
  maxDelayMs = 30000,
} = {}) {
  const attempts = Math.max(1, maxAttempts);
  let delayMs = Math.max(0, initialDelayMs);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runDocumentNumberMigration();
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.warn(
        `Document number migration attempt ${attempt}/${attempts} failed: ${
          error?.code || error?.message || "unknown error"
        }. Retrying in ${delayMs}ms.`
      );
      await wait(delayMs);
      delayMs = Math.min(maxDelayMs, Math.max(1000, delayMs * 2));
    }
  }

  return null;
}

if (require.main === module) {
  runDocumentNumberMigration().catch((error) => {
    console.error(error.code || "DOCUMENT_NUMBER_MIGRATION_ERROR", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DOCUMENT_TABLES,
  migrateDocumentTable,
  runDocumentNumberMigration,
  runDocumentNumberMigrationWithRetry,
};
