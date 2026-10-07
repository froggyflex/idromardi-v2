const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const express = require("../../backend/node_modules/express");
const puppeteer = require("../../backend/node_modules/puppeteer");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, ".codex-remote-attachments", "amministratori-qa");
fs.mkdirSync(output, { recursive: true });
const admin = { id: "admin", username: "admin", role: "ADMIN" };
const account = { id: "account-a", username: "studio-rossi", role: "AMMINISTRATORE", mustChangePassword: true, condominioIds: ["building-a"] };
const accounts = [account];
const buildings = [{ id: "building-a", nome: "Condominio Via Napoli", indirizzo: "Via Napoli, 10", codice: 12, citta: "Napoli" }, { id: "building-b", nome: "Condominio Via Roma", indirizzo: "Via Roma, 20", codice: 15, citta: "Napoli" }];
const documents = [{ id: "prospetto-a", source: "generated", document_type: "prospetto", filename: "Prospetto marzo giugno 2026.pdf", created_at: "2026-06-30" }, { id: "bollette-a", source: "generated", document_type: "bollette_complete", filename: "Bollette marzo giugno 2026.pdf", created_at: "2026-06-30" }];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const app = express(); app.use(express.static(path.join(root, "frontend/dist"))); app.get(/.*/, (req, res) => res.sendFile(path.join(root, "frontend/dist/index.html")));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.on("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined), headless: true, pipe: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900 });
    const errors = []; let pdfRequests = 0, passwordChanges = 0, supportStarts = 0, supportEnds = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", async request => {
      const url = new URL(request.url());
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
        else if (route === "/amministratore/condomini/building-a/documents") result = { condominio: buildings[0], documents };
        else if (route.endsWith("/view")) { pdfRequests++; return request.respond({ status: 200, contentType: "application/pdf", headers, body: "%PDF-1.4\n%%EOF" }); }
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
      await page.evaluate(label => [...document.querySelectorAll("button")].find(button => button.textContent.trim() === label).click(), label);
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
    await page.screenshot({ path: path.join(output, "documents-desktop.png") });
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, "documents-mobile.png") });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await click("Apri PDF"); await delay(300); assert.equal(pdfRequests, 1);
    for (const tab of await browser.pages()) if (tab !== page) await tab.close();
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
    await page.waitForFunction(() => document.body.innerText.includes("Torna all’account operatore"));
    assert.equal(supportStarts, 1); assert((await text()).includes("Condominio Via Roma"));
    assert(!(await text()).includes("Password"));
    await page.screenshot({ path: path.join(output, "support-session.png") });
    await click("Torna all’account operatore");
    await page.waitForFunction(() => document.body.innerText.includes("Account amministratori") && document.body.innerText.includes("studio-bianchi"));
    assert.equal(supportEnds, 1); assert(!(await text()).includes("Assistenza: stai visualizzando")); assert.deepEqual(errors, []);
    console.log("Amministratore UI passed: mandatory password change, restricted navigation, assigned PDFs, account creation, assignment edits, and support return. Screenshots:", output);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
