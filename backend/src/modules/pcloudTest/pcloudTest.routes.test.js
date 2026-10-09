const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createPcloudTestRouters, getConfig } = require("./pcloudTest.routes");

const settings = { clientId: "app", clientSecret: "secret", callbackUrl: "https://backend.example/api/pcloud-test/callback",
  frontendUrl: "https://frontend.example/admin/pcloud-test" };

async function fixture(t, options = {}) {
  let time = 1000;
  const routes = createPcloudTestRouters({ config: () => settings, now: () => time,
    exchange: async ({ code }) => { assert.equal(code, "auth-code"); return "private-token"; },
    storage: ({ accessToken }) => { assert.equal(accessToken, "private-token"); return {}; },
    probe: async () => ({ report: { documents: [{ kind: "bolletta", filename: "sample.pdf", verified: true }] },
      files: [{ filename: "sample.pdf", buffer: Buffer.from("%PDF-test") }] }), ...options });
  const app = express();
  app.use("/api/pcloud-test", routes.publicRouter);
  app.use((req, res, next) => {
    if (!req.headers["x-test-user"]) return res.status(401).end();
    req.user = { sub: req.headers["x-test-user"], role: req.headers["x-test-role"] || "ADMIN" };
    next();
  });
  app.use("/api/pcloud-test", routes.protectedRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => { routes.dispose(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/pcloud-test`;
  const request = (path, { user = "admin-one", role = "ADMIN", method = "GET" } = {}) => fetch(`${base}${path}`, {
    headers: user ? { "x-test-user": user, "x-test-role": role } : {}, method, redirect: "manual",
  });
  return { request, expire: () => { time += 16 * 60 * 1000; } };
}

test("hosted config requires HTTPS origins and stores secrets only on the backend", () => {
  const env = { PCLOUD_CLIENT_ID: "app", PCLOUD_CLIENT_SECRET: "secret", RENDER_EXTERNAL_URL: "https://backend.example",
    PCLOUD_TEST_FRONTEND_URL: "https://frontend.example" };
  assert.equal(getConfig(env).callbackUrl, settings.callbackUrl);
  assert.equal(getConfig(env).frontendUrl, settings.frontendUrl);
  for (const value of ["http://frontend.example", "https://frontend.example/path", "https://user:pass@frontend.example", "https://frontend.example?token=x"]) {
    assert.equal(getConfig({ ...env, PCLOUD_TEST_FRONTEND_URL: value }), null);
  }
  assert.equal(getConfig({ ...env, PCLOUD_CLIENT_SECRET: "" }), null);
});

test("settings and starting tests require an authenticated admin", async t => {
  const { request } = await fixture(t);
  assert.equal((await request("/settings", { user: null })).status, 401);
  for (const role of ["REVIEWER", "AMMINISTRATORE"]) {
    assert.equal((await request("/settings", { role })).status, 403);
    assert.equal((await request("/sessions", { role, method: "POST" })).status, 403);
  }
  const response = await request("/settings");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.deepEqual(data, { configured: true, callbackUrl: settings.callbackUrl });
  assert.equal(JSON.stringify(data).includes("secret"), false);
});

test("unconfigured connection stays disabled instead of attempting uploads", async t => {
  const { request } = await fixture(t, { config: () => null });
  assert.equal((await (await request("/settings")).json()).configured, false);
  assert.equal((await request("/sessions", { method: "POST" })).status, 503);
});

test("hosted callback runs the probe once and returns to the fixed frontend", async t => {
  let probes = 0;
  const { request } = await fixture(t, { probe: async () => {
    probes++;
    return { report: { documents: [{ kind: "bolletta", filename: "sample.pdf" }] },
      files: [{ filename: "sample.pdf", buffer: Buffer.from("%PDF-test") }] };
  } });
  const started = await (await request("/sessions", { method: "POST" })).json();
  const auth = new URL(started.authorizeUrl);
  assert.equal(auth.searchParams.get("redirect_uri"), settings.callbackUrl);
  assert.equal(auth.searchParams.has("client_secret"), false);
  assert.equal((await request("/sessions", { method: "POST" })).status, 409);
  const forged = new URLSearchParams({ state: "forged", code: "auth-code", locationid: "2", hostname: "eapi.pcloud.com" });
  assert.equal((await request(`/callback?${forged}`, { user: null })).status, 400);
  forged.set("state", auth.searchParams.get("state"));
  const callback = await request(`/callback?${forged}`, { user: null });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get("location"), `${settings.frontendUrl}?session=${started.id}`);
  assert.equal(callback.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await request(`/callback?${forged}`, { user: null })).status, 400);
  const session = await (await request(`/sessions/${started.id}`)).json();
  assert.equal(session.status, "complete");
  assert.equal(probes, 1);
  assert.equal(JSON.stringify(session).includes("private-token"), false);
  assert.equal(JSON.stringify(session).includes(auth.searchParams.get("state")), false);
  for (const query of ["", "?download=1"]) {
    const pdf = await request(`/sessions/${started.id}/documents/bolletta${query}`);
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get("content-type"), /application\/pdf/);
    assert.match(pdf.headers.get("content-disposition"), query ? /attachment/ : /inline/);
    assert.equal(await pdf.text(), "%PDF-test");
  }
  assert.equal((await request(`/sessions/${started.id}/documents/prospetto`)).status, 404);
  assert.equal((await request(`/sessions/${started.id}`, { user: "other-admin" })).status, 404);
  assert.equal((await request(`/sessions/${started.id}/documents/bolletta`, { user: "other-admin" })).status, 404);
  assert.equal((await request(`/sessions/${started.id}/documents/bolletta`, { role: "AMMINISTRATORE" })).status, 403);
});

test("wrong region or declined consent fails without running the probe", async t => {
  let probes = 0;
  const { request } = await fixture(t, { probe: async () => { probes++; } });
  for (const denied of [false, true]) {
    const started = await (await request("/sessions", { method: "POST" })).json();
    const state = new URL(started.authorizeUrl).searchParams.get("state");
    const params = new URLSearchParams({ state, code: "auth-code", hostname: "api.pcloud.com", locationid: "1" });
    if (denied) params.set("error", "access_denied");
    assert.equal((await request(`/callback?${params}`, { user: null })).status, 303);
    assert.equal((await (await request(`/sessions/${started.id}`)).json()).status, "failed");
  }
  assert.equal(probes, 0);
});

test("failed exchanges expose no secrets and expired sessions cannot receive callbacks", async t => {
  const { request, expire } = await fixture(t, { exchange: async () => { throw new Error("secret private-token"); } });
  const started = await (await request("/sessions", { method: "POST" })).json();
  const state = new URL(started.authorizeUrl).searchParams.get("state");
  const params = new URLSearchParams({ state, code: "auth-code", hostname: "eapi.pcloud.com", locationid: "2" });
  await request(`/callback?${params}`, { user: null });
  const failed = await (await request(`/sessions/${started.id}`)).json();
  assert.equal(failed.status, "failed");
  assert.equal(JSON.stringify(failed).includes("private-token"), false);
  expire();
  assert.equal((await request(`/sessions/${started.id}`)).status, 404);
  assert.equal((await request(`/callback?${params}`, { user: null })).status, 400);
  assert.equal((await request("/sessions", { method: "POST" })).status, 201);
});
