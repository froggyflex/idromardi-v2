const db = require("../../config/db");
const { DEFAULT_TEMPLATE, SECTION_NAMES, validateOverrides, resolveTemplate, diffTemplate } = require("./template-model");
let schemaPromise;
async function ensureSchema() {
  if (!schemaPromise) schemaPromise = db.query(`CREATE TABLE IF NOT EXISTS bolletta_templates (
    scope_key VARCHAR(64) NOT NULL PRIMARY KEY,
    overrides_json JSON NOT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 0,
    updated_by VARCHAR(100) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`).catch(error => { schemaPromise = undefined; throw error; });
  await schemaPromise;
}
function decode(row) {
  if (!row) return {};
  return validateOverrides(typeof row.overrides_json === "string" ? JSON.parse(row.overrides_json) : row.overrides_json);
}
async function validateScope(scope) {
  if (typeof scope !== "string" || !scope || scope.length > 64) throw Object.assign(new Error("Condominio non valido."), { statusCode: 400 });
  if (scope !== "default") {
    const [rows] = await db.query("SELECT id, nome, codice, indirizzo, cap, citta FROM condomini_v2 WHERE id = ? LIMIT 1", [scope]);
    if (!rows.length) throw Object.assign(new Error("Condominio non trovato."), { statusCode: 404 });
    return rows[0];
  }
  return null;
}
async function getTemplate(scope = "default") {
  await ensureSchema();
  const condominio = await validateScope(scope);
  const [rows] = await db.query("SELECT * FROM bolletta_templates WHERE scope_key IN ('default', ?)", [scope]);
  const defaultRow = rows.find(row => row.scope_key === "default");
  const row = rows.find(row => row.scope_key === scope);
  const base = resolveTemplate(DEFAULT_TEMPLATE, decode(defaultRow));
  const overrides = scope === "default" ? {} : decode(row);
  return { scope, condominio, base, factory: DEFAULT_TEMPLATE, effective: resolveTemplate(base, overrides), overrides, revision: Number(row?.revision || 0), defaultRevision: Number(defaultRow?.revision || 0), sectionNames: SECTION_NAMES, updatedAt: row?.updated_at || null };
}
async function validateLayouts(items) {
  const { launchBrowser } = require("../../utils/puppeteer");
  const { previewHtml, inspectA4, layoutError } = require("./template-preview");
  const browser = await launchBrowser();
  let page;
  try {
    page = await browser.newPage();
    await page.emulateMediaType("print");
    for (const item of items) {
      await page.setContent(previewHtml(item.template, item.condominio), { waitUntil: "load" });
      const overflow = await inspectA4(page);
      if (overflow.length) {
        const error = layoutError(overflow);
        if (item.scope) error.message = `Modello condominio ${item.scope}: ${error.message}`;
        throw error;
      }
    }
  } finally { if (page) await page.close(); await browser.close(); }
}
async function saveTemplate(scope, body, username) {
  const clean = validateOverrides(body.template);
  const current = await getTemplate(scope);
  const effective = resolveTemplate(current.base, clean);
  await validateLayouts([{ template: effective, condominio: current.condominio }]);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Always lock the default first, serializing inheritance with default edits.
    await conn.query("INSERT IGNORE INTO bolletta_templates (scope_key, overrides_json) VALUES ('default', '{}')");
    const [[defaultRow]] = await conn.query("SELECT * FROM bolletta_templates WHERE scope_key = 'default' FOR UPDATE");
    if (scope !== "default") await conn.query("INSERT IGNORE INTO bolletta_templates (scope_key, overrides_json) VALUES (?, '{}')", [scope]);
    const [[row]] = await conn.query("SELECT * FROM bolletta_templates WHERE scope_key = ? FOR UPDATE", [scope]);
    if (Number(body.revision) !== Number(row.revision) || Number(body.defaultRevision) !== Number(defaultRow.revision)) {
      throw Object.assign(new Error("Il modello e stato aggiornato da un altro operatore. Ricarica prima di salvare."), { statusCode: 409 });
    }
    if (scope === "default") {
      const [assigned] = await conn.query(`SELECT t.scope_key, t.overrides_json, c.nome, c.indirizzo, c.cap, c.citta
        FROM bolletta_templates t LEFT JOIN condomini_v2 c ON c.id = t.scope_key
        WHERE scope_key <> 'default' FOR UPDATE`);
      if (assigned.length) await validateLayouts(assigned.map(row => ({ scope: row.nome || row.scope_key, condominio: row, template: resolveTemplate(effective, decode(row)) })));
    }
    const base = scope === "default" ? DEFAULT_TEMPLATE : resolveTemplate(DEFAULT_TEMPLATE, decode(defaultRow));
    const overrides = diffTemplate(base, effective);
    await conn.query("UPDATE bolletta_templates SET overrides_json = ?, revision = revision + 1, updated_by = ? WHERE scope_key = ?", [JSON.stringify(overrides), String(username || "").slice(0, 100), scope]);
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
  return getTemplate(scope);
}
async function listCondomini(search = "") {
  await ensureSchema();
  const value = `%${String(search).slice(0, 100)}%`;
  const [rows] = await db.query(`SELECT c.id, c.codice, c.nome, c.indirizzo, t.revision AS template_revision
    FROM condomini_v2 c LEFT JOIN bolletta_templates t ON t.scope_key = c.id
    WHERE c.nome LIKE ? OR c.indirizzo LIKE ? OR CAST(c.codice AS CHAR) LIKE ?
    ORDER BY c.nome, c.id LIMIT 100`, [value, value, value]);
  return rows;
}
module.exports = { getTemplate, saveTemplate, listCondomini };
