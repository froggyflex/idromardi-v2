const test = require("node:test");
const assert = require("node:assert/strict");
const { getNextDocumentNumber } = require("./financialSummary.service");

function createConnection({ currentValue, issuedMax }) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, params });

      if (normalized.startsWith("INSERT IGNORE INTO document_number_counters")) {
        return [{ affectedRows: 0 }];
      }
      if (normalized.includes("SELECT id, current_value FROM document_number_counters")) {
        return [[{ id: "counter-1", current_value: currentValue }]];
      }
      if (normalized.includes("SELECT COALESCE(MAX(numero_progressivo), 0) AS max_value FROM fatture")) {
        return [[{ max_value: issuedMax }]];
      }
      if (normalized.startsWith("UPDATE document_number_counters")) {
        return [{ affectedRows: 1 }];
      }

      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
}

test("an edited yearly invoice counter is used for the next document", async () => {
  const conn = createConnection({ currentValue: 42, issuedMax: 17 });
  const result = await getNextDocumentNumber(
    conn,
    "FATTURA",
    2026,
    "Via Roma 1"
  );

  assert.equal(result.progressivo, 43);
  assert.match(result.numero, /^FT-000043-/);

  const issuedQuery = conn.calls.find((call) =>
    call.sql.includes("FROM fatture WHERE data_documento >= ?")
  );
  assert.deepEqual(issuedQuery.params, ["2026-01-01", "2027-01-01"]);
  assert.equal(
    conn.calls.some((call) =>
      call.sql.includes("MAX(current_value)")
    ),
    false
  );
});

test("the highest number already issued in the same year remains a safety floor", async () => {
  const conn = createConnection({ currentValue: 10, issuedMax: 17 });
  const result = await getNextDocumentNumber(conn, "FATTURA", 2026);

  assert.equal(result.progressivo, 18);
  const update = conn.calls.find((call) =>
    call.sql.startsWith("UPDATE document_number_counters")
  );
  assert.equal(update.params[0], 18);
});
