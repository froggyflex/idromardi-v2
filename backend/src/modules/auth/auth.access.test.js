const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PDFDocument } = require("pdf-lib");

async function fixture(t) {
  const salt = "test-salt";
  const passwordHash = password => `${salt}:${crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex")}`;
  const users = new Map([
    ["admin", { id: "admin", username: "admin", role: "ADMIN", password_hash: passwordHash("admin-password"), token_version: 0, must_change_password: false }],
    ["reviewer", { id: "reviewer", username: "reviewer", role: "REVIEWER", password_hash: passwordHash("review-password"), token_version: 0, must_change_password: false }],
  ]);
  const buildings = new Map(["building-a", "building-b"].map(id => [id, { id, nome: id, indirizzo: "Via Napoli", codice: 1 }]));
  let assignments = [];
  const audit = new Map();
  const downloads = [];
  const pdfDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "idromardi-preview-"));
  const pdfPath = path.join(pdfDirectory, "bill.pdf");
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  fs.writeFileSync(pdfPath, Buffer.from(await pdf.save()));
  t.after(() => { fs.unlinkSync(pdfPath); fs.rmdirSync(pdfDirectory); });
  const documents = [
    { id: "prospetto-a", condominio_id: "building-a", fattura_id: "session-a", document_type: "prospetto", filename: "prospetto.pdf", metadata_json: '{"periodLabel":"6^26","private":"not exposed"}' },
    { id: "bollette-a", condominio_id: "building-a", fattura_id: "session-a", document_type: "bollette_complete", filename: "bollette.pdf" },
    { id: "invoice-a", condominio_id: "building-a", document_type: "fattura_emessa", filename: "invoice.pdf" },
    { id: "prospetto-b", condominio_id: "building-b", document_type: "prospetto", filename: "other.pdf" },
  ];
  const legacy = [{ id: "legacy-a", condominio_id: "building-a", id_utenza: "resident-a", filename: "legacy.pdf" }, { id: "legacy-b", condominio_id: "building-b", id_utenza: "resident-b", filename: "other.pdf" }];
  for (const doc of legacy) doc.filepath = pdfPath;
  const residents = [
    { id: "resident-a", condominio_id: "building-a", Nome: " Mario ", Cognome: "Rossi", Interno: "0", Scala: "A" },
    { id: "resident-b", condominio_id: "building-b", Nome: "Private", Cognome: "Resident", Interno: "99", Scala: "B" },
  ];
  async function query(sql, params = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.includes("FROM INFORMATION_SCHEMA.COLUMNS")) return [[{ TABLE_NAME: "generated_documents", COLUMN_NAME: "metadata_json" }, { TABLE_NAME: "generated_documents", COLUMN_NAME: "period_label" }, { TABLE_NAME: "ripartizione_pdfs", COLUMN_NAME: "id_fattura" }]];
    if (q.includes("FROM fatture_sessioni")) return [[{ id: "session-a", period_year: 2026, period_month: 6 }]];
    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE")) return [{}];
    if (q.startsWith("SHOW COLUMNS")) return [[{ Field: "role", Type: "enum('ADMIN','REVIEWER','METER_READER','AMMINISTRATORE')" }, { Field: "must_change_password" }, { Field: "token_version" }]];
    if (q.startsWith("SELECT") && q.includes("FROM app_auth_users")) {
      if (q.includes("WHERE username")) return [[...users.values()].filter(user => user.username === params[0])];
      if (q.includes("WHERE id")) return [[users.get(params[0])].filter(Boolean)];
      return [[...users.values()]];
    }
    if (q.startsWith("INSERT INTO app_auth_users")) {
      if ([...users.values()].some(user => user.username === params[1])) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      const [id, username, password_hash, role, must_change_password] = params;
      users.set(id, { id, username, password_hash, role, must_change_password, token_version: 0 }); return [{ affectedRows: 1 }];
    }
    if (q.startsWith("UPDATE app_auth_users SET role")) return [{}];
    if (q.startsWith("UPDATE app_auth_users SET password_hash")) {
      const user = users.get(params[1]);
      if (user.token_version !== params[2]) return [{ affectedRows: 0 }];
      user.password_hash = params[0]; user.must_change_password = false; user.token_version++; return [{ affectedRows: 1 }];
    }
    if (q.startsWith("SELECT") && q.includes("JOIN app_amministratore_condomini")) return [[...buildings.values()].filter(building => assignments.some(row => row.user_id === params[0] && row.condominio_id === building.id) && (!params[1] || building.id === params[1]))];
    if (q.startsWith("SELECT") && q.includes("FROM condomini_v2")) return [params.length ? [buildings.get(params[0])].filter(Boolean) : [...buildings.values()]];
    if (q.startsWith("SELECT") && q.includes("FROM app_amministratore_condomini")) return [assignments];
    if (q.startsWith("DELETE FROM app_amministratore_condomini")) { assignments = assignments.filter(row => row.user_id !== params[0]); return [{}]; }
    if (q.startsWith("INSERT INTO app_amministratore_condomini")) { assignments.push({ user_id: params[0], condominio_id: params[1] }); return [{}]; }
    if (q.startsWith("INSERT INTO app_auth_impersonations")) { audit.set(params[0], { id: params[0], actor_id: params[1], target_id: params[2], ended: false }); return [{}]; }
    if (q.startsWith("UPDATE app_auth_impersonations")) { audit.get(params[0]).ended = true; return [{}]; }
    if (q.includes("FROM app_auth_impersonations")) { const row = audit.get(params[0]); return [[row].filter(row => row && !row.ended && row.actor_id === params[1] && row.target_id === params[2])]; }
    if (q.includes("FROM generated_documents") || q.includes("FROM ripartizione_pdfs")) {
      const source = q.includes("FROM generated_documents") ? documents.filter(doc => ["prospetto", "prospetto_bw", "bollette_complete"].includes(doc.document_type)) : legacy;
      const rows = source.filter(doc => q.includes("WHERE id =") ? doc.id === params[0] && doc.condominio_id === params[1] : doc.condominio_id === params[0]);
      if (q.includes("LEFT JOIN utenze_v2")) {
        assert(q.includes("u.condominio_id = r.condominio_id"), "Resident lookup must stay within the document's condominium");
        return [rows.map(doc => {
          const resident = residents.find(row => row.id === doc.id_utenza && row.condominio_id === doc.condominio_id);
          return { ...doc, recipient_name: resident ? [resident.Nome, resident.Cognome].map(value => value.trim()).filter(Boolean).join(" ") || null : null, interno: resident?.Interno ?? null, scala: resident?.Scala ?? null };
        })];
      }
      return [rows];
    }
    throw new Error(`Unexpected query: ${q}`);
  }
  const pool = { query, async getConnection() {
    let snapshot;
    return { query, async beginTransaction() { snapshot = { users: structuredClone(users), assignments: structuredClone(assignments) }; }, async commit() {}, async rollback() { users.clear(); for (const [id, user] of snapshot.users) users.set(id, user); assignments = snapshot.assignments; }, release() {} };
  } };
  const paths = ["../../config/db", "./auth.service", "./auth.middleware", "./auth.controller", "./auth.routes", "../amministratori/portal.routes", "../fatture/fatture.controller", "../fatture/fatture.service"].map(path => require.resolve(path));
  const originals = new Map(paths.map(path => [path, require.cache[path]]));
  for (const path of paths) delete require.cache[path];
  require.cache[paths[0]] = { exports: pool };
  require.cache[paths[7]] = { exports: {
    async getRipartizionePdfById(id, condominioId, fatturaId) {
      downloads.push({ id, query: { condominioId, ...(fatturaId ? { fatturaId } : {}) } });
      return legacy.find(doc => doc.id === id && doc.condominio_id === condominioId) || null;
    },
    async getGeneratedDocumentById(id, { condominioId, utenzaId }) {
      downloads.push({ id, query: { condominioId, ...(utenzaId ? { utenzaId } : {}) } });
      return documents.find(doc => doc.id === id && doc.condominio_id === condominioId) || null;
    },
    async getGeneratedDocumentBuffer() { return fs.promises.readFile(pdfPath); },
  } };
  const service = require("./auth.service");
  const { requireAuth, restrictAmministratore, protectUploadedDocuments } = require("./auth.middleware");
  const app = express(); app.use(express.json());
  app.use("/uploads", protectUploadedDocuments, (req, res) => res.json({ file: true }));
  app.use("/api/auth", require("./auth.routes"));
  app.use("/api", requireAuth, restrictAmministratore);
  app.use("/api/amministratore", require("../amministratori/portal.routes"));
  app.get("/api/condomini", (req, res) => res.json({ operatorData: true }));
  app.post("/api/fatture/sessioni", (req, res) => res.json({ changed: true }));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ error: error.message, ...(error.code ? { code: error.code } : {}) }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.on("listening", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); for (const [path, original] of originals) { if (original) require.cache[path] = original; else delete require.cache[path]; } });
  async function request(path, { token, method = "GET", body } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path.startsWith("/uploads/") ? "" : "/api"}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.headers.get("content-type")?.includes("json") ? await response.json() : await response.text() };
  }
  const admin = await service.login({ username: "admin", password: "admin-password" });
  const created = await service.createUser({ username: "amministratore", password: "temporary-pass", role: "AMMINISTRATORE", condominioIds: ["building-a"] });
  return { request, service, admin, created, users, audit, downloads, legacy, residents };
}

