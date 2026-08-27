const assert = require("node:assert/strict");
const crypto = require("crypto");
const test = require("node:test");
const { decryptSecret, encryptSecret } = require("./meta.crypto");
const webhook = require("./meta.webhook");

test("accepts only a matching webhook challenge token", () => {
  const previous = process.env.META_WEBHOOK_VERIFY_TOKEN;
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-this-token";
  try {
    assert.equal(
      webhook.verifyChallenge({
        "hub.mode": "subscribe",
        "hub.verify_token": "verify-this-token",
        "hub.challenge": "12345",
      }),
      "12345"
    );
    assert.equal(
      webhook.verifyChallenge({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong-token",
        "hub.challenge": "12345",
      }),
      null
    );
  } finally {
    if (previous === undefined) delete process.env.META_WEBHOOK_VERIFY_TOKEN;
    else process.env.META_WEBHOOK_VERIFY_TOKEN = previous;
  }
});

test("verifies the exact raw webhook bytes with X-Hub-Signature-256", () => {
  const previous = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = "test-app-secret";
  const raw = Buffer.from('{"object":"page","entry":[]}');
  const signature = `sha256=${crypto
    .createHmac("sha256", process.env.META_APP_SECRET)
    .update(raw)
    .digest("hex")}`;
  try {
    assert.equal(webhook.verifySignature(raw, signature), true);
    assert.equal(webhook.verifySignature(Buffer.from("altered"), signature), false);
  } finally {
    if (previous === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previous;
  }
});

test("normalizes WhatsApp messages and statuses", () => {
  const events = webhook.normalizeWebhook({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "phone-1" },
              contacts: [{ wa_id: "390001", profile: { name: "Mario" } }],
              messages: [
                { id: "wamid-1", from: "390001", timestamp: "1700000000", type: "text", text: { body: "Salve" } },
              ],
              statuses: [{ id: "wamid-2", status: "delivered", timestamp: "1700000001" }],
            },
          },
        ],
      },
    ],
  });
  assert.equal(events.length, 2);
  assert.deepEqual(
    { kind: events[0].kind, accountId: events[0].accountId, contactId: events[0].contactId, text: events[0].text },
    { kind: "MESSAGE", accountId: "phone-1", contactId: "390001", text: "Salve" }
  );
  assert.equal(events[1].status, "DELIVERED");
});

