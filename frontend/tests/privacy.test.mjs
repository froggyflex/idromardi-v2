import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { privacyRouting } from "../privacyRouting.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const html = await read("public/privacy/index.html");
let server;
let origin;

// Run npm run build first. Exercise Vite's production preview without starting
// the backend, accessing a database, logging in, or sending requests to Meta.
before(async () => {
  assert.equal(await read("dist/privacy/index.html"), html, "Build must include the current static notice");
  server = await preview({
    root,
    configFile: false,
    plugins: [privacyRouting()],
    logLevel: "silent",
    preview: { host: "127.0.0.1", port: 0, strictPort: true, open: false },
  });
  origin = "http://127.0.0.1:" + server.httpServer.address().port;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
  }
});

for (const path of ["/privacy", "/privacy/", "/privacy/index.html", "/privacy?source=meta"]) {
  test("anonymous crawler receives complete static notice at " + path, async () => {
    const response = await fetch(origin + path, {
      headers: { "User-Agent": "facebookexternalhit/1.1", Accept: "text/html" },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(await response.text(), html);
  });
}

test("notice has accessible Italian content, working section anchors and no executable code", () => {
  assert.match(html, /<html lang="it">/);
  assert.equal([...html.matchAll(/<h1[ >]/g)].length, 1);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, "IDs must be unique");
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), "Missing anchor " + id);
  for (const id of ["titolare", "dati", "finalita", "destinatari", "conservazione", "diritti", "cancellazione", "tecnologie"]) {
    assert.ok(ids.includes(id), "Missing notice section " + id);
  }
  assert.doesNotMatch(html, /<script\b|<iframe\b|<form\b|\son\w+=|javascript:|localStorage|sessionStorage/i);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /TODO|PLACEHOLDER|\[inserire|META_APP_SECRET|META_CREDENTIALS_ENCRYPTION_KEY/i);
});

test("deletion is a manual contact request, not a promise of automated erasure", async () => {
  assert.match(html, /mailto:info@idromardi\.it\?subject=Richiesta%20cancellazione%20dati%20Meta/);
  assert.match(html, /non da un modulo di cancellazione automatica/);
  assert.match(html, /archiviazione di una conversazione nell’inbox non comporta la sua cancellazione/);
  const existingInvoice = await read("../backend/src/modules/financialSummary/financialSummary.service.js");
  assert.ok(existingInvoice.includes("Idromardi l.t.d."));
  assert.ok(existingInvoice.includes("info@idromardi.it"));
});

test("stylesheet is local, served correctly and does not load tracking or fonts", async () => {
  const response = await fetch(origin + "/privacy/privacy.css");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/css/);
  const css = await response.text();
  assert.equal(css, await read("public/privacy/privacy.css"));
  assert.doesNotMatch(css, /@import|https?:\/\//);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /focus-visible/);
});

test("deployment routes privacy before the CRM fallback without redirecting it to login", async () => {
  const config = JSON.parse(await read("vercel.json"));
  assert.deepEqual(config.rewrites, [
    { source: "/privacy", destination: "/privacy/index.html" },
    { source: "/privacy/", destination: "/privacy/index.html" },
    { source: "/(.*)", destination: "/index.html" },
  ]);
  assert.ok(!config.redirects);
});

test("entry links use full navigation to the static notice rather than the guarded SPA", async () => {
  for (const path of ["src/pages/LoginPage.tsx", "src/pages/admin/MetaBusinessPage.tsx"]) {
    assert.match(await read(path), /<a href="\/privacy"/);
  }
});
