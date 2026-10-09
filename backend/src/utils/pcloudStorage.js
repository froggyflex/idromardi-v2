const axios = require("axios");
const FormData = require("form-data");

const EU_API = "https://eapi.pcloud.com";
const MAX_TEST_PDF_BYTES = 20 * 1024 * 1024;

// Do not propagate Axios errors: their request config contains OAuth secrets.
async function requestJson(http, method, body, headers = {}) {
  let response;
  try {
    response = await http.post(`${EU_API}/${method}`, body, {
      headers,
      timeout: 60000,
      maxRedirects: 0,
      maxBodyLength: MAX_TEST_PDF_BYTES + 65536,
      maxContentLength: 1024 * 1024,
    });
  } catch {
    throw new Error(`pCloud: richiesta ${method} non riuscita. Verifica la connessione e riprova.`);
  }
  const data = response.data;
  if (!data || data.result !== 0) {
    const code = Number.isInteger(data?.result) ? data.result : "risposta non valida";
    throw new Error(`pCloud: ${method} non riuscito (${code}).`);
  }
  return data;
}

function validId(value) {
  const text = String(value ?? "");
  if (!/^[1-9]\d*$/.test(text)) throw new Error("pCloud: identificativo non valido.");
  return text;
}

async function exchangeCode({ clientId, clientSecret, code, http = axios }) {
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code });
  const data = await requestJson(http, "oauth2_token", body.toString(), {
    "Content-Type": "application/x-www-form-urlencoded",
  });
  if (!data.access_token || data.token_type !== "bearer") {
    throw new Error("pCloud: autorizzazione non valida.");
  }
  return data.access_token;
}

function downloadUrl(link) {
  const host = link?.hosts?.[0];
  if (typeof host !== "string" || !/^(?:[a-z0-9-]+\.)*pcloud\.com$/i.test(host) ||
      typeof link.path !== "string" || !link.path.startsWith("/") || link.path.startsWith("//")) {
    throw new Error("pCloud: indirizzo di download non valido.");
  }
  const url = new URL(link.path, `https://${host}`);
  if (url.hostname.toLowerCase() !== host.toLowerCase() || url.username || url.password || url.hash) {
    throw new Error("pCloud: indirizzo di download non valido.");
  }
  return url.href;
}

function createPcloudStorage({ accessToken, http = axios }) {
  if (!accessToken) throw new Error("pCloud: autorizzazione mancante.");
  const api = (method, values = {}) => requestJson(http, method,
    new URLSearchParams({ access_token: accessToken, ...values }).toString(),
    { "Content-Type": "application/x-www-form-urlencoded" });

  return {
    async getCapacity() {
      const data = await api("userinfo");
      const capacity = { totalBytes: Number(data.quota), usedBytes: Number(data.usedquota) };
      if (!Number.isSafeInteger(capacity.totalBytes) || !Number.isSafeInteger(capacity.usedBytes) ||
          capacity.totalBytes < 0 || capacity.usedBytes < 0) {
        throw new Error("pCloud: spazio disponibile non verificabile.");
      }
      return { ...capacity, freeBytes: Math.max(0, capacity.totalBytes - capacity.usedBytes) };
    },
    async ensureTestFolder() {
      const data = await api("createfolderifnotexists", { folderid: "0", name: "Idromardi-test" });
      return validId(data.metadata?.folderid);
    },
    async uploadPdf({ folderId, filename, buffer }) {
      if (!/^[a-zA-Z0-9_.-]+\.pdf$/.test(filename) || !Buffer.isBuffer(buffer) ||
          buffer.length > MAX_TEST_PDF_BYTES || buffer.subarray(0, 4).toString() !== "%PDF") {
        throw new Error("pCloud: PDF di prova non valido.");
      }
      const form = new FormData();
      // pCloud requires parameters before file parts. Avoid overwriting any existing file.
      form.append("access_token", accessToken);
      form.append("folderid", validId(folderId));
      form.append("nopartial", "1");
      form.append("renameifexists", "1");
      form.append("file", buffer, { filename, contentType: "application/pdf" });
      const data = await requestJson(http, "uploadfile", form, form.getHeaders());
      return validId(data.fileids?.[0]);
    },
    async readPdf({ fileId, download = false }) {
      const link = await api("getfilelink", {
        fileid: validId(fileId),
        ...(download ? { forcedownload: "1" } : { contenttype: "application/pdf" }),
      });
      const url = downloadUrl(link);
      let response;
      try {
        // No OAuth token is forwarded to the content host. No browser referrer is needed.
        response = await http.get(url, {
          responseType: "arraybuffer", timeout: 60000, maxRedirects: 0,
          maxContentLength: MAX_TEST_PDF_BYTES,
        });
      } catch {
        throw new Error("pCloud: download del PDF non riuscito.");
      }
      const buffer = Buffer.from(response.data);
      if (buffer.subarray(0, 4).toString() !== "%PDF") {
        throw new Error("pCloud: il file ricevuto non e un PDF.");
      }
      return buffer;
    },
  };
}

module.exports = { EU_API, createPcloudStorage, exchangeCode, downloadUrl };
