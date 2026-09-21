const assert = require("node:assert/strict");
const test = require("node:test");

const {
  migrateDocumentTable,
} = require("./run-document-number-migration");

function createMigrationConnection() {
  const state = {
    columns: new Set([
      "id",
      "numero_progressivo",
      "numero",
      "stato",
      "data_documento",
    ]),
    indexes: new Map([
      ["PRIMARY", ["id"]],
      ["uk_fatture_progressivo", ["numero_progressivo"]],
      ["uk_fatture_numero", ["numero"]],
    ]),
    alters: [],
  };

  return {
    state,
    async execute(sql) {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) {
        return [[{ present: 1 }]];
      }
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
        return [[...state.columns].map((COLUMN_NAME) => ({ COLUMN_NAME }))];
      }
      if (sql.includes("INFORMATION_SCHEMA.STATISTICS")) {
        const rows = [];
        for (const [INDEX_NAME, columns] of state.indexes) {
          columns.forEach((COLUMN_NAME, index) => {
            rows.push({ INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX: index + 1 });
          });
        }
        return [rows];
      }
      throw new Error(`Unexpected execute: ${sql}`);
    },
    async query(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      state.alters.push(normalized);

      const addColumn = normalized.match(/ADD COLUMN `([^`]+)`/i);
      if (addColumn) {
        state.columns.add(addColumn[1]);
        return [{}];
      }

      const addIndex = normalized.match(/ADD UNIQUE KEY `([^`]+)`/i);
      if (addIndex) {
        state.indexes.set(
          addIndex[1],
          addIndex[1].endsWith("_numero_attivo")
            ? ["anno_progressivo_attivo", "numero_documento_attivo"]
            : ["anno_progressivo_attivo", "numero_progressivo_attivo"]
        );
        return [{}];
      }

      const dropIndex = normalized.match(/DROP INDEX `([^`]+)`/i);
      if (dropIndex) {
        state.indexes.delete(dropIndex[1]);
        return [{}];
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("replaces the global document number constraint with an active yearly constraint", async () => {
  const connection = createMigrationConnection();

  const result = await migrateDocumentTable(connection, {
    table: "fatture",
    dateColumn: "data_documento",
  });

  assert.deepEqual(result.removedLegacyIndexes, [
    "uk_fatture_progressivo",
    "uk_fatture_numero",
  ]);
  assert.equal(connection.state.columns.has("numero_progressivo_attivo"), true);
  assert.equal(connection.state.columns.has("anno_progressivo_attivo"), true);
  assert.equal(connection.state.columns.has("numero_documento_attivo"), true);
  assert.deepEqual(
    connection.state.indexes.get("uk_fatture_progressivo_attivo"),
    ["anno_progressivo_attivo", "numero_progressivo_attivo"]
  );
  assert.equal(connection.state.indexes.has("uk_fatture_progressivo"), false);
  assert.deepEqual(
    connection.state.indexes.get("uk_fatture_numero_attivo"),
    ["anno_progressivo_attivo", "numero_documento_attivo"]
  );
  assert.equal(connection.state.indexes.has("uk_fatture_numero"), false);
  assert.equal(
    connection.state.alters.some(
      (sql) =>
        sql.includes("stato` = 'ANNULLATA'") &&
        sql.includes("ELSE `numero_progressivo`")
    ),
    true
  );
});

test("document number migration is idempotent", async () => {
  const connection = createMigrationConnection();
  const config = { table: "fatture", dateColumn: "data_documento" };

  await migrateDocumentTable(connection, config);
  connection.state.alters = [];
  await migrateDocumentTable(connection, config);

  assert.deepEqual(connection.state.alters, []);
});
