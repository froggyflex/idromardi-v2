const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const policy = require("./meta.policy");
const createAssets = require("./meta.assets");
const createOperations = require("./meta.operations");

const NOW = new Date("2026-08-28T12:00:00Z");
const context = {
  id: "conversation",
  channel_id: "channel",
  integration_id: "integration",
  contact_id: "contact",
  conversation_status: "OPEN",
  integration_status: "CONNECTED",
  channel_status: "ACTIVE",
  channel_type: "WHATSAPP",
  consent_status: "UNKNOWN",
  ai_mode: "OFF",
  reply_window_expires_at: "2099-08-29 12:00:00.000",
  external_contact_id: "391234567890",
};
function loadService(db, client = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("./meta.service"), "utf8") +
      "\nmodule.exports.testOnly={applyStatus,upsertInboundMessage,processStoredWebhook};",
    {
      module,
      exports: module.exports,
      Buffer,
      Date,
      console,
      setTimeout,
      process: { env: { META_GRAPH_API_VERSION: "v26.0" } },
      require(name) {
        if (name === "../../config/db") return db;
        if (name === "axios") return client;
        if (name === "./meta.crypto")
          return {
            decryptSecret: () => "test-token",
            encryptSecret: () => ({}),
          };
        return require(name);
      },
    },
  );
  return module.exports;
}
function connection(query) {
  return {
    query,
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
}
function validateBinds(sql, params = []) {
  assert.equal(
    (sql.match(/\?/g) || []).length,
    params.length,
    `Wrong bind count: ${sql}`,
  );
}

test("UTC interpretation is stable for MySQL, ISO and offsets", () => {
  for (const value of [
    "2026-08-28 12:00:00.000",
    "2026-08-28T12:00:00Z",
    "2026-08-28T15:00:00+03:00",
  ]) {
    assert.equal(policy.utcDate(value).toISOString(), NOW.toISOString());
  }
});

test("send checks enforce window, consent, channel, archive, expiry and AI approval", () => {
  policy.assertCanSend(context, { type: "text" }, NOW);
  for (const [change, code] of [
    [
      { reply_window_expires_at: "2026-08-28 11:00:00" },
      "META_REPLY_WINDOW_EXPIRED",
    ],
    [{ consent_status: "OPTED_OUT" }, "META_OPTED_OUT"],
    [{ conversation_status: "ARCHIVED" }, "META_CONVERSATION_CLOSED"],
    [{ channel_status: "PAUSED" }, "META_CHANNEL_NOT_CONNECTED"],
    [{ token_expires_at: "2026-08-28T11:00:00Z" }, "META_TOKEN_EXPIRED"],
    [{ requester_kind: "AI", approval_status: "APPROVED" }, "META_AI_DISABLED"],
    [{ deleted_at: "2026-08-28" }, "META_MESSAGE_DELETED"],
  ])
    assert.throws(
      () =>
        policy.assertCanSend({ ...context, ...change }, { type: "text" }, NOW),
      { code },
    );
  assert.throws(
    () => policy.assertCanSend(context, { type: "template" }, NOW),
    { code: "META_CONSENT_REQUIRED" },
  );
  policy.assertCanSend(
    { ...context, consent_status: "OPTED_IN", reply_window_expires_at: null },
    { type: "template" },
    NOW,
  );
  assert.throws(
    () =>
      policy.assertCanSend(
        { ...context, consent_status: "OPTED_IN", channel_type: "MESSENGER" },
        { type: "template" },
        NOW,
      ),
    { code: "META_TEMPLATE_CHANNEL" },
  );
});

test("uncertain sends are never automatically retried, safe reads can retry", () => {
  const timeout = Object.assign(new Error("request URL and token"), {
    code: "ETIMEDOUT",
  });
  assert.equal(policy.deliveryFailure(timeout).state, "UNCERTAIN");
  assert.equal(policy.deliveryFailure(timeout, "prepare").state, "RETRY");
  assert.equal(
    policy.deliveryFailure({ response: { status: 503, data: {} } }).state,
    "UNCERTAIN",
  );
  assert.equal(
    policy.deliveryFailure({
      response: { status: 400, data: { error: { code: 190 } } },
    }).state,
    "FAILED",
  );
  assert.equal(
    policy.deliveryFailure({
      response: { status: 429, data: { error: { code: 130429 } } },
    }).state,
    "RETRY",
  );
  assert.doesNotMatch(policy.safeError(timeout), /token|URL/);
});

test("idempotency keys are stable, conversation scoped and validated", () => {
  assert.equal(
    policy.requestKey("a", "1234567890123456"),
    policy.requestKey("a", "1234567890123456"),
  );
  assert.notEqual(
    policy.requestKey("a", "1234567890123456"),
    policy.requestKey("b", "1234567890123456"),
  );
  assert.throws(() => policy.requestKey("a", "short"), {
    code: "META_IDEMPOTENCY_REQUIRED",
  });
});

test("queue retries with the same key create one message and one job", async () => {
  let saved = null,
    insertions = 0;
  const query = async (sql, params = []) => {
    validateBinds(sql, params);
    if (sql.includes("WHERE m.idempotency_key")) return [saved ? [saved] : []];
    if (sql.includes("cv.status AS conversation_status")) return [[context]];
    if (sql.includes("INSERT INTO meta_messages")) {
      insertions++;
      saved = { messageId: params[0], jobId: "job", state: "READY" };
    }
    return [{ affectedRows: 1 }];
  };
  const db = { query, getConnection: async () => connection(query) };
  const service = loadService(db);
  const request = { text: "Ciao", idempotencyKey: "1234567890123456" };
  const first = await service.queueMessage("conversation", request, {
    sub: "operator",
  });
  const second = await service.queueMessage("conversation", request, {
    sub: "operator",
  });
  assert.equal(first.messageId, second.messageId);
  assert.equal(second.duplicate, true);
  assert.equal(insertions, 1);
});

test("durably stored webhook failure can be recovered on duplicate delivery", async () => {
  const stored = {
    id: "event",
    processing_status: "RECEIVED",
    payload_json: {
      object: "page",
      entry: [
        {
          id: "page",
          messaging: [
            {
              sender: { id: "customer" },
              recipient: { id: "page" },
              timestamp: Date.now(),
              message: { mid: "message", text: "ciao" },
            },
          ],
        },
      ],
    },
  };
  let fail = true,
    attempts = 0;
  const query = async (sql, params = []) => {
    validateBinds(sql, params);
    if (sql.includes("event_key =")) return [[stored]];
    if (sql.startsWith("SELECT * FROM meta_webhook_events")) {
      attempts++;
      return [[stored]];
    }
    if (sql.includes("FROM meta_channels c JOIN")) {
      if (fail) throw new Error("database interruption");
      return [[]];
    }
    if (sql.includes("processing_status = 'FAILED'"))
      stored.processing_status = "FAILED";
    else if (sql.includes("processing_status = ?"))
      stored.processing_status = params[0];
    return [{ affectedRows: 1 }];
  };
  const service = loadService({
    query,
    getConnection: async () => connection(query),
  });
  const first = await service.ingestWebhook(
    Buffer.from("payload"),
    stored.payload_json,
  );
  assert.equal(first.accepted, true);
  assert.equal(first.failed, true);
  fail = false;
  await service.ingestWebhook(Buffer.from("payload"), stored.payload_json);
  assert.equal(attempts, 2);
  assert.equal(stored.processing_status, "UNMATCHED");
});

test("late delivery receipts cannot downgrade read messages or discard attachments", async () => {
  const updates = [];
  const query = async (sql, params) => {
    if (sql.startsWith("SELECT id, status"))
      return [[{ id: "message", status: "READ" }]];
    updates.push(sql);
    return [{ affectedRows: 1 }];
  };
  const service = loadService({});
  const result = await service.testOnly.applyStatus(
    { query },
    { id: "channel" },
    { externalMessageId: "external", status: "DELIVERED" },
  );
  assert.equal(result, true);
  assert.equal(updates.length, 0);
  await service.testOnly.applyStatus(
    { query },
    { id: "channel" },
    { externalMessageId: "external", status: "READ" },
  );
  assert.ok(updates.some((sql) => sql.includes("status_payload_json")));
  assert.ok(updates.every((sql) => !/(?:SET|,)\s*payload_json\s*=/.test(sql)));
});

test("missing early receipt remains replayable", async () => {
  const service = loadService({});
  assert.equal(
    await service.testOnly.applyStatus(
      { query: async () => [[]] },
      { id: "ch" },
      { externalMessageId: "m", status: "SENT" },
    ),
    false,
  );
});

test("duplicate inbound tombstones do not reopen conversations or increase unread", async () => {
  const calls = [];
  const service = loadService({});
  await service.testOnly.upsertInboundMessage(
    {
      query: async (sql) => {
        calls.push(sql);
        return [[{ id: "deleted" }]];
      },
    },
    { id: "ch" },
    { contactId: "contact", externalMessageId: "m" },
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /SELECT id FROM meta_messages/);
});

test("message echo is outbound, never starts the customer reply window", async () => {
  const writes = [];
  const query = async (sql, params) => {
    validateBinds(sql, params);
    if (sql.startsWith("SELECT id FROM meta_messages")) return [[]];
    if (sql.startsWith("SELECT id FROM meta_contacts"))
      return [[{ id: "contact" }]];
    if (sql.startsWith("SELECT id FROM meta_conversations"))
      return [[{ id: "conversation" }]];
    writes.push({ sql, params });
    return [{ affectedRows: 1 }];
  };
  await loadService({}).testOnly.upsertInboundMessage(
    { query },
    { id: "ch", integration_id: "i" },
    {
      contactId: "customer",
      externalMessageId: "echo",
      isEcho: true,
      channelType: "MESSENGER",
      messageType: "text",
      text: "test",
      occurredAt: NOW,
    },
  );
  assert.equal(
    writes.find((w) => w.sql.includes("INSERT IGNORE INTO meta_messages"))
      .params[4],
    "OUTBOUND",
  );
  const update = writes.find((w) =>
    w.sql.includes("UPDATE meta_conversations"),
  );
  assert.equal(update.params[5], 1);
  assert.equal(update.params[6], 0);
});

function outboundFixture({
  failSend = false,
  changed = false,
  commitLost = false,
} = {}) {
  const job = {
    id: "job",
    message_id: "message",
    conversation_id: "conversation",
    channel_id: "channel",
    integration_id: "integration",
    channel_type: "WHATSAPP",
    external_account_id: "phone",
    external_contact_id: "customer",
    encrypted_access_token: "encrypted",
    requester_kind: "HUMAN",
    approval_status: "APPROVED",
    attempt_count: 0,
    body_text: "ciao",
  };
  const changes = [];
  let sends = 0;
  const query = async (sql, params = []) => {
    validateBinds(sql, params);
    if (sql.includes("SELECT j.*, m.channel_id")) return [[job]];
    if (sql.includes("cv.status AS conversation_status")) return [[context]];
    if (sql.includes("SELECT j.state, m.deleted_at"))
      return [
        [
          {
            state: "PROCESSING",
            encrypted_access_token: changed
              ? "new"
              : job.encrypted_access_token,
          },
        ],
      ];
    changes.push({ sql, params });
    return [
      {
        affectedRows:
          commitLost && sql.includes("AND state = 'PROCESSING'") ? 0 : 1,
      },
    ];
  };
  let connections = 0;
  const db = {
    query,
    getConnection: async () => {
      connections++;
      const c = connection(query);
      if (commitLost && connections === 2)
        c.commit = async () => {
          throw new Error("response lost after committed");
        };
      return c;
    },
  };
  const service = loadService(db, {
    post: async () => {
      sends++;
      if (failSend) throw new Error("response lost");
      return { data: { messages: [{ id: "wamid.real" }] } };
    },
  });
  return { service, changes, sends: () => sends };
}

test("worker places lost send responses in UNCERTAIN without a retry schedule", async () => {
  const f = outboundFixture({ failSend: true });
  const result = await f.service.processNextOutbound();
  assert.equal(result.state, "UNCERTAIN");
  assert.equal(result.retry, false);
  assert.equal(f.sends(), 1);
  assert.ok(f.changes.some((c) => c.params[0] === "UNCERTAIN"));
});
test("credential changes between claim and dispatch prevent network send", async () => {
  const f = outboundFixture({ changed: true });
  const result = await f.service.processNextOutbound();
  assert.equal(result.state, "FAILED");
  assert.equal(f.sends(), 0);
});
test("ambiguous commit cannot overwrite a job already committed SENT", async () => {
  const f = outboundFixture({ commitLost: true });
  await f.service.processNextOutbound();
  assert.equal(f.sends(), 1);
  assert.ok(
    !f.changes.some((c) => c.sql.includes("external_message_id = COALESCE")),
  );
});

test("retrying an uncertain job requires explicit acknowledgement", async () => {
  const conn = connection(async () => [
    [{ state: "UNCERTAIN", message_id: "m", conversation_id: "conversation" }],
  ]);
  const ops = createOperations({
    db: { getConnection: async () => conn },
    messageContext: async () => context,
  });
  await assert.rejects(
    () => ops.controlJob("job", { action: "retry" }, { sub: "operator" }),
    { code: "META_DUPLICATE_RISK" },
  );
});
test("recording opt-in requires evidence, not merely opening a lead", async () => {
  const ops = createOperations({ db: {} });
  await assert.rejects(
    () =>
      ops.consent(
        "contact",
        { status: "OPTED_IN", note: "" },
        { sub: "operator" },
      ),
    { code: "META_CONSENT_EVIDENCE" },
  );
  await assert.rejects(
    () => ops.startWhatsApp({ phone: "123", channelId: "ch" }, {}),
    { code: "META_PHONE_INVALID" },
  );
});

test("media validation blocks active content and arbitrary server fetches", () => {
  assert.equal(
    createAssets.identifyFile(Buffer.from("%PDF-1.7 test")).mime,
    "application/pdf",
  );
  assert.throws(
    () =>
      createAssets.identifyFile(Buffer.from("<svg><script>bad</script></svg>")),
    { code: "META_MEDIA_TYPE" },
  );
  assert.throws(
    () => createAssets.identifyFile(Buffer.alloc(8 * 1024 * 1024 + 1)),
    { code: "META_MEDIA_SIZE" },
  );
  for (const url of [
    "http://lookaside.fbsbx.com/a",
    "https://127.0.0.1/a",
    "https://facebook.com.evil.test/a",
    "https://token@fbcdn.net/a",
  ])
    assert.throws(() => createAssets.mediaUrl(url));
  assert.equal(
    createAssets.mediaUrl("https://lookaside.fbsbx.com/a"),
    "https://lookaside.fbsbx.com/a",
  );
});

test("template header/body placeholders stay distinct; unsupported templates are disabled", () => {
  const template = createAssets.templateDefinition({
    id: "1",
    components: [
      { type: "HEADER", format: "TEXT", text: "Ciao {{1}}" },
      { type: "BODY", text: "Saldo {{1}}" },
    ],
  });
  assert.deepEqual(
    template.parameters.map((p) => p.key),
    ["header:1", "body:1"],
  );
  assert.equal(template.preview, "Ciao {{header:1}}\nSaldo {{body:1}}");
  assert.equal(
    createAssets.templateDefinition({
      components: [{ type: "HEADER", format: "IMAGE" }],
    }).supported,
    false,
  );
  assert.equal(
    createAssets.templateDefinition({
      components: [
        {
          type: "BUTTONS",
          buttons: [{ type: "URL", url: "https://example.com/{{1}}" }],
        },
      ],
    }).supported,
    false,
  );
});

test("signed media URLs expire and cannot be used for another attachment", async () => {
  const previous = process.env.META_CREDENTIALS_ENCRYPTION_KEY;
  process.env.META_CREDENTIALS_ENCRYPTION_KEY = "test-only-secret";
  try {
    const assets = createAssets({
      db: { query: async () => [[{ content: Buffer.from("test") }]] },
    });
    const expires = Math.floor(Date.now() / 1000) + 600;
    const signature = crypto
      .createHmac("sha256", "test-only-secret")
      .update(`meta-media:file:${expires}`)
      .digest("hex");
    assert.ok((await assets.publicMedia("file", expires, signature)).content);
    await assert.rejects(
      () => assets.publicMedia("other", expires, signature),
      { code: "META_MEDIA_INVALID" },
    );
    await assert.rejects(
      () => assets.publicMedia("file", expires - 601, signature),
      { code: "META_MEDIA_EXPIRED" },
    );
  } finally {
    if (previous === undefined)
      delete process.env.META_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.META_CREDENTIALS_ENCRYPTION_KEY = previous;
  }
});

test("payload erasure removes one contact without deleting another batched message", () => {
  const payload = {
    entry: [
      {
        id: "page",
        messaging: [
          { sender: { id: "a" }, message: { mid: "one", text: "private" } },
          { sender: { id: "b" }, message: { mid: "two", text: "keep" } },
        ],
      },
    ],
  };
  const result = policy.redactPayload(payload, new Set(["a", "one"]));
  assert.equal(result.entry[0].messaging.length, 1);
  assert.equal(result.entry[0].messaging[0].message.text, "keep");
});

test("maintenance recovers stale leads and deletes only abandoned uploads", async () => {
  const queries = [];
  const ops = createOperations({
    db: {
      query: async (sql) => {
        queries.push(sql);
        return [[]];
      },
    },
  });
  await ops.maintenance();
  assert.match(queries[0], /hydration_status='PROCESSING'/);
  assert.match(queries[0], /hydration_locked_at IS NULL/);
  assert.match(queries[1], /message_id IS NULL/);
});

test("erasure stays within the selected account when envelopes contain other channels", () => {
  const change = (id) => ({
    value: {
      metadata: { phone_number_id: id },
      contacts: [{ wa_id: "customer" }],
      messages: [{ from: "customer", id: "mid" }],
    },
  });
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [change("own"), change("other")] }],
  };
  const result = policy.redactChannelPayload(
    payload,
    "WHATSAPP",
    new Set(["own"]),
    new Set(["customer", "mid"]),
  );
  assert.equal(result.entry[0].changes[0].value.messages.length, 0);
  assert.equal(result.entry[0].changes[1].value.messages.length, 1);
});

