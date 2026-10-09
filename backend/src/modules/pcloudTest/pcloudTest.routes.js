const express = require("express");
const crypto = require("crypto");
const { requireRole } = require("../auth/auth.middleware");
const { createPcloudStorage, exchangeCode } = require("../../utils/pcloudStorage");
const { runProbe, validateCallback } = require("../../../scripts/test-pcloud-storage");

const SESSION_MS = 15 * 60 * 1000;
const CALLBACK_PATH = "/api/pcloud-test/callback";
const PAGE_PATH = "/admin/pcloud-test";

function getConfig(env = process.env) {
  try {
    const backend = new URL(env.PCLOUD_TEST_BACKEND_URL || env.RENDER_EXTERNAL_URL);
    const frontend = new URL(env.PCLOUD_TEST_FRONTEND_URL);
    for (const url of [backend, frontend]) {
      if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
        return null;
      }
    }
    if (!env.PCLOUD_CLIENT_ID || !env.PCLOUD_CLIENT_SECRET) return null;
    return { clientId: env.PCLOUD_CLIENT_ID, clientSecret: env.PCLOUD_CLIENT_SECRET,
      callbackUrl: `${backend.origin}${CALLBACK_PATH}`, frontendUrl: `${frontend.origin}${PAGE_PATH}` };
  } catch { return null; }
}

// Short-lived test data only. A restart expires the test; no OAuth token is persisted.
// Use a single backend instance for this probe, not a shared production storage session.
function createPcloudTestRouters({ config = () => getConfig(), exchange = exchangeCode,
  probe = runProbe, storage = createPcloudStorage, now = Date.now } = {}) {
  const sessions = new Map();
  const publicRouter = express.Router();
  const protectedRouter = express.Router();
  const prune = () => {
    for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id);
  };
  // Remove PDF buffers even if nobody polls after completing a test.
  const cleanup = setInterval(prune, 60000);
  cleanup.unref();
  publicRouter.use((req, res, next) => {
    res.set("Cache-Control", "no-store").set("Referrer-Policy", "no-referrer");
    next();
  });
  protectedRouter.use(requireRole("ADMIN"), (req, res, next) => {
    res.set("Cache-Control", "no-store");
    prune();
    next();
  });
  protectedRouter.get("/settings", (req, res) => {
    const settings = config();
    res.json({ configured: Boolean(settings), callbackUrl: settings?.callbackUrl || null });
  });
  protectedRouter.post("/sessions", (req, res) => {
    const settings = config();
    if (!settings) return res.status(503).json({ error: "Il collegamento pCloud non è ancora configurato sul server." });
    const owner = String(req.user.sub);
    if ([...sessions.values()].some(item => item.owner === owner && ["waiting", "testing"].includes(item.status))) {
      return res.status(409).json({ error: "Hai già un test in corso. Completa l'autorizzazione o attendi la scadenza della sessione." });
    }
    if (sessions.size >= 100) return res.status(429).json({ error: "Troppi test in corso. Riprova più tardi." });
    // Retain only the most recent finished test per operator.
    for (const [id, session] of sessions) if (session.owner === owner) sessions.delete(id);
    const id = crypto.randomUUID();
    const state = crypto.randomBytes(32).toString("hex");
    const session = { id, owner, state, status: "waiting", expiresAt: now() + SESSION_MS,
      frontendUrl: settings.frontendUrl, callbackUrl: settings.callbackUrl };
    sessions.set(id, session);
    const url = new URL("https://my.pcloud.com/oauth2/authorize");
    url.search = new URLSearchParams({ client_id: settings.clientId, response_type: "code",
      redirect_uri: settings.callbackUrl, state }).toString();
    res.status(201).json({ id, authorizeUrl: url.href, expiresAt: session.expiresAt });
  });
  function ownedSession(req, res, next) {
    const session = sessions.get(req.params.id);
    if (!session || session.owner !== String(req.user.sub)) {
      return res.status(404).json({ error: "Sessione di test scaduta o non disponibile. Avvia un nuovo test." });
    }
    req.pcloudTest = session;
    next();
  }
  protectedRouter.get("/sessions/:id", ownedSession, (req, res) => {
    const session = req.pcloudTest;
    res.json({ id: session.id, status: session.status, expiresAt: session.expiresAt,
      report: session.report || null, error: session.error || null });
  });
  protectedRouter.get("/sessions/:id/documents/:kind", ownedSession, (req, res) => {
    const session = req.pcloudTest;
    const document = session.report?.documents.find(item => item.kind === req.params.kind);
    const file = document && session.files?.find(item => item.filename === document.filename);
    if (session.status !== "complete" || !file) return res.status(404).json({ error: "PDF di prova non disponibile." });
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.type("application/pdf").set("X-Content-Type-Options", "nosniff")
      .set("Content-Disposition", `${disposition}; filename="${document.kind}-test.pdf"`).send(file.buffer);
  });
  publicRouter.get("/callback", (req, res) => {
    prune();
    const settings = config();
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const session = [...sessions.values()].find(item => item.state === state);
    if (!settings || !session || session.status !== "waiting") {
      return res.status(400).type("text").send("Autorizzazione scaduta o non riconosciuta. Torna alla piattaforma e avvia un nuovo test.");
    }
    const params = new URLSearchParams();
    for (const key of ["state", "hostname", "locationid", "code", "error"]) {
      if (typeof req.query[key] === "string") params.set(key, req.query[key]);
    }
    let code;
    try { code = validateCallback(params, session.state); }
    catch (error) {
      session.status = "failed";
      session.error = error.message;
    }
    if (code) {
      session.status = "testing"; // Consume the callback before exchanging its code.
      (async () => {
        try {
          const accessToken = await exchange({ clientId: settings.clientId, clientSecret: settings.clientSecret, code });
          const result = await probe(storage({ accessToken }), { runId: session.id });
          if (sessions.has(session.id) && session.expiresAt > now()) {
            session.report = result.report;
            session.files = result.files;
            session.status = "complete";
          }
        } catch {
          session.status = "failed";
          session.error = "Il test pCloud non è riuscito. Verifica l'autorizzazione e lo spazio disponibile, poi riprova.";
        }
      })();
    }
    const returnUrl = new URL(session.frontendUrl);
    returnUrl.searchParams.set("session", session.id);
    return res.redirect(303, returnUrl.href);
  });
  return { publicRouter, protectedRouter, dispose: () => { clearInterval(cleanup); sessions.clear(); } };
}

module.exports = { createPcloudTestRouters, getConfig };
