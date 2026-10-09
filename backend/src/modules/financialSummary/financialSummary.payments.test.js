const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../../config/db");
const service = require("./financialSummary.service");

function mockPaymentConnection(t, { missing = false, failure = null } = {}) {
  const calls = [];
  const payment = { id: "p1", numero: "PG-7", numero_progressivo: 7, importo: 100, data_pagamento: "2026-10-01" };
  const allocations = [1, 2].map((n) => ({ id: `a${n}`, payment_id: "p1", fattura_id: `f${n}`, importo_allocato: 50, data_allocazione: payment.data_pagamento }));
  const conn = {
    async beginTransaction() { calls.push("begin"); },
    async commit() { calls.push("commit"); },
    async rollback() { calls.push("rollback"); },
    release() { calls.push("release"); },
    async query(sql, params) {
      const query = sql.replace(/\s+/g, " ").trim();
      calls.push({ query, params });
      if (query.includes("FOR UPDATE")) return [missing ? [] : [{ id: "p1" }]];
      if (query.startsWith("UPDATE payments")) {
        if (failure === "duplicate") throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
        payment.data_pagamento = params[0];
        return [{ affectedRows: 1 }];
      }
      if (query.startsWith("UPDATE payment_allocations")) {
        if (failure === "allocation") throw new Error("allocation failure");
        allocations.forEach((row) => { row.data_allocazione = params[0]; });
        return [{ affectedRows: allocations.length }];
      }
      if (query.includes("FROM payments")) return [[payment]];
      if (query.includes("FROM payment_allocations")) return [allocations];
      throw new Error(`Unexpected query: ${query}`);
    },
  };
  t.mock.method(db, "getConnection", async () => conn);
  return { calls, payment };
}

test("payment date corrections update all allocation dates atomically without renumbering or changing amounts", async (t) => {
  const { calls } = mockPaymentConnection(t);
  const detail = await service.updatePaymentDate("p1", "2026-10-09");
  assert.equal(detail.data_pagamento, "2026-10-09");
  assert.equal(detail.numero_progressivo, 7);
  assert.equal(detail.importo, 100);
  assert(detail.allocations.every((row) => row.data_allocazione === "2026-10-09" && row.importo_allocato === 50));
  assert.equal(calls[0], "begin");
  assert.deepEqual(calls.slice(-2), ["commit", "release"]);
  assert(!calls.includes("rollback"));
  assert(!calls.some((call) => call.query?.startsWith("UPDATE") && /SET.*(importo|numero)/.test(call.query)));
});

test("invalid calendar dates are rejected before connecting to the database", async (t) => {
  const connect = t.mock.method(db, "getConnection", () => { throw new Error("Unexpected database access"); });
  for (const value of ["", null, "2026-02-29", "2026-04-31", "2026-13-01", "09/10/2026", "2026-10-09T00:00:00Z", "0000-01-01"]) {
    await assert.rejects(service.updatePaymentDate("p1", value), { statusCode: 400 });
  }
  await assert.rejects(service.updatePaymentDate("", "2026-10-09"), { statusCode: 400 });
  assert.equal(connect.mock.callCount(), 0);
});

test("valid leap dates and cross-year corrections are accepted", async (t) => {
  mockPaymentConnection(t);
  assert.equal((await service.updatePaymentDate("p1", "2028-02-29")).data_pagamento, "2028-02-29");
});

test("missing payments do not write anything and release the connection", async (t) => {
  const { calls } = mockPaymentConnection(t, { missing: true });
  assert.equal(await service.updatePaymentDate("missing", "2026-10-09"), null);
  assert.deepEqual(calls.slice(-2), ["rollback", "release"]);
  assert(!calls.some((call) => call.query?.startsWith("UPDATE")));
});

test("allocation update failures roll back the payment correction", async (t) => {
  const { calls } = mockPaymentConnection(t, { failure: "allocation" });
  await assert.rejects(service.updatePaymentDate("p1", "2026-10-09"), /allocation failure/);
  assert.deepEqual(calls.slice(-2), ["rollback", "release"]);
  assert(!calls.includes("commit"));
});

test("yearly numbering collisions return a readable conflict and roll back", async (t) => {
  const { calls } = mockPaymentConnection(t, { failure: "duplicate" });
  await assert.rejects(service.updatePaymentDate("p1", "2027-10-09"), { statusCode: 409 });
  assert.deepEqual(calls.slice(-2), ["rollback", "release"]);
  assert(!calls.includes("commit"));
});

test("the payment list includes distinct invoice links without changing allocation totals", async (t) => {
  let queryCount = 0;
  t.mock.method(db, "query", async (sql) => {
    queryCount++;
    if (sql.includes("SELECT DISTINCT")) return [[
      { payment_id: "p1", id: "f1", numero: "FT-001351-ROMA", numero_progressivo: 1351 },
      { payment_id: "p1", id: "f2", numero: "FT-001352-ROMA", numero_progressivo: 1352 },
    ]];
    return [[
      { id: "p1", importo: "100.00", numero_allocazioni: 3, totale_allocato: "100.00" },
      { id: "p2", importo: "10.00", numero_allocazioni: 0, totale_allocato: 0 },
    ]];
  });
  const rows = await service.listPayments();
  assert.equal(queryCount, 2);
  assert.deepEqual(rows[0].fatture_collegate.map((row) => row.numero_progressivo), [1351, 1352]);
  assert.equal(rows[0].totale_allocato, 100);
  assert.deepEqual(rows[1].fatture_collegate, []);
});
