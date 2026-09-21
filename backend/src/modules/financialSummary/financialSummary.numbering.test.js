const test = require("node:test");
const assert = require("node:assert/strict");
const { getNextDocumentNumber } = require("./financialSummary.service");

function createConnection({ currentValue, conflict = null, duplicateRows = [] }) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, params });

      if (
        normalized.includes("SELECT id, current_value, created_at, updated_at") &&
        normalized.includes("FROM document_number_counters")
      ) {
        return [[
          {
            id: "counter-1",
            current_value: currentValue,
            created_at: "2026-01-01",
            updated_at: "2026-09-21",
          },
          ...duplicateRows,
        ]];
      }
      if (
        normalized.includes("FROM fatture") &&
        normalized.includes("numero_progressivo = ?")
      ) {
        return [conflict ? [conflict] : []];
      }
      if (normalized.startsWith("UPDATE document_number_counters")) {
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("DELETE FROM document_number_counters")) {
        return [{ affectedRows: duplicateRows.length }];
      }

      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
}

test("an edited yearly invoice counter is authoritative", async () => {
  const conn = createConnection({ currentValue: 1351 });
  const result = await getNextDocumentNumber(
    conn,
    "FATTURA",
    2026,
    "Via Roma 1"
  );

  assert.equal(result.progressivo, 1352);
  assert.match(result.numero, /^FT-001352-/);

  const collisionQuery = conn.calls.find((call) =>
    call.sql.includes("numero_progressivo = ?")
  );
  assert.deepEqual(collisionQuery.params, ["2026-01-01", "2027-01-01", 1352]);
});

test("an exact collision is reported instead of silently skipping numbers", async () => {
  const conn = createConnection({
    currentValue: 1351,
    conflict: {
      id: "invoice-1352",
      numero: "FT-001352-VIA-ROMA",
      numero_progressivo: 1352,
      document_date: "2026-09-20",
      stato: "EMESSA",
    },
  });

  await assert.rejects(
    () => getNextDocumentNumber(conn, "FATTURA", 2026),
    (error) =>
      error.code === "DOCUMENT_NUMBER_ALREADY_USED" &&
      error.conflict.progressivo === 1352
  );
  assert.equal(
    conn.calls.some((call) => call.sql.startsWith("UPDATE document_number_counters")),
    false
  );
});

test("duplicate counter rows are consolidated before incrementing", async () => {
  const conn = createConnection({
    currentValue: 20,
    duplicateRows: [
      {
        id: "counter-old",
        current_value: 99,
        created_at: "2025-01-01",
        updated_at: "2025-01-01",
      },
    ],
  });

  const result = await getNextDocumentNumber(conn, "FATTURA", 2026);

  assert.equal(result.progressivo, 21);
  const deletion = conn.calls.find((call) =>
    call.sql.startsWith("DELETE FROM document_number_counters")
  );
  assert.deepEqual(deletion.params, ["counter-old"]);
});
