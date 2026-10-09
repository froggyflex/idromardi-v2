const test = require("node:test");
const assert = require("node:assert/strict");
const { EU_API, createPcloudStorage, exchangeCode, downloadUrl } = require("../src/utils/pcloudStorage");
const { validateCallback, startAuthorization, samplePdf, runProbe } = require("./test-pcloud-storage");

test("OAuth only accepts the active session and the European endpoint", () => {
  const params = new URLSearchParams({ state: "expected", code: "code", hostname: "eapi.pcloud.com", locationid: "2" });
  assert.equal(validateCallback(params, "expected"), "code");
  assert.throws(() => validateCallback(params, "other"), /non riconosciuta/);
  for (const host of ["api.pcloud.com", "eapi.pcloud.com.evil.test", "127.0.0.1"]) {
    params.set("hostname", host);
    assert.throws(() => validateCallback(params, "expected"), /Europa/);
  }
  params.set("hostname", "eapi.pcloud.com");
  params.set("locationid", "1");
  assert.throws(() => validateCallback(params, "expected"), /Europa/);
  params.set("locationid", "2");
  params.delete("code");
  assert.throws(() => validateCallback(params, "expected"), /Codice/);
  params.set("error", "access_denied");
  assert.throws(() => validateCallback(params, "expected"), /non concessa/);
});

test("loopback callback rejects forged requests and exchanges a valid code only once", async t => {
  let exchanges = 0;
  const session = await startAuthorization({ clientId: "app", clientSecret: "secret", port: 0,
    exchange: async values => { exchanges++; assert.equal(values.code, "auth-code"); return "private-token"; } });
  t.after(session.close);
  const url = new URL(session.authorizeUrl);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.has("client_secret"), false);
  const callback = new URL(session.redirectUri);
  callback.search = new URLSearchParams({ code: "auth-code", state: "forged", hostname: "eapi.pcloud.com", locationid: "2" });
  assert.equal((await fetch(callback)).status, 400);
  assert.equal(exchanges, 0);
  callback.searchParams.set("state", url.searchParams.get("state"));
  const response = await fetch(callback);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.text()).includes("private-token"), false);
  assert.equal(await session.token, "private-token");
  assert.equal((await fetch(callback)).status, 409);
  assert.equal(exchanges, 1);
});

test("authorization wait times out and releases the callback server", async () => {
  const session = await startAuthorization({ clientId: "app", clientSecret: "secret", port: 0, timeoutMs: 25 });
  await assert.rejects(session.token, /scaduta/);
  session.close();
});

test("OAuth secrets are sent in a POST body and errors do not expose request configuration", async () => {
  const token = await exchangeCode({ clientId: "app", clientSecret: "secret", code: "code", http: {
    async post(url, body, options) {
      assert.equal(url, `${EU_API}/oauth2_token`);
      assert.equal(new URLSearchParams(body).get("client_secret"), "secret");
      assert.equal(options.maxRedirects, 0);
      return { data: { result: 0, access_token: "token", token_type: "bearer" } };
    },
  } });
  assert.equal(token, "token");
  await assert.rejects(exchangeCode({ clientId: "app", clientSecret: "SECRET", code: "code", http: {
    post: async () => { throw new Error("HTTP request failed: SECRET"); },
  } }), error => !error.message.includes("SECRET"));
});

test("content URLs cannot redirect requests to an unrelated host", () => {
  assert.equal(downloadUrl({ hosts: ["c63.pcloud.com"], path: "/hash/file.pdf" }), "https://c63.pcloud.com/hash/file.pdf");
  for (const link of [
    { hosts: ["pcloud.com.evil.test"], path: "/file" },
    { hosts: ["127.0.0.1"], path: "/file" },
    { hosts: ["pcloud.com:443"], path: "/file" },
    { hosts: ["c63.pcloud.com"], path: "//evil.test/file" },
    { hosts: ["c63.pcloud.com"], path: "/\\evil.test/file" },
    { hosts: ["c63.pcloud.com"], path: "https://evil.test/file" },
  ]) assert.throws(() => downloadUrl(link), /non valido/);
});

