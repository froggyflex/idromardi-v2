const assert = require("node:assert/strict");
const test = require("node:test");
const {
  INSTAGRAM_CREDENTIAL_MODES,
  detectInstagramCredentialMode,
  instagramApiTarget,
  missingScopes,
  resolveInstagramMode,
  verificationStep,
  verifyInstagramConnection,
} = require("./meta.instagram");

test("detects the Page-linked Instagram credential model", () => {
  const scopes = ["instagram_basic", "instagram_manage_messages", "pages_manage_metadata"];
  assert.equal(
    detectInstagramCredentialMode(scopes),
    INSTAGRAM_CREDENTIAL_MODES.FACEBOOK_LOGIN
  );
  assert.deepEqual(missingScopes(scopes, scopes), []);
});

function fixture({ mode = "INSTAGRAM_LOGIN", profile, subscription = { success: true } } = {}) {
  const calls = [];
  const input = {
    channel: { credential_mode: mode, external_account_id: "ig-1", app_id: "main-app" },
    token: "fake-private-instagram-token",
    version: "v26.0",
    config: { instagramAppId: "1007783208974158", instagramAppSecret: "fake-ig-secret",
      mainAppSecret: "fake-main-secret", verifyToken: "fake-verify-token" },
    sleep: async () => {},
    client: {
      get: async (url, options) => {
        calls.push({ method: "GET", url, options });
        return { data: profile || { user_id: "ig-1", username: "test-business", account_type: "BUSINESS" } };
      },
      post: async (url, data, options) => {
        calls.push({ method: "POST", url, data, options });
        return { data: subscription };
      },
    },
    inspectToken: async () => { throw new Error("Native Instagram must NOT use Facebook token introspection"); },
  };
  return { input, calls };
}

test("explicit mode is validated and existing Facebook Login mode is preserved", () => {
  assert.equal(resolveInstagramMode(undefined, "FACEBOOK_LOGIN"), "FACEBOOK_LOGIN");
  assert.equal(resolveInstagramMode("INSTAGRAM_LOGIN", "FACEBOOK_LOGIN"), "INSTAGRAM_LOGIN");
  assert.equal(resolveInstagramMode(undefined), null);
  assert.throws(() => resolveInstagramMode("AUTO"), { code: "META_INSTAGRAM_MODE_INVALID" });
});

