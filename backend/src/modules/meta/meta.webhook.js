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
  const secret = process.env.META_APP_SECRET;
  if (!secret || !rawBody || !signatureHeader) return false;
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;
  return secureEqual(signatureHeader, expected);
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
