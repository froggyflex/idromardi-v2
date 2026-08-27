const crypto = require("crypto");

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyChallenge(query) {
  const mode = query?.["hub.mode"];
  const token = query?.["hub.verify_token"];
  const challenge = query?.["hub.challenge"];
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  return Boolean(expected && mode === "subscribe" && secureEqual(token, expected))
    ? String(challenge || "")
    : null;
}

function verifySignature(rawBody, signatureHeader) {
  if (!rawBody || typeof signatureHeader !== "string" || !/^sha256=[a-f0-9]{64}$/.test(signatureHeader)) return false;
  const matches = (secret) => Boolean(secret) && secureEqual(signatureHeader,
    `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  // Keep parent-app signing for existing channels. The Instagram secret is
  // accepted ONLY for Instagram objects; it cannot authenticate Page/WhatsApp.
  if (matches(String(process.env.META_APP_SECRET || "").trim())) return true;
  try {
    return JSON.parse(rawBody.toString("utf8"))?.object === "instagram" &&
      matches(String(process.env.META_INSTAGRAM_APP_SECRET || "").trim());
  } catch {
    return false;
  }
}

function eventKey(rawBody) {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

function unixDateTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return new Date();
  return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000);
}

function whatsappEvents(payload) {
  const events = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const accountId = String(value.metadata?.phone_number_id || entry.id || "");
      const names = new Map(
        (value.contacts || []).map((contact) => [
          String(contact.wa_id || ""),
          contact.profile?.name || null,
        ])
      );
      for (const message of value.messages || []) {
        events.push({
          kind: "MESSAGE",
          channelType: "WHATSAPP",
          accountId,
          contactId: String(message.from || ""),
          contactName: names.get(String(message.from || "")) || null,
          externalMessageId: String(message.id || ""),
          text: message.text?.body || null,
          messageType: String(message.type || "unknown").toUpperCase(),
          occurredAt: unixDateTime(message.timestamp),
          payload: message,
        });
      }
      for (const status of value.statuses || []) {
        events.push({
          kind: "STATUS",
          channelType: "WHATSAPP",
          accountId,
          externalMessageId: String(status.id || ""),
          status: String(status.status || "").toUpperCase(),
          occurredAt: unixDateTime(status.timestamp),
          payload: status,
        });
      }
    }
  }
  return events;
}

function pageEvents(payload) {
  const events = [];
  const channelType = payload.object === "instagram" ? "INSTAGRAM" : "MESSENGER";
  for (const entry of payload.entry || []) {
    const accountId = String(entry.id || "");
    for (const item of entry.messaging || []) {
      if (item.message?.mid && !item.message?.is_echo) {
        events.push({
          kind: "MESSAGE",
          channelType,
          accountId,
          contactId: String(item.sender?.id || ""),
          externalMessageId: String(item.message.mid),
          text: item.message.text || null,
          messageType: item.message.attachments?.length ? "ATTACHMENT" : "TEXT",
          occurredAt: unixDateTime(item.timestamp),
          payload: item,
        });
      }
      if (item.message?.mid && item.message?.is_echo) {
        events.push({
          kind: "STATUS",
          channelType,
          accountId,
          externalMessageId: String(item.message.mid),
          status: "SENT",
          occurredAt: unixDateTime(item.timestamp),
          payload: item,
        });
      }
      if (item.postback) {
        events.push({
          kind: "MESSAGE",
          channelType,
          accountId,
          contactId: String(item.sender?.id || ""),
          externalMessageId: item.postback.mid ? String(item.postback.mid) : null,
          text: item.postback.title || item.postback.payload || null,
          messageType: "POSTBACK",
          occurredAt: unixDateTime(item.timestamp),
          payload: item,
        });
      }
      for (const messageId of item.delivery?.mids || []) {
        events.push({
          kind: "STATUS",
          channelType,
          accountId,
          externalMessageId: String(messageId || ""),
          status: "DELIVERED",
          occurredAt: unixDateTime(item.delivery?.watermark || item.timestamp),
          payload: item,
        });
      }
      if (item.read?.mid) {
        events.push({
          kind: "STATUS", channelType, accountId,
          externalMessageId: String(item.read.mid), status: "READ",
          occurredAt: unixDateTime(item.timestamp), payload: item,
        });
      } else if (item.read?.watermark) {
        events.push({
          kind: "STATUS",
          channelType,
          accountId,
          contactId: String(item.sender?.id || ""),
          externalMessageId: null,
          status: "READ",
          occurredAt: unixDateTime(item.read.watermark),
          payload: item,
        });
      }
    }
    for (const change of entry.changes || []) {
      if (change.field !== "leadgen") continue;
      const value = change.value || {};
      events.push({
        kind: "LEAD",
        channelType: "MESSENGER",
        accountId: String(value.page_id || entry.id || ""),
        externalLeadId: String(value.leadgen_id || ""),
        formId: value.form_id ? String(value.form_id) : null,
        adId: value.ad_id ? String(value.ad_id) : null,
        occurredAt: unixDateTime(value.created_time || entry.time),
        payload: value,
      });
    }
  }
  return events;
}

function normalizeWebhook(payload) {
  if (payload?.object === "whatsapp_business_account") return whatsappEvents(payload);
  if (payload?.object === "page" || payload?.object === "instagram") return pageEvents(payload);
  return [];
}

module.exports = {
  eventKey,
  normalizeWebhook,
  verifyChallenge,
  verifySignature,
};
