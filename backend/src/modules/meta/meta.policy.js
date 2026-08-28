const crypto = require("crypto");

function problem(message, code, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function utcDate(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  return new Date(
    String(value)
      .replace(" ", "T")
      .replace(/(?<!Z)(?<![+-]\d\d:\d\d)$/, "Z"),
  );
}

function assertCanSend(context, request, now = new Date()) {
  if (context.deleted_at)
    throw problem("Messaggio eliminato.", "META_MESSAGE_DELETED");
  if (context.consent_status === "OPTED_OUT")
    throw problem(
      "Il contatto ha revocato il consenso: invio bloccato.",
      "META_OPTED_OUT",
    );
  if (
    ["ARCHIVED", "SPAM", "CLOSED"].includes(
      context.conversation_status || context.status,
    )
  ) {
    throw problem(
      "Riapri la conversazione prima di inviare.",
      "META_CONVERSATION_CLOSED",
    );
  }
  if (
    context.integration_status !== "CONNECTED" ||
    context.channel_status !== "ACTIVE"
  ) {
    throw problem(
      "Canale non attivo: controlla la configurazione.",
      "META_CHANNEL_NOT_CONNECTED",
    );
  }
  if (context.token_expires_at && utcDate(context.token_expires_at) <= now) {
    throw problem(
      "Token scaduto: sostituiscilo e verifica il canale.",
      "META_TOKEN_EXPIRED",
    );
  }
  if (
    context.requester_kind === "AI" &&
    (context.ai_mode === "OFF" ||
      context.ai_paused ||
      context.approval_status !== "APPROVED")
  ) {
    throw problem("Invio AI sospeso o non approvato.", "META_AI_DISABLED");
  }
  if (request.type === "template") {
    if (context.channel_type !== "WHATSAPP")
      throw problem(
        "I template approvati sono disponibili per WhatsApp.",
        "META_TEMPLATE_CHANNEL",
      );
    if (context.consent_status !== "OPTED_IN")
      throw problem(
        "Registra il consenso WhatsApp prima di inviare un template.",
        "META_CONSENT_REQUIRED",
      );
  } else if (
    !context.reply_window_expires_at ||
    utcDate(context.reply_window_expires_at) <= now
  ) {
    throw problem(
      context.channel_type === "WHATSAPP"
        ? "Finestra di 24 ore scaduta. Seleziona un template WhatsApp approvato."
        : "Finestra di 24 ore scaduta. Attendi un nuovo messaggio del cliente.",
      "META_REPLY_WINDOW_EXPIRED",
    );
  }
}

function deliveryFailure(error, phase = "send") {
  const meta = error?.response?.data?.error;
  const code = Number(meta?.code);
  if (
    code === 190 ||
    [102, 10, 200, 294].includes(code) ||
    error.code === "META_TOKEN_EXPIRED"
  ) {
    return { state: "FAILED", credentialError: true };
  }
  if (error.statusCode && !error.response)
    return { state: "FAILED", credentialError: false };
  // A lost response or HTTP 5xx can happen AFTER Meta accepted the message.
  // Uploads/reads are safe to retry; delivery is not.
  if (
    phase === "send" &&
    (!error.response || Number(error.response.status) >= 500)
  ) {
    return { state: "UNCERTAIN", credentialError: false };
  }
  const transient =
    [1, 2, 4, 17, 32, 613, 80007, 130429, 131048, 131056].includes(code) ||
    meta?.is_transient === true ||
    error.response?.status === 429 ||
    !error.response ||
    error.response?.status >= 500;
  return { state: transient ? "RETRY" : "FAILED", credentialError: false };
}

function safeError(error) {
  const meta = error?.response?.data?.error;
  let text = String(
    meta?.error_user_msg ||
      meta?.message ||
      (error.statusCode ? error.message : "Richiesta a Meta non riuscita"),
  );
  text = text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /((?:access_token|input_token|client_secret|appsecret_proof)=)[^&\s]+/gi,
      "$1[redacted]",
    );
  return `${text}${meta?.code ? ` (code ${meta.code}${meta.error_subcode ? `, subcode ${meta.error_subcode}` : ""})` : ""}`.slice(
    0,
    1000,
  );
}

function boundedInt(value, fallback, max) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(0, Math.floor(number)))
    : fallback;
}

function requestKey(conversationId, key) {
  if (!key || !/^[a-zA-Z0-9_-]{16,100}$/.test(String(key)))
    throw problem(
      "Identificativo invio mancante o non valido.",
      "META_IDEMPOTENCY_REQUIRED",
      400,
    );
  return crypto
    .createHash("sha256")
    .update(`${conversationId}:${key}`)
    .digest("hex");
}

function redactPayload(value, ids) {
  if (Array.isArray(value))
    return value
      .map((item) => redactPayload(item, ids))
      .filter((item) => item !== null);
  if (!value || typeof value !== "object") return value;
  const identityKeys = ["id", "mid", "from", "to", "wa_id", "leadgen_id"];
  if (
    identityKeys.some((key) => ids.has(String(value[key] || ""))) ||
    ids.has(String(value.sender?.id || "")) ||
    ids.has(String(value.recipient?.id || ""))
  )
    return null;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      redactPayload(child, ids),
    ]),
  );
}

function redactChannelPayload(payload, channelType, accounts, ids) {
  if (!payload?.entry) return payload;
  const expected =
    channelType === "WHATSAPP"
      ? "whatsapp_business_account"
      : channelType === "INSTAGRAM"
        ? "instagram"
        : "page";
  if (payload.object !== expected) return payload;
  return {
    ...payload,
    entry: payload.entry
      .map((entry) => {
        if (channelType !== "WHATSAPP")
          return accounts.has(String(entry.id))
            ? redactPayload(entry, ids)
            : entry;
        return {
          ...entry,
          changes: (entry.changes || []).map((change) =>
            accounts.has(String(change.value?.metadata?.phone_number_id))
              ? { ...change, value: redactPayload(change.value, ids) }
              : change,
          ),
        };
      })
      .filter(Boolean),
  };
}

module.exports = {
  problem,
  utcDate,
  assertCanSend,
  deliveryFailure,
  safeError,
  boundedInt,
  requestKey,
  redactPayload,
  redactChannelPayload,
};