test("native Instagram token validates on Instagram without Facebook debugger or main app credentials", async () => {
  const { input, calls } = fixture();
  delete input.channel.app_id;
  delete input.config.mainAppSecret;
  const result = await verifyInstagramConnection(input);
  assert.equal(result.instagramId, "ig-1");
  assert.equal(result.credentialMode, "INSTAGRAM_LOGIN");
  assert.equal(result.configuredAppId, "1007783208974158");
  assert.equal(result.validationMethod, "INSTAGRAM_PROFILE_AND_SUBSCRIPTION");
  assert.equal(result.scopes, undefined); // Do not invent introspected permissions or expiry.
  assert.deepEqual(calls.map(({ method, url }) => ({ method, url })), [
    { method: "GET", url: "https://graph.instagram.com/v26.0/me" },
    { method: "POST", url: "https://graph.instagram.com/v26.0/ig-1/subscribed_apps" },
  ]);
  assert.equal(calls[1].options.params.subscribed_fields, "messages,messaging_postbacks,messaging_seen");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${input.token}`);
  assert.equal(calls[0].options.maxRedirects, 0);
  assert.equal(JSON.stringify(result).includes(input.token), false);
});

test("native Instagram accepts the documented array-shaped profile", async () => {
  const { input } = fixture({ profile: { data: [{ user_id: "ig-1", username: "test-business" }] } });
  assert.equal((await verifyInstagramConnection(input)).instagramId, "ig-1");
});

test("wrong or missing native account ID blocks subscription, with no Facebook fallback", async () => {
  for (const profile of [{ user_id: "other-account" }, { id: "ig-1" }, { data: [] }]) {
    const { input, calls } = fixture({ profile });
    await assert.rejects(verifyInstagramConnection(input), (error) => {
      assert.equal(error.code, "META_INSTAGRAM_MISMATCH");
      assert.equal(error.verification.stage, "Account e token Instagram");
      return true;
    });
    assert.equal(calls.length, 1);
  }
});

test("native configuration and explicit login mode are required before network access", async () => {
  for (const key of ["instagramAppId", "instagramAppSecret", "verifyToken"]) {
    const { input, calls } = fixture();
    delete input.config[key];
    await assert.rejects(verifyInstagramConnection(input), /Configurazione Instagram/);
    assert.equal(calls.length, 0);
  }
  const { input, calls } = fixture({ mode: null });
  await assert.rejects(verifyInstagramConnection(input), /Seleziona il tipo/);
  assert.equal(calls.length, 0);
});

test("native verification requires an explicit successful webhook subscription", async () => {
  for (const subscription of [{}, { success: false }, { success: "false" }]) {
    const { input } = fixture({ subscription });
    await assert.rejects(verifyInstagramConnection(input), (error) => {
      assert.equal(error.code, "META_INSTAGRAM_SUBSCRIPTION_FAILED");
      assert.equal(error.verification.stage, "Iscrizione webhook Instagram");
      return true;
    });
  }
});

test("a temporary code 2 is retried once without changing token type", async () => {
  const { input } = fixture();
  let attempts = 0;
  input.client.get = async () => {
    attempts += 1;
    if (attempts === 1) throw { response: { data: { error: { code: 2, message: "Service temporarily unavailable" } } } };
    return { data: { user_id: "ig-1" } };
  };
  await verifyInstagramConnection(input);
  assert.equal(attempts, 2);
});

test("persistent errors retain stage/trace and redact the token and secrets", async () => {
  const { input } = fixture();
  input.client.post = async () => {
    throw { response: { data: { error: {
      code: 2, error_subcode: 42, fbtrace_id: "safe_meta_trace", is_transient: true,
      message: `${input.token} ${input.config.instagramAppSecret} ${input.config.mainAppSecret} temporarily unavailable`,
    } } } };
  };
  await assert.rejects(verifyInstagramConnection(input), (error) => {
    for (const secret of [input.token, input.config.instagramAppSecret, input.config.mainAppSecret]) {
      assert.equal(error.message.includes(secret), false);
    }
    assert.equal(error.verification.stage, "Iscrizione webhook Instagram");
    assert.equal(error.verification.traceId, "safe_meta_trace");
    assert.equal(error.verification.attempts, 2);
    assert.equal(error.verification.retryable, true);
    assert.match(error.message, /code 2, subcode 42/);
    return true;
  });
});

test("permission and authentication failures are not retried or treated as successful", async () => {
  for (const code of [10, 100, 190, 200]) {
    let attempts = 0;
    await assert.rejects(verificationStep("Token", async () => {
      attempts += 1;
      throw { response: { data: { error: { code, is_transient: true, message: "Rejected" } } } };
    }, { sleep: async () => {} }), (error) => {
      assert.equal(error.verification.retryable, false);
      return true;
    });
    assert.equal(attempts, 1);
  }
});

test("network errors do not expose request URLs or authorization configuration", async () => {
  await assert.rejects(verificationStep("Account", async () => {
    throw new Error("Request failed https://example.test?access_token=do-not-print");
  }), (error) => {
    assert.equal(error.message.includes("do-not-print"), false);
    assert.equal(error.message.includes("example.test"), false);
    return true;
  });
});

test("Page-linked Instagram retains Facebook validation and existing Messenger subscriptions", async () => {
  const { input, calls } = fixture({ mode: "FACEBOOK_LOGIN" });
  delete input.config.instagramAppId;
  delete input.config.instagramAppSecret;
  const inspections = [];
  input.inspectToken = async (request) => {
    inspections.push(request);
    return { isValid: true, missingScopes: [], appId: "main-app", scopes: ["instagram_basic", "instagram_manage_messages", "pages_manage_metadata"] };
  };
  input.client.get = async (url) => ({ data: url.endsWith("/me")
    ? { id: "page-1", name: "Page", instagram_business_account: { id: "ig-1", username: "test-business" } }
    : { data: [{ id: "main-app", subscribed_fields: ["message_reads", "leadgen"] }] } });
  const result = await verifyInstagramConnection(input);
  assert.equal(inspections.length, 1);
  assert.equal(inspections[0].appId, "main-app");
  assert.equal(result.pageId, "page-1");
  assert.equal(result.credentialMode, "FACEBOOK_LOGIN");
  assert.equal(calls[0].url, "https://graph.facebook.com/v26.0/page-1/subscribed_apps");
  assert.equal(calls[0].options.params.subscribed_fields, "message_reads,leadgen,messages");
});

test("Page-linked wrong-app and missing-scope tokens cannot bypass validation", async () => {
  for (const result of [
    { isValid: true, missingScopes: [], appId: "other-app" },
    { isValid: true, missingScopes: ["instagram_manage_messages"], appId: "main-app" },
    { isValid: false, missingScopes: [], appId: "main-app" },
  ]) {
    const { input, calls } = fixture({ mode: "FACEBOOK_LOGIN" });
    input.inspectToken = async () => result;
    await assert.rejects(verifyInstagramConnection(input), /Token della Pagina Facebook/);
    assert.equal(calls.length, 0);
  }
});

// Exercise the production service wiring without a database, real credentials,
// timers, or Meta network traffic. In particular, failed verification must never
// activate a channel and save must preserve the selected login mode.
function serviceFixture({ rejectSubscription = false, changedDuringVerification = false } = {}) {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const statements = [];
  const { input } = fixture();
  const channel = { ...input.channel, id: "channel-1", integration_id: "integration-1",
    channel_type: "INSTAGRAM", status: "PENDING", encrypted_access_token: "encrypted-fixture",
    token_iv: "iv", token_auth_tag: "tag", graph_api_version: input.version };
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      statements.push({ sql, params });
      if (/SELECT .*FROM meta_integrations/s.test(sql)) return [[{ id: "integration-1" }]];
      if (/SELECT \* FROM meta_channels/.test(sql)) return [[channel]];
      if (/SELECT COUNT\(\*\)/.test(sql)) return [[{ total: 1, active: 0 }]];
      return [{ affectedRows: sql.includes("status = 'ACTIVE'") && changedDuringVerification ? 0 : 1 }];
    },
  };
  const db = {
    query: async (sql) => sql.includes("SELECT ch.*") ? [[channel]] : [[]],
    getConnection: async () => connection,
  };
  if (rejectSubscription) input.client.post = async () => ({ data: { success: false } });
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("./meta.service"), "utf8"), {
    module, exports: module.exports, Buffer, Date, console, setTimeout,
    process: { env: {
      META_INSTAGRAM_APP_ID: input.config.instagramAppId, META_INSTAGRAM_APP_SECRET: input.config.instagramAppSecret,
      META_APP_SECRET: input.config.mainAppSecret, META_WEBHOOK_VERIFY_TOKEN: input.config.verifyToken,
    } },
    require: (name) => name === "axios" ? input.client : name === "../../config/db" ? db :
      name === "./meta.crypto" ? { decryptSecret: () => input.token, encryptSecret: () => ({}) } : require(name),
  });
  return { service: module.exports, channel, statements };
}

test("production service saves the selected mode and retains it on token-preserving edits", async () => {
  const { service, statements } = serviceFixture();
  await service.saveChannel("integration-1", { id: "channel-1", channelType: "INSTAGRAM", externalAccountId: "ig-1", credentialMode: "INSTAGRAM_LOGIN" }, { sub: "admin" });
  await service.saveChannel("integration-1", { id: "channel-1", channelType: "INSTAGRAM", externalAccountId: "ig-1" }, { sub: "admin" });
  const updates = statements.filter(({ sql }) => sql.includes("UPDATE meta_channels SET channel_type"));
  assert.equal(updates.length, 2);
  for (const { sql, params } of updates) {
    assert.equal(params[7], "INSTAGRAM_LOGIN");
    assert.equal((sql.match(/\?/g) || []).length, params.length);
    assert.equal(params[3], null); // Blank token preserves existing encrypted credential.
  }
});

test("production service activates native Instagram only after successful account/subscription checks", async () => {
  const { service, statements } = serviceFixture();
  const result = await service.verifyChannel("channel-1", { sub: "admin" });
  assert.equal(result.fullyConnected, true);
  const update = statements.find(({ sql }) => sql.includes("status = 'ACTIVE'"));
  assert.equal(update.params[1], "INSTAGRAM_LOGIN");
  assert.equal(update.params[2], "ig-1");
  assert.equal((update.sql.match(/\?/g) || []).length, update.params.length);
  assert.equal(JSON.stringify(result).includes("fake-ig-secret"), false);
  assert.equal(JSON.stringify(result).includes("fake-private-instagram-token"), false);
});

test("production service persists failed subscription diagnostics without activating the channel", async () => {
  const { service, statements } = serviceFixture({ rejectSubscription: true });
  await assert.rejects(service.verifyChannel("channel-1", { sub: "admin" }), (error) => {
    assert.equal(error.verification.stage, "Iscrizione webhook Instagram");
    return true;
  });
  assert.equal(statements.some(({ sql }) => sql.includes("UPDATE meta_channels SET status = 'ACTIVE'")), false);
  const failure = statements.find(({ sql }) => sql.includes("status = 'ERROR'"));
  assert.match(failure.params[0], /Iscrizione webhook Instagram/);
  assert.equal((failure.sql.match(/\?/g) || []).length, failure.params.length);
});

test("production service will not verify paused channels or activate credentials changed during verification", async () => {
  const paused = serviceFixture();
  paused.channel.status = "PAUSED";
  await assert.rejects(paused.service.verifyChannel("channel-1", { sub: "admin" }), { code: "META_CHANNEL_PAUSED" });
  assert.equal(paused.statements.length, 0);
  const changed = serviceFixture({ changedDuringVerification: true });
  await assert.rejects(changed.service.verifyChannel("channel-1", { sub: "admin" }), /modificato durante la verifica/);
  for (const { sql } of changed.statements.filter(({ sql }) => sql.includes("UPDATE meta_channels"))) {
    assert.match(sql, /encrypted_access_token <=> \?/);
    assert.match(sql, /credential_mode <=> \?/);
    assert.match(sql, /status <> 'PAUSED'/);
  }
});

test("detects the Instagram Login credential model", () => {
  assert.equal(
    detectInstagramCredentialMode([
      "instagram_business_basic",
      "instagram_business_manage_messages",
    ]),
    INSTAGRAM_CREDENTIAL_MODES.INSTAGRAM_LOGIN
  );
  assert.equal(detectInstagramCredentialMode(["instagram_basic"]), null);
});

test("uses the verified sender and host for Instagram replies", () => {
  assert.deepEqual(
    instagramApiTarget({
      credential_mode: "FACEBOOK_LOGIN",
      api_sender_id: "page-1",
      external_account_id: "ig-1",
    }),
    { host: "https://graph.facebook.com", senderId: "page-1" }
  );
  assert.deepEqual(
    instagramApiTarget({
      credential_mode: "INSTAGRAM_LOGIN",
      api_sender_id: "ig-1",
      external_account_id: "ig-1",
    }),
    { host: "https://graph.instagram.com", senderId: "ig-1" }
  );
  assert.equal(instagramApiTarget({ external_account_id: "ig-1" }), null);
});