test("temporary credentials require a different personal password; previous sessions and credentials expire", async t => {
  const { request, service, created } = await fixture(t);
  const first = await service.login({ username: "amministratore", password: "temporary-pass" });
  assert.equal(first.user.mustChangePassword, true);
  assert.equal((await request("/auth/me", { token: first.token })).status, 200);
  assert.equal((await request("/amministratore/condomini", { token: first.token })).status, 403);
  assert.equal((await request("/auth/change-password", { token: first.token, method: "POST", body: { currentPassword: "temporary-pass", newPassword: "temporary-pass" } })).status, 400);
  const changed = await request("/auth/change-password", { token: first.token, method: "POST", body: { currentPassword: "temporary-pass", newPassword: "personal-password" } });
  assert.equal(changed.status, 200); assert.equal(changed.data.user.mustChangePassword, false); assert.equal(changed.data.user.id, created.user.id);
  assert.equal((await request("/amministratore/condomini", { token: first.token })).status, 401);
  assert.equal((await request("/amministratore/condomini", { token: changed.data.token })).status, 200);
  await assert.rejects(service.login({ username: "amministratore", password: "temporary-pass" }), { statusCode: 401 });
});

test("portal checks assignments and document ownership, denies other APIs, and ignores client PDF filters", async t => {
  const { request, service, downloads, admin } = await fixture(t);
  const changed = await service.changePassword({ username: "amministratore", currentPassword: "temporary-pass", newPassword: "personal-password" });
  const token = changed.token;
  const list = await request("/amministratore/condomini", { token });
  assert.deepEqual(list.data.condomini.map(row => row.id), ["building-a"]);
  assert.equal((await request("/condomini", { token })).status, 403);
  assert.equal((await request("/fatture/sessioni", { token, method: "POST" })).status, 403);
  assert.equal((await request("/auth/users", { token })).status, 403);
  assert.equal((await request("/uploads/proforma/old.pdf")).status, 401);
  assert.equal((await request("/uploads/proforma/old.pdf", { token })).status, 403);
  assert.equal((await request("/uploads/proforma/old.pdf", { token: admin.token })).status, 200);
  assert.equal((await request("/uploads/condomini/photo.jpg")).status, 200);
  assert.equal((await request("/amministratore/condomini/building-b/documents", { token })).status, 404);
  const documents = await request("/amministratore/condomini/building-a/documents", { token });
  assert.deepEqual(documents.data.documents.map(doc => doc.id), ["prospetto-a", "bollette-a", "legacy-a"]);
  assert.equal(documents.data.documents[0].period_key, "2026-06");
  assert.equal(documents.data.documents[0].period_label, "6^26");
  assert.equal(documents.data.documents[1].period_month, 6);
  assert.equal(documents.data.documents[0].metadata_json, undefined);
  assert.equal(documents.data.documents[2].recipient_name, "Mario Rossi");
  assert.equal(documents.data.documents[2].interno, "0");
  assert.equal(documents.data.documents[2].scala, "A");
  for (const [source, id] of [["generated", "prospetto-b"], ["generated", "invoice-a"], ["bolletta", "legacy-b"], ["unknown", "legacy-a"]]) assert.equal((await request(`/amministratore/condomini/building-a/documents/${source}/${id}/view`, { token })).status, 404);
  assert.equal((await request("/amministratore/condomini/building-a/documents/generated/prospetto-a/view?condominioId=building-b&idUtenza=other", { token })).status, 200);
  assert.deepEqual(downloads[0].query, { condominioId: "building-a" });
  const preview = await request("/amministratore/condomini/building-a/documents/bolletta/legacy-a/view", { token });
  assert.equal(preview.status, 200); assert(preview.data.startsWith("%PDF"));
});

