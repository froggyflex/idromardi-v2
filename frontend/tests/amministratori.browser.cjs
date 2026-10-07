const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const express = require("../../backend/node_modules/express");
const puppeteer = require("../../backend/node_modules/puppeteer");
const { PDFDocument } = require("../../backend/node_modules/pdf-lib");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, ".codex-remote-attachments", "amministratori-qa");
fs.mkdirSync(output, { recursive: true });
const admin = { id: "admin", username: "admin", role: "ADMIN" };
const account = { id: "account-a", username: "studio-rossi", role: "AMMINISTRATORE", mustChangePassword: true, condominioIds: ["building-a"] };
const accounts = [account];
const buildings = [{ id: "building-a", nome: "Condominio Via Napoli", indirizzo: "Via Napoli, 10", codice: 12, citta: "Napoli" }, { id: "building-b", nome: "Condominio Via Roma", indirizzo: "Via Roma, 20", codice: 15, citta: "Napoli" }];
const documents = [
  { id: "prospetto-a", source: "generated", document_type: "prospetto", filename: "Prospetto marzo giugno 2026.pdf", period_key: "2026-06", created_at: "2026-06-30" },
  { id: "prospetto-bw-a", source: "generated", document_type: "prospetto_bw", filename: "Prospetto bianco nero giugno 2026.pdf", period_year: 2026, period_month: 6, created_at: "2026-06-30" },
  { id: "bollette-a", source: "generated", document_type: "bollette_complete", filename: "Bollette marzo giugno 2026.pdf", period_label: "6^26", created_at: "2026-06-30" },
  { id: "individual-1", source: "bolletta", document_type: "bolletta", filename: "Bolletta Rossi Mario.pdf", period_key: "2026-06-18", created_at: "2026-06-30" },
  { id: "individual-2", source: "bolletta", document_type: "bolletta", filename: "Bolletta Bianchi Anna.pdf", period_key: "2026-06-18", created_at: "2026-06-30" },
  { id: "older-prospetto-a", source: "generated", document_type: "prospetto", filename: "Prospetto versione precedente.pdf", period_key: "2026-06", created_at: "2026-06-28" },
  { id: "prospetto-march", source: "generated", document_type: "prospetto", filename: "Prospetto marzo 2026.pdf", period_key: "2026-03", created_at: "2026-03-30" },
  { id: "bollette-december", source: "generated", document_type: "bollette_complete", filename: "Bollette dicembre 2025.pdf", period_key: "2025-12", created_at: "2026-08-01" },
  { id: "unclassified", source: "generated", document_type: "prospetto", filename: "Archivio senza periodo.pdf", created_at: "2026-09-01" },
];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const app = express(); app.use(express.static(path.join(root, "frontend/dist"))); app.get(/.*/, (req, res) => res.sendFile(path.join(root, "frontend/dist/index.html")));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.on("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const pdf = await PDFDocument.create(); pdf.addPage([595, 842]).drawText("Idromardi - Prospetto di ripartizione", { x: 50, y: 760, size: 18 }); const pdfBuffer = Buffer.from(await pdf.save());
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined), headless: true, pipe: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900 });
    const errors = []; let pdfRequests = 0, passwordChanges = 0, supportStarts = 0, supportEnds = 0, failPdf = false, emptyArchive = false, lastPdfPath = "";
    page.on("pageerror", error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", async request => {
      const url = new URL(request.url());
      if (["blob:", "chrome-extension:", "chrome:"].includes(url.protocol)) return request.continue();
      const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS", "Access-Control-Allow-Headers": "authorization,content-type" };
      if (request.method() === "OPTIONS") return request.respond({ status: 204, headers });
      if (["fetch", "xhr"].includes(request.resourceType())) {
        const route = url.pathname.replace(/^\/api/, "");
        const body = request.postData() ? JSON.parse(request.postData()) : {};
        let result = {}, status = 200;
        if (route === "/auth/change-password") {
          assert.equal(body.currentPassword, "temporary-pass"); assert.equal(body.newPassword, "personal-password");
          passwordChanges++; account.mustChangePassword = false; result = { token: "personal-token", user: account };
        } else if (route === "/auth/users" && request.method() === "GET") result = { users: accounts };
        else if (route === "/auth/condomini") result = { condomini: buildings };
        else if (route === "/auth/users" && request.method() === "POST") {
          assert.equal(body.role, "AMMINISTRATORE"); assert.equal(body.password, "second-temporary");
          const user = { ...body, id: "account-b", mustChangePassword: true }; accounts.push(user); result = { user };
        } else if (route.match(/^\/auth\/users\/[^/]+\/condomini$/)) {
          accounts.find(user => route.includes(user.id)).condominioIds = body.condominioIds; result = { ok: true };
        } else if (route.endsWith("/impersonate")) {
          supportStarts++; result = { token: "support-token", user: { ...account, impersonation: { actorId: "admin", actorUsername: "admin", id: "audit-session" } } };
        } else if (route === "/auth/impersonation/end") { supportEnds++; result = { token: "admin-token", user: admin }; }
        else if (route === "/amministratore/condomini") result = { condomini: buildings.filter(building => account.condominioIds.includes(building.id)) };
        else if (route === "/amministratore/condomini/building-a/documents") result = { condominio: buildings[0], documents: emptyArchive ? [] : documents };
        else if (route.endsWith("/view")) { pdfRequests++; lastPdfPath = route; return request.respond(failPdf ? { status: 500, contentType: "application/json", headers, body: '{"error":"Storage unavailable"}' } : { status: 200, contentType: "application/pdf", headers, body: pdfBuffer }); }
        else if (route === "/meta/unread") result = { total: 0 };
        else if (route.includes("/amministratore/condomini/")) { result = { error: "Condominio non trovato" }; status = 404; }
        return request.respond({ status, contentType: "application/json", headers, body: JSON.stringify(result) });
      }
      if (url.origin === base || ["data:", "blob:"].includes(url.protocol)) await request.continue(); else await request.abort();
    });
    await page.goto(base);
    async function session(token, user, route) {
      await page.evaluate(({ token, user }) => { localStorage.setItem("idromardi_auth_token", token); localStorage.setItem("idromardi_auth_user", JSON.stringify(user)); }, { token, user });
      await page.goto(`${base}${route}`);
    }
    const text = () => page.evaluate(() => document.body.innerText);
    async function click(label) {
      await page.waitForFunction(label => [...document.querySelectorAll("button")].some(button => button.textContent.trim() === label), {}, label);
      await page.evaluate(label => { const button = [...document.querySelectorAll("button")].find(button => button.textContent.trim() === label); button.focus(); button.click(); }, label);
    }
    await session("temporary-token", account, "/condomini/building-b/edit");
    await page.waitForFunction(() => document.body.innerText.includes("Scegli la tua password"));
    assert(new URL(page.url()).pathname === "/password-change");
    assert(!(await text()).includes("Geolocalizzazione Condomini"));
    const passwordFields = await page.$$("input[type=password]");
    for (const [index, value] of ["temporary-pass", "personal-password", "personal-password"].entries()) await passwordFields[index].type(value);
    await page.screenshot({ path: path.join(output, "first-login.png") });
    await click("Aggiorna password");
    await page.waitForFunction(() => document.body.innerText.includes("Condominio Via Napoli")); assert.equal(passwordChanges, 1);
    assert(!(await text()).includes("Condominio Via Roma")); assert(!(await text()).includes("Tariffe Casa Idrica"));
    await page.goto(`${base}/admin/amministratori`);
    await page.waitForFunction(() => document.body.innerText.includes("I tuoi condomini")); assert.equal(new URL(page.url()).pathname, "/amministratore");
    await page.click('a[href="/amministratore/condomini/building-a"]');
    await page.waitForFunction(() => document.body.innerText.includes("Bollette marzo giugno"));
    assert.equal(await page.$eval('.ammd-period-header h2', element => element.textContent), "Giugno 2026");
    assert.equal(await page.$eval('.ammd-period--active small', element => element.textContent), "6 documenti · Più recente");
    assert.equal((await page.$$('.ammd-document-card')).length, 2);
    await page.type('input[aria-label="Cerca un periodo"]', 'inesistente');
    await page.waitForFunction(() => document.body.innerText.includes("Nessun periodo trovato"));
    await click("Mostra tutti i periodi");
    await page.select('select[aria-label="Filtra per anno"]', '2025');
    await page.waitForFunction(() => document.body.innerText.includes("Bollette dicembre 2025.pdf"));
    assert.equal(await page.$eval('.ammd-period-header h2', element => element.textContent), "Dicembre 2025");
    await page.select('select[aria-label="Filtra per anno"]', '');
    await page.evaluate(() => [...document.querySelectorAll('.ammd-period')].find(button => button.innerText.includes("Giugno 2026")).click());
    await page.waitForFunction(() => document.body.innerText.includes("Bollette marzo giugno"));
    await page.evaluate(() => document.activeElement.blur());
    await page.screenshot({ path: path.join(output, "documents-desktop.png") });
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, "documents-mobile.png"), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await click("Visualizza prospetto"); await page.waitForSelector('[role="dialog"] iframe'); assert.equal(pdfRequests, 1);
    assert(await page.$eval('[role="dialog"] iframe', element => element.src.startsWith('blob:')));
    await page.screenshot({ path: path.join(output, "preview-mobile.png") });
    await page.keyboard.press('Escape'); await page.waitForSelector('[role="dialog"]', { hidden: true });
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Visualizza prospetto");
    await page.setViewport({ width: 1280, height: 900 });
    await click("Bianco e nero"); await click("Visualizza prospetto"); await page.waitForSelector('[role="dialog"] iframe');
    assert(lastPdfPath.includes("prospetto-bw-a"));
    await delay(750);
    await page.screenshot({ path: path.join(output, "preview-desktop.png") });
    await click("Scarica PDF"); assert.equal(pdfRequests, 2);
    await page.click('button[aria-label="Chiudi anteprima"]');
    await page.click('details summary');
    assert((await text()).includes("Bolletta Rossi Mario.pdf"));
    await page.click('button[aria-label="Visualizza Bolletta Rossi Mario.pdf"]'); await page.waitForSelector('[role="dialog"]');
    assert(lastPdfPath.includes("/bolletta/individual-1/view"));
    await page.click('button[aria-label="Chiudi anteprima"]');
    await page.evaluate(() => [...document.querySelectorAll('details summary')].find(element => element.innerText.includes("Versioni precedenti")).click());
    assert((await text()).includes("Prospetto versione precedente.pdf"));
    failPdf = true;
    await click("Visualizza bollette"); await page.waitForFunction(() => document.body.innerText.includes("Impossibile aprire il PDF"));
    assert.equal(await page.$('[role="dialog"]'), null);
    failPdf = false;
    emptyArchive = true; await page.reload(); await page.waitForFunction(() => document.body.innerText.includes("Il tuo archivio è pronto"));
    emptyArchive = false;
    await page.goto(`${base}/amministratore/condomini/building-b`);
    await page.waitForFunction(() => document.body.innerText.includes("Condominio non trovato"));
    await page.setViewport({ width: 1280, height: 900 });
    await session("admin-token", admin, "/admin/amministratori");
    await page.waitForFunction(() => document.body.innerText.includes("studio-rossi"));
    await page.type("form input[autocomplete=off]", "studio-bianchi"); await page.type("form input[type=password]", "second-temporary");
    await page.click("form input[type=checkbox]"); await click("Crea account");
    await page.waitForFunction(() => document.body.innerText.includes("studio-bianchi")); assert.deepEqual(accounts[1].condominioIds, ["building-a"]);
    await click("Gestisci condomini");
    await page.waitForFunction(() => document.body.innerText.includes("Salva assegnazioni"));
    const boxes = await page.$$("input[type=checkbox]"); await boxes[2].click(); await boxes[3].click();
    await click("Salva assegnazioni");
    await page.waitForFunction(() => document.body.innerText.includes("Assegnazioni aggiornate")); assert.deepEqual(account.condominioIds, ["building-b"]);
    await page.screenshot({ path: path.join(output, "admin-accounts.png") });
    await click("Accedi come amministratore");
    await page.waitForFunction(() => document.body.innerText.includes("Torna all’account operatore") && document.body.innerText.includes("Condominio Via Roma"));
    assert.equal(supportStarts, 1); assert((await text()).includes("Condominio Via Roma"));
    assert(!(await text()).includes("Password"));
    await page.screenshot({ path: path.join(output, "support-session.png") });
    await click("Torna all’account operatore");
    await page.waitForFunction(() => document.body.innerText.includes("Account amministratori") && document.body.innerText.includes("studio-bianchi"));
    assert.equal(supportEnds, 1); assert(!(await text()).includes("Assistenza: stai visualizzando")); assert.deepEqual(errors, []);
    console.log("Amministratore UI passed: account workflow, period grouping, year/search filters, PDF preview/download, monochrome variants, individual bills, prior versions, failure/empty states, mobile layout, and support return. Screenshots:", output);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
