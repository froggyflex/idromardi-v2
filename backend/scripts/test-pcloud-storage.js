const crypto = require("crypto");
const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { createPcloudStorage, exchangeCode } = require("../src/utils/pcloudStorage");

const CALLBACK_PATH = "/pcloud/callback";

function validateCallback(params, expectedState) {
  const actual = Buffer.from(params.get("state") || "");
  const expected = Buffer.from(expectedState);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error("Autorizzazione non riconosciuta. Usa il collegamento di questa sessione.");
  }
  if (params.get("error")) throw new Error("Autorizzazione pCloud non concessa.");
  if (params.get("hostname") !== "eapi.pcloud.com" || params.get("locationid") !== "2") {
    throw new Error("Questo test richiede un account pCloud nella regione Europa.");
  }
  const code = params.get("code");
  if (!code || code.length > 4096) throw new Error("Codice di autorizzazione mancante o non valido.");
  return code;
}

async function startAuthorization({ clientId, clientSecret, port = 43821,
  timeoutMs = 10 * 60 * 1000, exchange = exchangeCode }) {
  const state = crypto.randomBytes(32).toString("hex");
  let settle, fail, consumed = false;
  const token = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
  // A rejection may precede the caller awaiting this promise (timeout or user cancellation).
  token.catch(() => {});
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== CALLBACK_PATH) {
      res.writeHead(404).end("Pagina non trovata.");
      return;
    }
    if (consumed) { res.writeHead(409).end("Autorizzazione gia ricevuta."); return; }
    let code;
    try { code = validateCallback(url.searchParams, state); }
    catch (error) { res.writeHead(400).end(error.message); return; }
    consumed = true;
    try {
      const accessToken = await exchange({ clientId, clientSecret, code });
      res.end("pCloud collegato. Puoi chiudere questa pagina; il test continua sul computer.");
      settle(accessToken);
    } catch {
      res.writeHead(502).end("Connessione a pCloud non riuscita. Riavvia il test.");
      fail(new Error("Connessione a pCloud non riuscita. Riavvia il test."));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const redirectUri = `http://127.0.0.1:${server.address().port}${CALLBACK_PATH}`;
  const authorizeUrl = new URL("https://my.pcloud.com/oauth2/authorize");
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: redirectUri, state,
  }).toString();
  const timer = setTimeout(() => {
    fail(new Error("Autorizzazione scaduta. Riavvia il test."));
    server.close();
  }, timeoutMs);
  function close() { clearTimeout(timer); server.close(); }
  return { authorizeUrl: authorizeUrl.href, redirectUri, token, close };
}

async function samplePdf(title) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText("IDROMARDI - TEST ARCHIVIO", { x: 48, y: 780, size: 18, font, color: rgb(0.05, 0.22, 0.4) });
  page.drawText(title, { x: 48, y: 730, size: 16, font });
  page.drawText("Documento sintetico per verificare il collegamento a pCloud.", { x: 48, y: 685, size: 11, font });
  page.drawText("Nessun dato personale. Non valido per la fatturazione.", { x: 48, y: 660, size: 11, font });
  return Buffer.from(await pdf.save());
}

async function runProbe(storage, { runId = crypto.randomUUID() } = {}) {
  const capacity = await storage.getCapacity();
  const samples = await Promise.all([
    samplePdf("Bolletta di prova"), samplePdf("Prospetto di ripartizione di prova"),
  ]);
  if (capacity.freeBytes < samples.reduce((total, item) => total + item.length, 0)) {
    throw new Error("Spazio pCloud insufficiente per i PDF di prova.");
  }
  const folderId = await storage.ensureTestFolder();
  const report = { region: "Europe", testedAt: new Date().toISOString(), folder: "Idromardi-test",
    folderId, capacity, documents: [] };
  const files = [];
  for (const [index, kind] of ["bolletta", "prospetto"].entries()) {
    const filename = `${kind}-test-${runId}.pdf`;
    const buffer = samples[index];
    const started = performance.now();
    const fileId = await storage.uploadPdf({ folderId, filename, buffer });
    const uploaded = performance.now();
    const preview = await storage.readPdf({ fileId });
    const previewed = performance.now();
    const downloaded = await storage.readPdf({ fileId, download: true });
    const completed = performance.now();
    if (!buffer.equals(preview) || !buffer.equals(downloaded)) {
      throw new Error(`Verifica contenuto non riuscita per ${kind}. I file di prova restano in Idromardi-test.`);
    }
    const parsed = await PDFDocument.load(preview);
    if (parsed.getPageCount() !== 1) throw new Error(`PDF ${kind} non valido.`);
    report.documents.push({ kind, filename, fileId, bytes: buffer.length,
      checksumSha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      verified: true, pageCount: parsed.getPageCount(),
      uploadMs: Math.round(uploaded - started), previewMs: Math.round(previewed - uploaded),
      downloadMs: Math.round(completed - previewed) });
    files.push({ filename, buffer: downloaded });
  }
  return { report, files };
}

async function main() {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
  const clientId = process.env.PCLOUD_CLIENT_ID;
  const clientSecret = process.env.PCLOUD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Configura PCLOUD_CLIENT_ID e PCLOUD_CLIENT_SECRET in backend/.env. Vedi docs/pcloud-storage-test.md.");
  }
  const port = Number(process.env.PCLOUD_TEST_PORT || 43821);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PCLOUD_TEST_PORT non valida.");
  const session = await startAuthorization({ clientId, clientSecret, port });
  console.log("Apri questo collegamento nel browser su questo computer e autorizza pCloud:");
  console.log(session.authorizeUrl);
  try {
    const accessToken = await session.token;
    const runId = crypto.randomUUID();
    const result = await runProbe(createPcloudStorage({ accessToken }), { runId });
    const outputDir = path.resolve(__dirname, "../runtime_uploads/pcloud-test", runId);
    await fs.mkdir(outputDir, { recursive: true });
    for (const file of result.files) await fs.writeFile(path.join(outputDir, file.filename), file.buffer);
    await fs.writeFile(path.join(outputDir, "report.json"), JSON.stringify(result.report, null, 2));
    console.log("Test completato: bolletta e prospetto caricati e riscaricati senza modifiche.");
    console.log(`PDF verificati e risultati: ${outputDir}`);
    console.log("I PDF di prova restano nella cartella pCloud Idromardi-test.");
  } finally { session.close(); }
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { validateCallback, startAuthorization, samplePdf, runProbe };