test("portal reports an archived bill's missing file separately from missing document access", async t => {
  const { request, service, legacy } = await fixture(t);
  const { token } = await service.changePassword({ username: "amministratore", currentPassword: "temporary-pass", newPassword: "personal-password" });
  legacy[0].filepath = path.join(path.dirname(legacy[0].filepath), "missing.pdf");
  const response = await request("/amministratore/condomini/building-a/documents/bolletta/legacy-a/view", { token });
  assert.equal(response.status, 410); assert.equal(response.data.code, "PDF_FILE_MISSING");
  assert(response.data.error.includes("file originale"));
  assert.equal((await request("/amministratore/condomini/building-a/documents/bolletta/unknown/view", { token })).status, 404);
});

test("individual bills remain available with missing resident data and never expose another condominium's resident", async t => {
  const { request, service, legacy, residents } = await fixture(t);
  legacy.push(
    { id: "missing-resident", condominio_id: "building-a", id_utenza: "deleted-resident", filename: "missing.pdf" },
    { id: "mismatched-resident", condominio_id: "building-a", id_utenza: "resident-b", filename: "mismatched.pdf" },
    { id: "surname-only", condominio_id: "building-a", id_utenza: "surname-only", filename: "surname.pdf" },
  );
  residents.push({ id: "surname-only", condominio_id: "building-a", Nome: " ", Cognome: " Eredi Rossi ", Interno: "2A", Scala: null });
  const { token } = await service.changePassword({ username: "amministratore", currentPassword: "temporary-pass", newPassword: "personal-password" });
  const response = await request("/amministratore/condomini/building-a/documents", { token });
  assert.equal(response.status, 200);
  for (const id of ["missing-resident", "mismatched-resident"]) {
    const doc = response.data.documents.find(row => row.id === id);
    assert.equal(doc.recipient_name, null); assert.equal(doc.interno, null); assert.equal(doc.scala, null);
  }
  assert.equal(response.data.documents.find(row => row.id === "surname-only").recipient_name, "Eredi Rossi");
  assert(!JSON.stringify(response.data).includes("Private Resident"));
});