test("Instagram accepts its own signing secret without granting it Page or WhatsApp access", () => {
  const previousMain = process.env.META_APP_SECRET;
  const previousInstagram = process.env.META_INSTAGRAM_APP_SECRET;
  process.env.META_APP_SECRET = "main-app-secret";
  process.env.META_INSTAGRAM_APP_SECRET = "instagram-app-secret";
  const sign = (raw, secret) => `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  try {
    const instagram = Buffer.from('{"object":"instagram","entry":[]}');
    assert.equal(webhook.verifySignature(instagram, sign(instagram, "instagram-app-secret")), true);
    assert.equal(webhook.verifySignature(instagram, sign(instagram, "main-app-secret")), true);
    assert.equal(webhook.verifySignature(instagram, sign(instagram, "wrong-secret")), false);
    assert.equal(webhook.verifySignature(Buffer.from('{"object":"instagram","entry":[1]}'), sign(instagram, "instagram-app-secret")), false);
    for (const object of ["page", "whatsapp_business_account"]) {
      const raw = Buffer.from(JSON.stringify({ object, entry: [] }));
      assert.equal(webhook.verifySignature(raw, sign(raw, "instagram-app-secret")), false);
      assert.equal(webhook.verifySignature(raw, sign(raw, "main-app-secret")), true);
    }
    delete process.env.META_APP_SECRET;
    assert.equal(webhook.verifySignature(instagram, sign(instagram, "instagram-app-secret")), true);
    assert.equal(webhook.verifySignature(instagram, "sha256=invalid"), false);
    assert.equal(webhook.verifySignature(instagram, null), false);
    const invalidJson = Buffer.from("not json");
    assert.equal(webhook.verifySignature(invalidJson, sign(invalidJson, "instagram-app-secret")), false);
    delete process.env.META_INSTAGRAM_APP_SECRET;
    assert.equal(webhook.verifySignature(instagram, sign(instagram, "instagram-app-secret")), false);
  } finally {
    if (previousMain === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previousMain;
    if (previousInstagram === undefined) delete process.env.META_INSTAGRAM_APP_SECRET;
    else process.env.META_INSTAGRAM_APP_SECRET = previousInstagram;
  }
});

test("Instagram messaging_seen identifies the read message by mid", () => {
  const events = webhook.normalizeWebhook({ object: "instagram", entry: [{ id: "ig-1", messaging: [{
    sender: { id: "customer-1" }, recipient: { id: "ig-1" },
    timestamp: 1700000000000, read: { mid: "instagram-message-1" },
  }] }] });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "STATUS");
  assert.equal(events[0].status, "READ");
  assert.equal(events[0].externalMessageId, "instagram-message-1");
  assert.equal(events[0].channelType, "INSTAGRAM");
});

test("normalizes Page leadgen notifications", () => {
  const [lead] = webhook.normalizeWebhook({
    object: "page",
    entry: [
      {
        id: "page-1",
        time: 1700000000,
        changes: [
          { field: "leadgen", value: { leadgen_id: "lead-1", page_id: "page-1", form_id: "form-1" } },
        ],
      },
    ],
  });
  assert.equal(lead.kind, "LEAD");
  assert.equal(lead.externalLeadId, "lead-1");
  assert.equal(lead.accountId, "page-1");
});

test("normalizes Messenger and Instagram messages plus delivery receipts", () => {
  const messenger = webhook.normalizeWebhook({
    object: "page",
    entry: [
      {
        id: "page-1",
        messaging: [
          {
            sender: { id: "psid-1" },
            recipient: { id: "page-1" },
            timestamp: 1700000000000,
            message: { mid: "mid-1", text: "Ciao Messenger" },
          },
          {
            timestamp: 1700000001000,
            delivery: { mids: ["mid-out-1"], watermark: 1700000001000 },
          },
          {
            sender: { id: "psid-1" },
            timestamp: 1700000002000,
            read: { watermark: 1700000002000 },
          },
        ],
      },
    ],
  });
  assert.equal(messenger[0].channelType, "MESSENGER");
  assert.equal(messenger[0].contactId, "psid-1");
  assert.equal(messenger[1].status, "DELIVERED");
  assert.equal(messenger[2].status, "READ");
  assert.equal(messenger[2].contactId, "psid-1");

  const [instagram] = webhook.normalizeWebhook({
    object: "instagram",
    entry: [
      {
        id: "ig-1",
        messaging: [
          {
            sender: { id: "igsid-1" },
            recipient: { id: "ig-1" },
            timestamp: 1700000002000,
            message: { mid: "ig-mid-1", text: "Ciao Instagram" },
          },
        ],
      },
    ],
  });
  assert.equal(instagram.channelType, "INSTAGRAM");
  assert.equal(instagram.accountId, "ig-1");
  assert.equal(instagram.contactId, "igsid-1");
});

test("normalizes an Instagram postback as an inbound message", () => {
  const [postback] = webhook.normalizeWebhook({
    object: "instagram",
    entry: [
      {
        id: "ig-1",
        messaging: [
          {
            sender: { id: "igsid-1" },
            recipient: { id: "ig-1" },
            timestamp: 1700000003000,
            postback: { mid: "ig-postback-1", title: "Parla con noi", payload: "CONTACT" },
          },
        ],
      },
    ],
  });
  assert.equal(postback.channelType, "INSTAGRAM");
  assert.equal(postback.messageType, "POSTBACK");
  assert.equal(postback.text, "Parla con noi");
  assert.equal(postback.externalMessageId, "ig-postback-1");
});


test("encrypts access tokens with authenticated encryption", () => {
  const previous = process.env.META_CREDENTIALS_ENCRYPTION_KEY;
  process.env.META_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  try {
    const encrypted = encryptSecret("sensitive-access-token");
    assert.notEqual(encrypted.encrypted, "sensitive-access-token");
    assert.equal(decryptSecret(encrypted), "sensitive-access-token");
    assert.throws(() => decryptSecret({ ...encrypted, authTag: Buffer.alloc(16, 1).toString("base64") }));
  } finally {
    if (previous === undefined) delete process.env.META_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.META_CREDENTIALS_ENCRYPTION_KEY = previous;
  }
});
