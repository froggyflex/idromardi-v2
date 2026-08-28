// Local-only visual/interaction fixture. No database, secrets, or Meta API calls.
// Run: node tests/meta-ui-fixture.mjs, then open the printed local URL.
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const now = new Date().toISOString();
const future = new Date(Date.now() + 86400000).toISOString();
const channels = ["WHATSAPP", "MESSENGER", "INSTAGRAM"].map((type, index) => ({
  id: `channel-${index}`,
  integration_id: "integration",
  channel_type: type,
  external_account_id: `12345${index}`,
  display_name: `Assistenza ${type}`,
  status: "ACTIVE",
  has_access_token: 1,
  token_expires_at: future,
  credential_mode: type === "INSTAGRAM" ? "INSTAGRAM_LOGIN" : null,
  leads_enabled: type === "MESSENGER" ? 1 : 0,
}));
const conversations = channels.map((ch, index) => ({
  id: `conversation-${index}`,
  channel_id: ch.id,
  contact_id: `contact-${index}`,
  channel_type: ch.channel_type,
  channel_status: "ACTIVE",
  status: "OPEN",
  display_name: ["Mario Rossi", "Giulia Bianchi", "Studio Verdi"][index],
  external_contact_id: `39123456789${index}`,
  unread_count: index === 0 ? 2 : 0,
  last_message_at: now,
  last_message_text: "Buongiorno, vorrei informazioni sul servizio.",
  consent_status: "OPTED_IN",
  consent_note: "Modulo di prova, consenso simulato",
  reply_window_expires_at: future,
}));
const messages = new Map(
  conversations.map((cv) => [
    cv.id,
    [
      {
        id: `in-${cv.id}`,
        direction: "INBOUND",
        sender_kind: "CONTACT",
        body_text: "Buongiorno, vorrei informazioni sul servizio.",
        status: "RECEIVED",
        occurred_at: now,
        attachments: [{ index: 0, type: "document", name: "Richiesta.pdf" }],
      },
    ],
  ]),
);
const overview = {
  counts: {
    active_leads: 2,
    open_conversations: 3,
    unread_messages: 2,
    queued_messages: 0,
    failed_messages: 1,
  },
  integrations: [
    {
      id: "integration",
      name: "Idromardi — simulazione locale",
      status: "CONNECTED",
      ai_mode: "OFF",
      app_id: "1965478457453791",
      business_account_id: "123456",
      graph_api_version: "v26.0",
      updated_at: now,
    },
  ],
  channels,
  webhookConfigured: true,
  encryptionConfigured: true,
  outboxWorkerEnabled: true,
  instagramLogin: {
    appId: "1007783208974158",
    appSecretConfigured: true,
    verifyTokenConfigured: true,
  },
  webhookDiagnostics: {
    recentEvents: [],
    processed: 15,
    failed: 0,
    unmatched: 0,
  },
};
const jobs = [
  {
    id: "job-1",
    state: "UNCERTAIN",
    display_name: "Giulia Bianchi",
    external_contact_id: "test",
    channel_type: "MESSENGER",
    body_text: "La contatteremo domani.",
    last_error:
      "Esito non confermato. Verifica con il destinatario prima di riprovare.",
    attempt_count: 1,
    created_at: now,
  },
];
const leads = [
  {
    id: "lead-1",
    contact_id: "contact-1",
    status: "NEW",
    display_name: "Laura Esposito",
    phone: "+391234567890",
    email: "laura@example.test",
    external_lead_id: "lead-test",
    received_at: now,
    hydration_status: "COMPLETE",
    notes: "Richiesta di preventivo",
    follow_up_at: future,
    field_data_json: [
      { name: "Servizio richiesto", values: ["Lettura contatori"] },
      { name: "Condominio", values: ["Via Roma 12"] },
    ],
  },
];
const templates = [
  {
    id: "123",
    name: "conferma_appuntamento",
    language: "it",
    status: "APPROVED",
    supported: true,
    preview: "Buongiorno {{body:1}}, confermiamo la visita il {{body:2}}.",
    parameters: [
      { key: "body:1", label: "1", component: "body" },
      { key: "body:2", label: "2", component: "body" },
    ],
  },
];
const fixture = {
  name: "meta-ui-fixture",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith("/api/")) return next();
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      const url = new URL(req.url, "http://127.0.0.1");
      let body = {};
      if (!String(req.headers["content-type"]).includes("multipart")) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        try {
          body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        } catch {}
      }
      const send = (value) => res.end(JSON.stringify(value));
      if (url.pathname === "/api/auth/login")
        return send({
          token: "local-fixture-only",
          user: { id: "operator", username: "operatore-test", role: "ADMIN" },
        });
      if (url.pathname === "/api/meta/overview") return send(overview);
      if (url.pathname === "/api/meta/unread")
        return send({
          total: 2,
          conversations: 1,
          byChannel: { whatsapp: 2, messenger: 0, instagram: 0 },
        });
      if (url.pathname === "/api/meta/conversations")
        return send({
          conversations: conversations.filter(
            (cv) =>
              (!url.searchParams.get("id") ||
                url.searchParams.get("id") === cv.id) &&
              (!url.searchParams.get("channel") ||
                url.searchParams.get("channel") === "ALL" ||
                cv.channel_type === url.searchParams.get("channel")) &&
              (url.searchParams.get("status") === "ARCHIVED"
                ? cv.status === "ARCHIVED"
                : url.searchParams.get("status") === "ALL" ||
                  cv.status !== "ARCHIVED") &&
              cv.display_name
                .toLowerCase()
                .includes((url.searchParams.get("search") || "").toLowerCase()),
          ),
          hasMore: false,
        });
      const messageMatch = url.pathname.match(
        /\/conversations\/([^/]+)\/(messages|read)$/,
      );
      if (messageMatch) {
        const id = messageMatch[1];
        if (req.method === "POST" && messageMatch[2] === "messages") {
          messages
            .get(id)
            .push({
              id: crypto.randomUUID(),
              direction: "OUTBOUND",
              body_text: body.text || "Template/allegato di prova",
              status: "QUEUED",
              occurred_at: new Date().toISOString(),
            });
          return send({ jobId: "local-send" });
        }
        return send({
          messages: messages.get(id) || [],
          hasMore: !url.searchParams.has("before"),
        });
      }
      const update = url.pathname.match(/\/conversations\/([^/]+)$/);
      if (update && req.method === "PATCH") {
        Object.assign(
          conversations.find((cv) => cv.id === update[1]) || {},
          body,
        );
        return send({ ok: true });
      }
      if (url.pathname === "/api/meta/outbox")
        return send({
          jobs: jobs.filter(
            (job) =>
              url.searchParams.get("state") === "ALL" ||
              url.searchParams.get("state") === "ATTENTION" ||
              job.state === url.searchParams.get("state"),
          ),
          hasMore: false,
        });
      if (url.pathname === "/api/meta/outbox/process")
        return send({ processed: true, sent: true });
      if (url.pathname.startsWith("/api/meta/outbox/")) {
        const job = jobs.find((j) => j.id === url.pathname.split("/").pop());
        if (job) job.state = body.action === "cancel" ? "CANCELLED" : "READY";
        return send({ ok: true });
      }
      if (url.pathname === "/api/meta/leads")
        return send({ leads, hasMore: false });
      if (
        url.pathname.startsWith("/api/meta/leads/") &&
        req.method === "PATCH"
      ) {
        Object.assign(leads[0], body, { follow_up_at: body.followUpAt });
        return send({ ok: true });
      }
      if (url.pathname.endsWith("/templates"))
        return send({ templates, next: null });
      if (url.pathname.includes("/attachments/")) {
        res.setHeader("Content-Type", "application/pdf");
        return res.end("%PDF-1.7 Local fixture");
      }
      if (url.pathname.endsWith("/attachments") && req.method === "POST")
        return send({ id: "fixture-attachment" });
      res.statusCode = 404;
      return send({
        error: "Azione non simulata: nessuna richiesta è stata inoltrata.",
      });
    });
  },
};
const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
  plugins: [fixture],
  server: { host: "127.0.0.1", port: 5187, strictPort: true },
});
await server.listen();
console.log("Meta simulated UI: http://127.0.0.1:5187/admin/meta-business");