test("only admins can impersonate; first-login support is read-only, audited and revocable, and returns to the operator", async t => {
  const { request, service, created, admin, audit } = await fixture(t);
  const reviewer = await service.login({ username: "reviewer", password: "review-password" });
  const endpoint = `/auth/users/${created.user.id}/impersonate`;
  assert.equal((await request(endpoint, { token: reviewer.token, method: "POST" })).status, 403);
  assert.equal((await request("/auth/users/reviewer/impersonate", { token: admin.token, method: "POST" })).status, 404);
  const support = await request(endpoint, { token: admin.token, method: "POST" });
  assert.equal(support.status, 200); assert.equal(support.data.user.impersonation.actorId, "admin"); assert.equal(audit.size, 1);
  const token = support.data.token;
  assert.equal((await request("/amministratore/condomini", { token })).status, 200);
  assert.equal((await request("/auth/change-password", { token, method: "POST", body: { currentPassword: "temporary-pass", newPassword: "hijacked-password" } })).status, 403);
  assert.equal((await request(endpoint, { token, method: "POST" })).status, 403);
  assert.equal((await request("/fatture/sessioni", { token, method: "POST" })).status, 403);
  const returned = await request("/auth/impersonation/end", { token, method: "POST" });
  assert.equal(returned.status, 200); assert.equal(returned.data.user.role, "ADMIN"); assert.equal([...audit.values()][0].ended, true);
  assert.equal((await request("/amministratore/condomini", { token })).status, 401);
  assert.equal((await request("/auth/users", { token: returned.data.token })).status, 200);
  await service.login({ username: "amministratore", password: "temporary-pass" });
});

test("assignment changes apply to active sessions and invalid updates roll back", async t => {
  const { request, service, created, admin } = await fixture(t);
  const support = await request(`/auth/users/${created.user.id}/impersonate`, { token: admin.token, method: "POST" });
  const token = support.data.token;
  const endpoint = `/auth/users/${created.user.id}/condomini`;
  assert.equal((await request(endpoint, { token: admin.token, method: "PUT", body: { condominioIds: ["missing"] } })).status, 400);
  assert.equal((await request("/amministratore/condomini/building-a/documents", { token })).status, 200);
  assert.equal((await request(endpoint, { token: admin.token, method: "PUT", body: { condominioIds: ["building-b", "building-b"] } })).status, 200);
  assert.equal((await request("/amministratore/condomini/building-a/documents", { token })).status, 404);
  assert.equal((await request("/amministratore/condomini/building-b/documents", { token })).status, 200);
  await service.changePassword({ username: "admin", currentPassword: "admin-password", newPassword: "changed-admin-pass" });
  assert.equal((await request("/amministratore/condomini", { token })).status, 401);
});