test("EU storage uploads PDFs without overwriting and fetches content without forwarding credentials", async () => {
  const pdf = await samplePdf("Bolletta di prova");
  const operations = [];
  const storage = createPcloudStorage({ accessToken: "private-token", http: {
    async post(url, body, options) {
      assert.equal(options.maxRedirects, 0);
      assert.ok(url.startsWith(`${EU_API}/`));
      const method = url.split("/").at(-1);
      operations.push(method);
      if (method === "uploadfile") {
        const form = body.getBuffer().toString();
        assert.ok(form.indexOf('name="folderid"') < form.indexOf('name="file"'));
        assert.match(form, /name="nopartial"\r\n\r\n1/);
        assert.match(form, /name="renameifexists"\r\n\r\n1/);
        return { data: { result: 0, fileids: [55] } };
      }
      const params = new URLSearchParams(body);
      assert.equal(params.get("access_token"), "private-token");
      if (method === "userinfo") return { data: { result: 0, quota: 100000, usedquota: 100, email: "unused@example.com" } };
      if (method === "createfolderifnotexists") {
        assert.equal(params.get("name"), "Idromardi-test");
        assert.equal(params.get("folderid"), "0");
        return { data: { result: 0, metadata: { folderid: 44 } } };
      }
      assert.equal(params.get("fileid"), "55");
      assert.ok(params.get("contenttype") === "application/pdf" || params.get("forcedownload") === "1");
      return { data: { result: 0, hosts: ["c1.pcloud.com"], path: "/hash/file.pdf" } };
    },
    async get(url, options) {
      assert.equal(url, "https://c1.pcloud.com/hash/file.pdf");
      assert.equal(options.headers, undefined);
      assert.equal(options.maxRedirects, 0);
      assert.equal(options.responseType, "arraybuffer");
      return { data: pdf };
    },
  } });
  assert.deepEqual(await storage.getCapacity(), { totalBytes: 100000, usedBytes: 100, freeBytes: 99900 });
  const folderId = await storage.ensureTestFolder();
  const fileId = await storage.uploadPdf({ folderId, filename: "sample.pdf", buffer: pdf });
  assert.ok((await storage.readPdf({ fileId })).equals(pdf));
  assert.ok((await storage.readPdf({ fileId, download: true })).equals(pdf));
  assert.deepEqual(operations, ["userinfo", "createfolderifnotexists", "uploadfile", "getfilelink", "getfilelink"]);
});

test("API errors, malformed files and unverified quota stop the probe", async () => {
  const storage = createPcloudStorage({ accessToken: "token", http: {
    post: async () => ({ data: { result: 2000, error: "token-secret" } }),
  } });
  await assert.rejects(storage.getCapacity(), /2000/);
  await assert.rejects(storage.uploadPdf({ folderId: "1", filename: "file.pdf", buffer: Buffer.from("not a pdf") }), /non valido/);
  const badQuota = createPcloudStorage({ accessToken: "token", http: {
    post: async () => ({ data: { result: 0 } }),
  } });
  await assert.rejects(badQuota.getCapacity(), /non verificabile/);
  const notPdf = createPcloudStorage({ accessToken: "token", http: {
    post: async () => ({ data: { result: 0, hosts: ["c1.pcloud.com"], path: "/file" } }),
    get: async () => ({ data: Buffer.from("error page") }),
  } });
  await assert.rejects(notPdf.readPdf({ fileId: "1" }), /non e un PDF/);
});

test("probe checks exact bytes in preview and download for both document types", async () => {
  const originals = new Map();
  const reads = [];
  const storage = {
    getCapacity: async () => ({ totalBytes: 100000, usedBytes: 0, freeBytes: 100000 }),
    ensureTestFolder: async () => "1",
    uploadPdf: async ({ filename, buffer }) => { originals.set(filename, buffer); return filename; },
    readPdf: async ({ fileId, download }) => { reads.push(Boolean(download)); return originals.get(fileId); },
  };
  const result = await runProbe(storage, { runId: "test-run" });
  assert.deepEqual(result.report.documents.map(item => item.kind), ["bolletta", "prospetto"]);
  assert.deepEqual(reads, [false, true, false, true]);
  assert.ok(result.report.documents.every(item => item.verified && item.pageCount === 1));
  assert.equal(result.files.length, 2);
  storage.readPdf = async () => Buffer.from("%PDFchanged");
  await assert.rejects(runProbe(storage), /Verifica contenuto/);
  storage.getCapacity = async () => ({ freeBytes: 0 });
  await assert.rejects(runProbe(storage), /insufficiente/);
});
