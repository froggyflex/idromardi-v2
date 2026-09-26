const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sandbox = { module: { exports: {} }, process, __dirname, require(name) {
  if (name === "../../config/db" || name === "../../utils/puppeteer") return {};
  return require(name);
} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"prospetti.service.js"),"utf8"), sandbox);

test("prospetto and replacement list show surname first without changing ID order", () => {
  const html = sandbox.module.exports.buildHtml({session:{}, rows:[
    {id_user:2, Cognome:"De Luca", Nome:"Anna", stato_attuale:"Y"},
    {id_user:1, Cognome:"Rossi", Nome:"Mario", stato_attuale:"K"},
    {id_user:3, Cognome:"D'Amato & Figli", Nome:"", stato_attuale:"K"},
    {id_user:4, Cognome:"Bianchi", Nome:"Lucia", stato_attuale:"B"},
  ]});
  assert(html.includes("Cognome e nome"));
  assert(html.includes("Rossi Mario"));
  assert.equal((html.match(/De Luca Anna/g)||[]).length,2);
  assert(html.indexOf("Rossi Mario") < html.indexOf("De Luca Anna"));
  assert(html.includes("D'Amato &amp; Figli"));
  assert(!html.includes("Mario Rossi"));
  assert(html.includes("T = Telegram"));
  assert(html.includes("B = contatore bloccato"));
  assert(html.includes("Contatore bloccato"));
});

test("print modes preserve strong borders and restrict monochrome styling to BW", () => {
  const data = { session: {}, rows: [], logoUrl: "", mode: "color" };
  const color = sandbox.module.exports.buildHtml(data);
  const bw = sandbox.module.exports.buildHtml({ ...data, mode: "bw" });
  assert(color.includes('<body class="color">'));
  assert(bw.includes('<body class="monochrome">'));
  assert(color.includes("body.monochrome *"));
  assert(bw.includes("body.monochrome img { filter: grayscale(1); }"));
  assert(bw.includes("body.monochrome .detail-table .totals td { background: #ffffff !important; }"));
  assert(color.includes("border: 0.6pt solid #555555"));
});

test("both variants reuse one database snapshot and browser page", async () => {
  let pdfCalls = 0, pageCount = 0, queryCount = 0, closed = 0;
  const queryResults = [
    [[{ id: "session-1", id_condominio: "condo-1" }]],
    [[{ id_user: 1, Cognome: "Rossi", Nome: "Mario" }]],
    [[{ nome: "Condominio test" }]], [[]], [[]], [[]],
  ];
  const page = {
    setDefaultNavigationTimeout() {}, setDefaultTimeout() {}, async setContent() {},
    async evaluate() {}, async pdf() { return Buffer.from(`%PDF-${++pdfCalls}`); },
    async close() { closed++; },
  };
  const context = { module: { exports: {} }, process, Buffer, __dirname, require(name) {
    if (name === "../../config/db") return { async query() { return queryResults[queryCount++]; } };
    if (name === "../../utils/puppeteer") return { async launchBrowser() {
      return { async newPage() { pageCount++; return page; }, async close() { closed++; } };
    } };
    if (name === "../../utils/pdf-logo") return { async preparePrintLogo() { return ""; } };
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "prospetti.service.js"), "utf8"), context);
  const result = await context.module.exports.buildPdf("session-1", { mode: "color", includeMonochrome: true });
  assert.equal(queryCount, 6);
  assert.equal(pageCount, 1);
  assert.equal(pdfCalls, 2);
  assert.equal(closed, 2);
  assert.equal(result.buffer.toString(), "%PDF-1");
  assert.equal(result.monochromeBuffer.toString(), "%PDF-2");
});

function loadController(service, storage) {
  const context = { module: { exports: {} }, console: { error() {} }, require(name) {
    if (name === "./prospetti.service") return service;
    if (name === "../../utils/generatedDocuments") return storage;
    throw new Error(`Unexpected dependency ${name}`);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "prospetti.controller.js"), "utf8"), context);
  return context.module.exports;
}

function response() {
  return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; }, send(data) { this.body = data; },
    setHeader(key, value) { this.headers[key] = value; } };
}

test("generation returns JSON only after archiving both linked print variants", async () => {
  const saved = [];
  const controller = loadController({ async buildPdf(id, options) {
    assert.equal(id, "session-1");
    assert.equal(options.mode, "color");
    assert.equal(options.includeMonochrome, true);
    return { buffer: "color", monochromeBuffer: "bw", filename: "test.pdf", condominioId: "condo-1", periodLabel: "6/2026" };
  } }, { async saveGeneratedDocument(doc) { saved.push(doc); return { id: `doc-${saved.length}`, ...doc }; } });
  const res = response();
  await controller.generatePdf({ params: { fatturaId: "session-1" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].documentType, "prospetto_bw");
  assert.equal(saved[1].metadata.monochromeDocumentId, "doc-1");
  assert.equal(saved[1].buffer, "color");
  assert.equal(res.body.document.id, "doc-2");
  assert.equal(res.headers["Content-Type"], undefined);
});

test("generation reports archive failure instead of claiming success", async () => {
  const controller = loadController({ async buildPdf() { return { filename: "test.pdf" }; } }, {
    async saveGeneratedDocument() { throw new Error("Archive unavailable"); },
  });
  const res = response();
  await controller.generatePdf({ params: { fatturaId: "session-1" } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "Archive unavailable");
});

test("both archived print modes avoid browser rendering", async () => {
  const docs = {
    color: { id: "color", document_type: "prospetto", fattura_id: "session-1", condominio_id: "condo-1", r2_key: "color-key", filename: "color.pdf", metadata_json: JSON.stringify({ printMode: "color", monochromeDocumentId: "bw" }) },
    bw: { document_type: "prospetto_bw", fattura_id: "session-1", r2_key: "bw-key", filename: "bw.pdf" },
  };
  const controller = loadController({ async buildPdf() { throw new Error("Should reuse archive"); } }, {
    async getGeneratedDocumentById(id, options) { assert.equal(options.condominioId, "condo-1"); return docs[id]; },
    async getPdfFromR2(key) { return key; },
  });
  for (const mode of ["color", "bw"]) {
    const res = response();
    await controller.printGeneratedPdf({ params: { id: "color" }, query: { mode, condominioId: "condo-1" } }, res);
    assert.equal(res.body, `${mode}-key`);
    assert.equal(res.headers["Content-Type"], "application/pdf");
  }
});

test("legacy PDFs render the requested mode without changing accounting or the archive", async () => {
  const controller = loadController({ async buildPdf(id, options) {
    assert.equal(id, "session-1"); assert.equal(options.mode, "color");
    return { buffer: "legacy-color", filename: "legacy.pdf" };
  } }, { async getGeneratedDocumentById() { return { document_type: "prospetto", fattura_id: "session-1", metadata_json: "null" }; } });
  const res = response();
  await controller.printGeneratedPdf({ params: { id: "legacy" }, query: { mode: "color" } }, res);
  assert.equal(res.body, "legacy-color");
});

test("printing rejects unsupported modes and non-prospetto documents", async () => {
  const controller = loadController({}, { async getGeneratedDocumentById() { return { document_type: "fattura_emessa" }; } });
  for (const [mode, expected] of [["invalid", 400], ["color", 404]]) {
    const res = response();
    await controller.printGeneratedPdf({ params: { id: "invoice" }, query: { mode } }, res);
    assert.equal(res.statusCode, expected);
  }
});
