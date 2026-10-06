const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_TEMPLATE, resolveTemplate } = require("./template-model");
const dbPath = require.resolve("../../config/db");
const browserPath = require.resolve("../../utils/puppeteer");
const servicePath = require.resolve("./template.service");

function fixture(t) {
  const store = new Map();
  const state = { validations: 0, overflowAt: -1, closed: 0, committed: 0, rolledBack: 0 };
  let snapshot;
  async function query(sql, params = []) {
    if (sql.startsWith("CREATE TABLE")) return [[]];
    if (sql.includes("FROM condomini_v2 WHERE id")) return [[{ id: params[0], nome: params[0] }]];
    if (sql.includes("WHERE scope_key IN")) return [[...store.values()].filter(row => row.scope_key === "default" || row.scope_key === params[0])];
    if (sql.startsWith("INSERT IGNORE")) {
      const key = params[0] || "default";
      if (!store.has(key)) store.set(key, { scope_key: key, overrides_json: "{}", revision: 0 });
      return [{}];
    }
    if (sql.includes("WHERE scope_key <>")) return [[...store.values()].filter(row => row.scope_key !== "default")];
    if (sql.includes("FOR UPDATE")) return [[store.get(params[0] || "default")]];
    if (sql.startsWith("UPDATE bolletta_templates")) {
      const row = store.get(params[2]);
      row.overrides_json = params[0]; row.revision++; row.updated_by = params[1]; return [{}];
    }
    throw new Error(`Unhandled query: ${sql}`);
  }
  const pool = { query, async getConnection() { return {
    query, async beginTransaction() { snapshot = structuredClone(store); },
    async commit() { state.committed++; }, async rollback() { state.rolledBack++; store.clear(); for (const [key, value] of snapshot) store.set(key, value); }, release() {},
  }; } };
  const browser = { async newPage() { return {
    async emulateMediaType() {}, async setContent() {},
    async evaluate() { return state.validations++ === state.overflowAt ? [{ index: 1, overflow: true }] : []; },
    async close() { state.closed++; },
  }; }, async close() {} };
  const originals = new Map([dbPath, browserPath, servicePath].map(path => [path, require.cache[path]]));
  require.cache[dbPath] = { exports: pool };
  require.cache[browserPath] = { exports: { launchBrowser: async () => browser } };
  delete require.cache[servicePath];
  const service = require("./template.service");
  t.after(() => { for (const [path, original] of originals) { if (original) require.cache[path] = original; else delete require.cache[path]; } });
  return { service, store, state };
}

test("persists sparse condominium overrides and applies later default changes", async t => {
  const { service, store } = fixture(t);
  const custom = resolveTemplate(DEFAULT_TEMPLATE, { labels: { water: "Acqua condominiale" } });
  await service.saveTemplate("condo-1", { template: custom, revision: 0, defaultRevision: 0 }, "operatore");
  assert.deepEqual(JSON.parse(store.get("condo-1").overrides_json).labels, { water: "Acqua condominiale" });
  await service.saveTemplate("default", { template: resolveTemplate(DEFAULT_TEMPLATE, { labels: { sewer: "Servizio fognario" } }), revision: 0, defaultRevision: 0 }, "admin");
  const loaded = await service.getTemplate("condo-1");
  assert.equal(loaded.effective.labels.water, "Acqua condominiale");
  assert.equal(loaded.effective.labels.sewer, "Servizio fognario");
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.defaultRevision, 1);
  await service.saveTemplate("condo-1", { template: loaded.base, revision: 1, defaultRevision: 1 }, "operatore");
  assert.deepEqual(JSON.parse(store.get("condo-1").overrides_json), { labels: {}, page: {}, sections: {} });
});
test("stale edits roll back instead of replacing another operator's changes", async t => {
  const { service, store, state } = fixture(t);
  await service.saveTemplate("default", { template: DEFAULT_TEMPLATE, revision: 0, defaultRevision: 0 }, "admin");
  await assert.rejects(service.saveTemplate("condo-1", { template: DEFAULT_TEMPLATE, revision: 0, defaultRevision: 0 }, "operatore"), error => error.statusCode === 409);
  assert.equal(store.get("default").revision, 1);
  assert.equal(store.has("condo-1"), false);
  assert.equal(state.rolledBack, 1);
});
test("default edits are rejected if an inherited condominium layout no longer fits", async t => {
  const { service, store, state } = fixture(t);
  await service.saveTemplate("condo-1", { template: DEFAULT_TEMPLATE, revision: 0, defaultRevision: 0 }, "operatore");
  state.overflowAt = state.validations + 1;
  await assert.rejects(service.saveTemplate("default", { template: resolveTemplate(DEFAULT_TEMPLATE, { page: { gap: 6 } }), revision: 0, defaultRevision: 0 }, "admin"), error => error.code === "TEMPLATE_A4_OVERFLOW" && /condo-1/.test(error.message));
  assert.equal(store.get("default").revision, 0);
  assert.equal(store.get("condo-1").revision, 1);
  assert.equal(state.closed, state.validations);
});