test("template preparation validates WABA ownership, values and approval again at dispatch", async () => {
  const previous = process.env.META_CREDENTIALS_ENCRYPTION_KEY;
  process.env.META_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
    "base64",
  );
  try {
    const secret = require("./meta.crypto").encryptSecret("fixture-token");
    const channel = {
      id: "channel",
      channel_type: "WHATSAPP",
      business_account_id: "own-waba",
      graph_api_version: "v26.0",
      encrypted_access_token: secret.encrypted,
      token_iv: secret.iv,
      token_auth_tag: secret.authTag,
    };
    let approved = true;
    let reads = 0;
    const assets = createAssets({
      db: { query: async () => [[channel]] },
      client: {
        get: async (url) => {
          reads++;
          assert.equal(
            url,
            "https://graph.facebook.com/v26.0/own-waba/message_templates",
          );
          return {
            data: {
              data: [
                {
                  id: "123",
                  name: "appointment",
                  language: "it",
                  status: approved ? "APPROVED" : "PAUSED",
                  components: [
                    { type: "HEADER", format: "TEXT", text: "Ciao {{1}}" },
                    { type: "BODY", text: "Visita {{1}}" },
                  ],
                },
              ],
            },
          };
        },
      },
    });
    const input = {
      id: "123",
      name: "appointment",
      values: { "header:1": "Mario", "body:1": "domani" },
    };
    const prepared = await assets.prepareTemplate("channel", input);
    assert.equal(prepared.preview, "Ciao Mario\nVisita domani");
    assert.equal(prepared.template.components[0].parameters[0].text, "Mario");
    assert.equal(prepared.template.components[1].parameters[0].text, "domani");
    await assert.rejects(
      () => assets.prepareTemplate("channel", { ...input, id: "other" }),
      { code: "META_TEMPLATE_INVALID" },
    );
    await assert.rejects(
      () => assets.prepareTemplate("channel", { ...input, id: "456" }),
      { code: "META_TEMPLATE_NOT_FOUND" },
    );
    await assert.rejects(
      () => assets.prepareTemplate("channel", { ...input, values: {} }),
      { code: "META_TEMPLATE_PARAMETER" },
    );
    approved = false;
    await assert.rejects(
      () =>
        assets.buildSendBody(
          {
            channel_id: "channel",
            channel_type: "WHATSAPP",
            external_account_id: "phone",
          },
          prepared,
          "fixture-token",
          "v26.0",
        ),
      { code: "META_TEMPLATE_UNAVAILABLE" },
    );
    assert.equal(reads, 4);
  } finally {
    if (previous === undefined)
      delete process.env.META_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.META_CREDENTIALS_ENCRYPTION_KEY = previous;
  }
});

test("conversation filter and message cursor remain parameterized", async () => {
  const calls = [];
  const service = loadService({
    query: async (sql, params) => {
      validateBinds(sql, params);
      calls.push({ sql, params });
      return [[]];
    },
  });
  await service.listConversations({
    id: "conv",
    search: "%' OR 1=1",
    offset: "12.5",
    limit: "20.5",
    status: "ALL",
  });
  assert.match(calls[0].sql, /cv.id = \?/);
  assert.ok(!calls[0].sql.includes("OR 1=1"));
  assert.deepEqual(Array.from(calls[0].params), ["conv", "%' OR 1=1", 21, 12]);
  await assert.rejects(
    () => service.listMessages("conv", { before: "belongs-elsewhere" }),
    { code: "META_CURSOR_INVALID" },
  );
});
