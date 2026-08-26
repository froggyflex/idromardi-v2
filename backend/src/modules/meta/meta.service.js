const crypto = require("crypto");
const axios = require("axios");
const db = require("../../config/db");
const { decryptSecret, encryptSecret } = require("./meta.crypto");
const webhook = require("./meta.webhook");

const CHANNEL_TYPES = new Set(["WHATSAPP", "MESSENGER", "INSTAGRAM"]);
const AI_MODES = new Set(["OFF", "DRAFT", "APPROVAL", "AUTO"]);

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function mysqlDateTime(value = new Date()) {
  return new Date(value).toISOString().slice(0, 23).replace("T", " ");
}

function parseJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function serializeRows(rows) {
  return rows.map((row) => {
    const result = { ...row };
    for (const key of Object.keys(result)) {
      if (key.endsWith("_json")) result[key] = parseJson(result[key]);
    }
    return result;
  });
}

async function audit(conn, { integrationId, actorId, actorKind, action, entityType, entityId, details }) {
  await conn.query(
    `INSERT INTO meta_audit_log
       (integration_id, actor_id, actor_kind, action, entity_type, entity_id, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      integrationId || null,
      actorId || null,
      actorKind,
      action,
      entityType,
      entityId || null,
      details ? JSON.stringify(details) : null,
    ]
  );
}

async function getOverview() {
  const [[counts], [integrations], [channels], [webhookStats], [recentWebhookEvents]] = await Promise.all([
    db.query(`SELECT
      (SELECT COUNT(*) FROM meta_leads WHERE status IN ('NEW', 'CONTACTED', 'QUALIFIED')) AS active_leads,
      (SELECT COUNT(*) FROM meta_conversations WHERE status IN ('OPEN', 'PENDING')) AS open_conversations,
      (SELECT COALESCE(SUM(unread_count), 0) FROM meta_conversations) AS unread_messages,
      (SELECT COUNT(*) FROM meta_outbound_jobs WHERE state = 'WAITING_APPROVAL') AS awaiting_approval`),
    db.query(`SELECT id, name, business_account_id, app_id, graph_api_version, token_expires_at,
                     status, ai_mode, last_error, created_at, updated_at,
                     encrypted_access_token IS NOT NULL AS has_access_token
              FROM meta_integrations ORDER BY created_at DESC`),
    db.query(`SELECT id, integration_id, channel_type, external_account_id, display_name, status,
                     created_at, updated_at
              FROM meta_channels ORDER BY channel_type, display_name`),
    db.query(`SELECT
      COUNT(*) AS total,
      COALESCE(SUM(processing_status = 'PROCESSED'), 0) AS processed,
      COALESCE(SUM(processing_status = 'UNMATCHED'), 0) AS unmatched,
      COALESCE(SUM(processing_status = 'FAILED'), 0) AS failed,
      MAX(received_at) AS last_received_at,
      MAX(IF(processing_status = 'PROCESSED', processed_at, NULL)) AS last_processed_at
      FROM meta_webhook_events`),
    db.query(`SELECT id, object_type, processing_status, attempt_count, error_message,
                     received_at, processed_at
              FROM meta_webhook_events ORDER BY received_at DESC LIMIT 10`),
  ]);
  return {
    counts: counts[0] || {},
    integrations,
    channels,
    webhookDiagnostics: {
      ...(webhookStats[0] || {}),
      recentEvents: recentWebhookEvents,
    },
    webhookConfigured: Boolean(
      process.env.META_WEBHOOK_VERIFY_TOKEN && process.env.META_APP_SECRET
    ),
    encryptionConfigured: Boolean(process.env.META_CREDENTIALS_ENCRYPTION_KEY),
  };
}

async function saveIntegration(input, actor) {
  const id = input.id ? String(input.id) : crypto.randomUUID();
  const name = String(input.name || "").trim();
  const graphVersion = String(
    input.graphApiVersion || process.env.META_GRAPH_API_VERSION || ""
  ).trim();
  if (!name) throw httpError(400, "Nome integrazione obbligatorio", "META_NAME_REQUIRED");
  if (graphVersion && !/^v\d+\.\d+$/.test(graphVersion)) {
    throw httpError(400, "Versione Graph API non valida", "META_GRAPH_VERSION_INVALID");
  }

  const channels = Array.isArray(input.channels) ? input.channels : [];
  for (const channel of channels) {
    const type = String(channel.channelType || "").toUpperCase();
    if (!CHANNEL_TYPES.has(type) || !String(channel.externalAccountId || "").trim()) {
      throw httpError(400, "Canale Meta non valido", "META_CHANNEL_INVALID");
    }
  }

  const token = input.accessToken ? encryptSecret(String(input.accessToken).trim()) : null;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query(
      `SELECT id, encrypted_access_token FROM meta_integrations WHERE id = ? LIMIT 1`,
      [id]
    );
    const [[channelCount]] = existing.length
      ? await conn.query(`SELECT COUNT(*) AS count FROM meta_channels WHERE integration_id = ?`, [id])
      : [[{ count: 0 }]];
    const willBeConnected = Boolean(
      (token || existing[0]?.encrypted_access_token) &&
        (channels.length || Number(channelCount?.count || 0))
    );
    if (existing.length) {
      await conn.query(
        `UPDATE meta_integrations SET name = ?, business_account_id = ?, app_id = ?,
           graph_api_version = ?, token_expires_at = ?,
           encrypted_access_token = COALESCE(?, encrypted_access_token),
           token_iv = COALESCE(?, token_iv), token_auth_tag = COALESCE(?, token_auth_tag),
           status = ?, last_error = NULL
         WHERE id = ?`,
        [
          name,
          input.businessAccountId || null,
          input.appId || null,
          graphVersion || null,
          input.tokenExpiresAt ? mysqlDateTime(input.tokenExpiresAt) : null,
          token?.encrypted || null,
          token?.iv || null,
          token?.authTag || null,
          input.status === "PAUSED" ? "PAUSED" : willBeConnected ? "CONNECTED" : "PENDING",
          id,
        ]
      );
    } else {
      await conn.query(
        `INSERT INTO meta_integrations
           (id, name, business_account_id, app_id, graph_api_version, encrypted_access_token,
            token_iv, token_auth_tag, token_expires_at, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          name,
          input.businessAccountId || null,
          input.appId || null,
          graphVersion || null,
          token?.encrypted || null,
          token?.iv || null,
          token?.authTag || null,
          input.tokenExpiresAt ? mysqlDateTime(input.tokenExpiresAt) : null,
          token && channels.length ? "CONNECTED" : "PENDING",
          actor.sub,
        ]
      );
    }

    for (const channel of channels) {
      const type = String(channel.channelType).toUpperCase();
      const externalId = String(channel.externalAccountId).trim();
      await conn.query(
        `INSERT INTO meta_channels
           (id, integration_id, channel_type, external_account_id, display_name, status)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), status = VALUES(status)`,
        [
          crypto.randomUUID(),
          id,
          type,
          externalId,
          channel.displayName || null,
          token || existing[0]?.encrypted_access_token ? "ACTIVE" : "PENDING",
        ]
      );
    }
    await audit(conn, {
      integrationId: id,
      actorId: actor.sub,
      actorKind: "HUMAN",
      action: existing.length ? "INTEGRATION_UPDATED" : "INTEGRATION_CREATED",
      entityType: "INTEGRATION",
      entityId: id,
      details: { channels: channels.length, tokenUpdated: Boolean(token) },
    });
    await conn.commit();
    if (channels.length) {
      try {
        await replayUnmatchedEvents();
      } catch (replayError) {
        console.error("Unable to replay unmatched Meta webhooks after saving a channel", replayError);
      }
    }
    return getOverview();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function setAiMode(integrationId, mode, actor) {
  const normalized = String(mode || "").toUpperCase();
  if (!AI_MODES.has(normalized)) {
    throw httpError(400, "Modalità AI non valida", "META_AI_MODE_INVALID");
  }
  await db.query(`UPDATE meta_integrations SET ai_mode = ? WHERE id = ?`, [normalized, integrationId]);
  await audit(db, {
    integrationId,
    actorId: actor.sub,
    actorKind: "HUMAN",
    action: "AI_MODE_CHANGED",
    entityType: "INTEGRATION",
    entityId: integrationId,
    details: { mode: normalized },
  });
  return { ok: true, aiMode: normalized };
}

async function findChannel(conn, channelType, accountId) {
  const [rows] = await conn.query(
    `SELECT c.*, i.status AS integration_status
     FROM meta_channels c JOIN meta_integrations i ON i.id = c.integration_id
     WHERE c.channel_type = ? AND c.external_account_id = ? LIMIT 1`,
    [channelType, accountId]
  );
  return rows[0] || null;
}

async function upsertInboundMessage(conn, channel, event) {
  const contactId = crypto.randomUUID();
  await conn.query(
    `INSERT INTO meta_contacts
       (id, integration_id, channel_type, external_contact_id, display_name, phone, profile_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_name = COALESCE(VALUES(display_name), display_name),
       profile_json = COALESCE(VALUES(profile_json), profile_json)`,
    [
      contactId,
      channel.integration_id,
      event.channelType,
      event.contactId,
      event.contactName,
      event.channelType === "WHATSAPP" ? event.contactId : null,
      JSON.stringify(event.payload || {}),
    ]
  );
  const [[contact]] = await conn.query(
    `SELECT id FROM meta_contacts
     WHERE integration_id = ? AND channel_type = ? AND external_contact_id = ? LIMIT 1`,
    [channel.integration_id, event.channelType, event.contactId]
  );
  if (!contact) return;

  const conversationId = crypto.randomUUID();
  await conn.query(
    `INSERT INTO meta_conversations
       (id, integration_id, channel_id, contact_id, last_message_at, last_inbound_at,
        reply_window_expires_at, unread_count)
     VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL 24 HOUR), 0)
     ON DUPLICATE KEY UPDATE
       last_message_at = GREATEST(COALESCE(last_message_at, VALUES(last_message_at)), VALUES(last_message_at)),
       last_inbound_at = GREATEST(COALESCE(last_inbound_at, VALUES(last_inbound_at)), VALUES(last_inbound_at)),
       reply_window_expires_at = DATE_ADD(VALUES(last_inbound_at), INTERVAL 24 HOUR),
       status = IF(status = 'SPAM', status, 'OPEN')`,
    [
      conversationId,
      channel.integration_id,
      channel.id,
      contact.id,
      mysqlDateTime(event.occurredAt),
      mysqlDateTime(event.occurredAt),
      mysqlDateTime(event.occurredAt),
    ]
  );
  const [[conversation]] = await conn.query(
    `SELECT id FROM meta_conversations WHERE channel_id = ? AND contact_id = ? LIMIT 1`,
    [channel.id, contact.id]
  );
  const [messageInsert] = await conn.query(
    `INSERT IGNORE INTO meta_messages
       (id, conversation_id, channel_id, external_message_id, direction, sender_kind,
        message_type, body_text, payload_json, status, occurred_at)
     VALUES (?, ?, ?, ?, 'INBOUND', 'CONTACT', ?, ?, ?, 'RECEIVED', ?)`,
    [
      crypto.randomUUID(),
      conversation.id,
      channel.id,
      event.externalMessageId,
      event.messageType,
      event.text,
      JSON.stringify(event.payload || {}),
      mysqlDateTime(event.occurredAt),
    ]
  );
  if (messageInsert.affectedRows) {
    await conn.query(
      `UPDATE meta_conversations SET
         last_message_at = GREATEST(COALESCE(last_message_at, ?), ?),
         last_inbound_at = GREATEST(COALESCE(last_inbound_at, ?), ?),
         reply_window_expires_at = DATE_ADD(?, INTERVAL 24 HOUR),
         unread_count = unread_count + 1,
         status = IF(status = 'SPAM', status, 'OPEN')
       WHERE id = ?`,
      [
        mysqlDateTime(event.occurredAt),
        mysqlDateTime(event.occurredAt),
        mysqlDateTime(event.occurredAt),
        mysqlDateTime(event.occurredAt),
        mysqlDateTime(event.occurredAt),
        conversation.id,
      ]
    );
  }
}

async function upsertLead(conn, channel, event) {
  await conn.query(
    `INSERT INTO meta_leads
       (id, integration_id, channel_id, external_lead_id, form_id, ad_id,
        raw_payload_json, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE raw_payload_json = VALUES(raw_payload_json)`,
    [
      crypto.randomUUID(),
      channel.integration_id,
      channel.id,
      event.externalLeadId,
      event.formId,
      event.adId,
      JSON.stringify(event.payload || {}),
      mysqlDateTime(event.occurredAt),
    ]
  );
}

async function applyStatus(conn, channel, event) {
  const map = { SENT: "SENT", DELIVERED: "DELIVERED", READ: "READ", FAILED: "FAILED" };
  const status = map[event.status];
  if (!status) return;
  await conn.query(
    `UPDATE meta_messages SET status = ?, payload_json = ?,
       error_message = IF(? = 'FAILED', ?, NULL)
     WHERE channel_id = ? AND external_message_id = ?`,
    [
      status,
      JSON.stringify(event.payload || {}),
      status,
      event.payload?.errors?.[0]?.title || event.payload?.errors?.[0]?.message || null,
      channel.id,
      event.externalMessageId,
    ]
  );
}

async function processWebhookPayload(conn, payload) {
  let matched = 0;
  let unmatched = 0;
  const events = webhook.normalizeWebhook(payload);
  for (const event of events) {
    const channel = await findChannel(conn, event.channelType, event.accountId);
    if (!channel) {
      unmatched += 1;
      continue;
    }
    matched += 1;
    if (event.kind === "MESSAGE") await upsertInboundMessage(conn, channel, event);
    if (event.kind === "LEAD") await upsertLead(conn, channel, event);
    if (event.kind === "STATUS") await applyStatus(conn, channel, event);
  }
  return { events: events.length, matched, unmatched };
}

async function replayUnmatchedEvents({ limit = 100 } = {}) {
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const [rows] = await db.query(
    `SELECT id, payload_json, attempt_count
     FROM meta_webhook_events
     WHERE processing_status = 'UNMATCHED'
     ORDER BY received_at ASC LIMIT ?`,
    [safeLimit]
  );
  let processed = 0;
  let stillUnmatched = 0;
  let failed = 0;

  for (const row of rows) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const result = await processWebhookPayload(conn, parseJson(row.payload_json) || {});
      const status = result.unmatched ? "UNMATCHED" : "PROCESSED";
      await conn.query(
        `UPDATE meta_webhook_events SET processing_status = ?, attempt_count = ?,
         error_message = NULL, processed_at = IF(? = 'PROCESSED', CURRENT_TIMESTAMP(3), processed_at)
         WHERE id = ?`,
        [status, Number(row.attempt_count || 0) + 1, status, row.id]
      );
      await conn.commit();
      if (status === "PROCESSED") processed += 1;
      else stillUnmatched += 1;
    } catch (error) {
      await conn.rollback();
      failed += 1;
      await db.query(
        `UPDATE meta_webhook_events SET processing_status = 'FAILED', attempt_count = ?,
         error_message = ? WHERE id = ?`,
        [Number(row.attempt_count || 0) + 1, String(error.message || error).slice(0, 1000), row.id]
      );
    } finally {
      conn.release();
    }
  }
  return { examined: rows.length, processed, stillUnmatched, failed };
}

async function ingestWebhook(rawBody, payload) {
  const key = webhook.eventKey(rawBody);
  const webhookId = crypto.randomUUID();
  const [insert] = await db.query(
    `INSERT IGNORE INTO meta_webhook_events (id, event_key, object_type, payload_json)
     VALUES (?, ?, ?, ?)`,
    [webhookId, key, payload?.object || null, JSON.stringify(payload)]
  );
  if (!insert.affectedRows) return { accepted: true, duplicate: true };

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await processWebhookPayload(conn, payload);
    await conn.query(
      `UPDATE meta_webhook_events SET processing_status = ?, attempt_count = 1,
       processed_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [result.unmatched ? "UNMATCHED" : "PROCESSED", webhookId]
    );
    await conn.commit();
    return { accepted: true, duplicate: false, ...result };
  } catch (error) {
    await conn.rollback();
    await db.query(
      `UPDATE meta_webhook_events SET processing_status = 'FAILED', attempt_count = 1,
       error_message = ? WHERE id = ?`,
      [String(error.message || error).slice(0, 1000), webhookId]
    );
    throw error;
  } finally {
    conn.release();
  }
}

async function listConversations({ status = "OPEN", limit = 100 } = {}) {
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 100));
  const params = [];
  let statusClause = "";
  if (status !== "ALL") {
    statusClause = "WHERE cv.status = ?";
    params.push(String(status).toUpperCase());
  }
  params.push(safeLimit);
  const [rows] = await db.query(
    `SELECT cv.*, c.display_name, c.external_contact_id, c.phone, c.email,
            ch.channel_type, ch.display_name AS channel_name,
            last_message.body_text AS last_message_text,
            last_message.sender_kind AS last_message_sender
     FROM meta_conversations cv
     JOIN meta_contacts c ON c.id = cv.contact_id
     JOIN meta_channels ch ON ch.id = cv.channel_id
     LEFT JOIN meta_messages last_message ON last_message.id = (
       SELECT m.id FROM meta_messages m WHERE m.conversation_id = cv.id
       ORDER BY m.occurred_at DESC, m.created_at DESC LIMIT 1
     )
     ${statusClause}
     ORDER BY cv.last_message_at DESC LIMIT ?`,
    params
  );
  return { conversations: serializeRows(rows) };
}

async function listMessages(conversationId, { limit = 200 } = {}) {
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
  const [rows] = await db.query(
    `SELECT * FROM meta_messages WHERE conversation_id = ?
     ORDER BY occurred_at ASC, created_at ASC LIMIT ?`,
    [conversationId, safeLimit]
  );
  await db.query(`UPDATE meta_conversations SET unread_count = 0 WHERE id = ?`, [conversationId]);
  return { messages: serializeRows(rows) };
}

async function listLeads({ status = "ALL", limit = 200 } = {}) {
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
  const params = [];
  let clause = "";
  if (status !== "ALL") {
    clause = "WHERE l.status = ?";
    params.push(String(status).toUpperCase());
  }
  params.push(safeLimit);
  const [rows] = await db.query(
    `SELECT l.*, c.display_name, c.phone, c.email, ch.channel_type
     FROM meta_leads l
     LEFT JOIN meta_contacts c ON c.id = l.contact_id
     LEFT JOIN meta_channels ch ON ch.id = l.channel_id
     ${clause} ORDER BY l.received_at DESC LIMIT ?`,
    params
  );
  return { leads: serializeRows(rows) };
}

async function updateLead(leadId, input, actor) {
  const status = String(input.status || "").toUpperCase();
  if (!new Set(["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST", "ARCHIVED"]).has(status)) {
    throw httpError(400, "Stato lead non valido", "META_LEAD_STATUS_INVALID");
  }
  const [[lead]] = await db.query(`SELECT integration_id FROM meta_leads WHERE id = ? LIMIT 1`, [leadId]);
  if (!lead) throw httpError(404, "Lead non trovato", "META_LEAD_NOT_FOUND");
  await db.query(`UPDATE meta_leads SET status = ? WHERE id = ?`, [status, leadId]);
  await audit(db, {
    integrationId: lead.integration_id,
    actorId: actor.sub,
    actorKind: "HUMAN",
    action: "LEAD_STATUS_CHANGED",
    entityType: "LEAD",
    entityId: leadId,
    details: { status },
  });
  return { ok: true, status };
}

async function updateConversation(conversationId, input, actor) {
  const updates = [];
  const params = [];
  if (input.status !== undefined) {
    const status = String(input.status).toUpperCase();
    if (!new Set(["OPEN", "PENDING", "CLOSED", "SPAM"]).has(status)) {
      throw httpError(400, "Stato conversazione non valido", "META_CONVERSATION_STATUS_INVALID");
    }
    updates.push("status = ?");
    params.push(status);
  }
  if (input.aiPaused !== undefined) {
    updates.push("ai_paused = ?");
    params.push(input.aiPaused === true ? 1 : 0);
  }
  if (!updates.length) throw httpError(400, "Nessuna modifica richiesta", "META_UPDATE_EMPTY");
  const [[conversation]] = await db.query(
    `SELECT integration_id FROM meta_conversations WHERE id = ? LIMIT 1`,
    [conversationId]
  );
  if (!conversation) {
    throw httpError(404, "Conversazione non trovata", "META_CONVERSATION_NOT_FOUND");
  }
  await db.query(`UPDATE meta_conversations SET ${updates.join(", ")} WHERE id = ?`, [
    ...params,
    conversationId,
  ]);
  await audit(db, {
    integrationId: conversation.integration_id,
    actorId: actor.sub,
    actorKind: "HUMAN",
    action: "CONVERSATION_UPDATED",
    entityType: "CONVERSATION",
    entityId: conversationId,
    details: { status: input.status, aiPaused: input.aiPaused },
  });
  return { ok: true };
}

async function queueMessage(conversationId, input, actor) {
  const text = String(input.text || "").trim();
  const senderKind = String(input.senderKind || "HUMAN").toUpperCase();
  if (!text || text.length > 4096) {
    throw httpError(400, "Messaggio vuoto o troppo lungo", "META_MESSAGE_INVALID");
  }
  if (!new Set(["HUMAN", "AI"]).has(senderKind)) {
    throw httpError(400, "Mittente non valido", "META_SENDER_INVALID");
  }

  const [[conversation]] = await db.query(
    `SELECT cv.*, ch.channel_type, ch.status AS channel_status,
            i.status AS integration_status, i.ai_mode
     FROM meta_conversations cv
     JOIN meta_channels ch ON ch.id = cv.channel_id
     JOIN meta_integrations i ON i.id = cv.integration_id
     WHERE cv.id = ? LIMIT 1`,
    [conversationId]
  );
  if (!conversation) throw httpError(404, "Conversazione non trovata", "META_CONVERSATION_NOT_FOUND");
  if (conversation.integration_status !== "CONNECTED" || conversation.channel_status !== "ACTIVE") {
    throw httpError(409, "Canale Meta non connesso", "META_CHANNEL_NOT_CONNECTED");
  }
  if (!conversation.reply_window_expires_at || new Date(conversation.reply_window_expires_at) < new Date()) {
    throw httpError(
      409,
      "Finestra di risposta Meta scaduta: utilizzare un template approvato",
      "META_REPLY_WINDOW_EXPIRED"
    );
  }
  if (senderKind === "AI" && (conversation.ai_mode === "OFF" || conversation.ai_paused)) {
    throw httpError(409, "Assistente AI disattivato", "META_AI_DISABLED");
  }

  const requiresApproval = senderKind === "AI" && conversation.ai_mode !== "AUTO";
  const messageId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO meta_messages
         (id, conversation_id, channel_id, direction, sender_kind, sender_user_id,
          body_text, status, occurred_at)
       VALUES (?, ?, ?, 'OUTBOUND', ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [messageId, conversationId, conversation.channel_id, senderKind, actor?.sub || null, text,
       requiresApproval ? "DRAFT" : "QUEUED"]
    );
    await conn.query(
      `INSERT INTO meta_outbound_jobs
         (id, message_id, integration_id, requested_by, requester_kind, approval_status, state)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        jobId,
        messageId,
        conversation.integration_id,
        actor?.sub || null,
        senderKind,
        requiresApproval ? "PENDING" : "APPROVED",
        requiresApproval ? "WAITING_APPROVAL" : "READY",
      ]
    );
    await audit(conn, {
      integrationId: conversation.integration_id,
      actorId: actor?.sub,
      actorKind: senderKind,
      action: requiresApproval ? "MESSAGE_APPROVAL_REQUESTED" : "MESSAGE_QUEUED",
      entityType: "MESSAGE",
      entityId: messageId,
      details: { conversationId },
    });
    await conn.commit();
    return { messageId, jobId, awaitingApproval: requiresApproval };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function approveJob(jobId, approved, actor) {
  const state = approved ? "READY" : "CANCELLED";
  const approvalStatus = approved ? "APPROVED" : "REJECTED";
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[job]] = await conn.query(
      `SELECT * FROM meta_outbound_jobs WHERE id = ? FOR UPDATE`,
      [jobId]
    );
    if (!job) throw httpError(404, "Richiesta non trovata", "META_JOB_NOT_FOUND");
    if (job.state !== "WAITING_APPROVAL") {
      throw httpError(409, "Richiesta già elaborata", "META_JOB_ALREADY_REVIEWED");
    }
    await conn.query(
      `UPDATE meta_outbound_jobs SET approval_status = ?, state = ?, approved_by = ?,
       approved_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [approvalStatus, state, actor.sub, jobId]
    );
    await conn.query(`UPDATE meta_messages SET status = ? WHERE id = ?`, [approved ? "QUEUED" : "FAILED", job.message_id]);
    await audit(conn, {
      integrationId: job.integration_id,
      actorId: actor.sub,
      actorKind: "HUMAN",
      action: approved ? "AI_MESSAGE_APPROVED" : "AI_MESSAGE_REJECTED",
      entityType: "MESSAGE",
      entityId: job.message_id,
    });
    await conn.commit();
    return { ok: true, state };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function processNextOutbound() {
  const conn = await db.getConnection();
  let job;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT j.*, m.body_text, m.conversation_id, cv.contact_id,
              c.external_contact_id, ch.channel_type, ch.external_account_id,
              i.graph_api_version, i.encrypted_access_token, i.token_iv, i.token_auth_tag
       FROM meta_outbound_jobs j
       JOIN meta_messages m ON m.id = j.message_id
       JOIN meta_conversations cv ON cv.id = m.conversation_id
       JOIN meta_contacts c ON c.id = cv.contact_id
       JOIN meta_channels ch ON ch.id = m.channel_id
       JOIN meta_integrations i ON i.id = j.integration_id
       WHERE j.state IN ('READY', 'RETRY')
         AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= CURRENT_TIMESTAMP(3))
         AND i.status = 'CONNECTED' AND ch.status = 'ACTIVE'
       ORDER BY j.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    job = rows[0];
    if (!job) {
      await conn.commit();
      return { processed: false };
    }
    await conn.query(
      `UPDATE meta_outbound_jobs SET state = 'PROCESSING', locked_at = CURRENT_TIMESTAMP(3),
       attempt_count = attempt_count + 1 WHERE id = ?`,
      [job.id]
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  try {
    const token = decryptSecret({
      encrypted: job.encrypted_access_token,
      iv: job.token_iv,
      authTag: job.token_auth_tag,
    });
    const version = job.graph_api_version || process.env.META_GRAPH_API_VERSION;
    if (!token || !version) throw new Error("Credenziali o versione Graph API mancanti");
    const url = `https://graph.facebook.com/${version}/${encodeURIComponent(job.external_account_id)}/messages`;
    const body = job.channel_type === "WHATSAPP"
      ? { messaging_product: "whatsapp", to: job.external_contact_id, type: "text", text: { body: job.body_text } }
      : { recipient: { id: job.external_contact_id }, messaging_type: "RESPONSE", message: { text: job.body_text } };
    const response = await axios.post(url, body, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      timeout: Number(process.env.META_GRAPH_TIMEOUT_MS || 15000),
    });
    const externalId = response.data?.messages?.[0]?.id || response.data?.message_id || response.data?.message_id || null;
    await db.query(
      `UPDATE meta_messages SET status = 'SENT', external_message_id = COALESCE(?, external_message_id),
       payload_json = ? WHERE id = ?`,
      [externalId, JSON.stringify(response.data || {}), job.message_id]
    );
    await db.query(`UPDATE meta_outbound_jobs SET state = 'SENT', last_error = NULL WHERE id = ?`, [job.id]);
    return { processed: true, jobId: job.id, sent: true };
  } catch (error) {
    const message = String(error.response?.data?.error?.message || error.message || error).slice(0, 1000);
    const retry = Number(job.attempt_count || 0) + 1 < 5;
    const delayMinutes = Math.min(60, 2 ** Math.max(0, Number(job.attempt_count || 0)));
    await db.query(
      `UPDATE meta_outbound_jobs SET state = ?, last_error = ?,
       next_attempt_at = IF(?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE), NULL)
       WHERE id = ?`,
      [retry ? "RETRY" : "FAILED", message, retry, delayMinutes, job.id]
    );
    await db.query(`UPDATE meta_messages SET status = ?, error_message = ? WHERE id = ?`, [retry ? "QUEUED" : "FAILED", message, job.message_id]);
    return { processed: true, jobId: job.id, sent: false, retry, error: message };
  }
}

function leadFieldMap(fieldData) {
  return Object.fromEntries(
    (Array.isArray(fieldData) ? fieldData : []).map((field) => [
      String(field.name || "").toLowerCase(),
      Array.isArray(field.values) ? field.values[0] : field.values,
    ])
  );
}

async function processNextLead() {
  const conn = await db.getConnection();
  let lead;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT l.*, i.graph_api_version, i.encrypted_access_token, i.token_iv, i.token_auth_tag
       FROM meta_leads l
       JOIN meta_integrations i ON i.id = l.integration_id
       WHERE l.hydration_status IN ('PENDING', 'RETRY')
         AND (l.hydration_next_attempt_at IS NULL OR l.hydration_next_attempt_at <= CURRENT_TIMESTAMP(3))
         AND i.status = 'CONNECTED'
       ORDER BY l.received_at LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    lead = rows[0];
    if (!lead) {
      await conn.commit();
      return { processed: false };
    }
    await conn.query(
      `UPDATE meta_leads SET hydration_status = 'PROCESSING',
       hydration_attempt_count = hydration_attempt_count + 1 WHERE id = ?`,
      [lead.id]
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  try {
    const token = decryptSecret({
      encrypted: lead.encrypted_access_token,
      iv: lead.token_iv,
      authTag: lead.token_auth_tag,
    });
    const version = lead.graph_api_version || process.env.META_GRAPH_API_VERSION;
    if (!token || !version) throw new Error("Credenziali o versione Graph API mancanti");
    const response = await axios.get(
      `https://graph.facebook.com/${version}/${encodeURIComponent(lead.external_lead_id)}`,
      {
        params: { fields: "id,created_time,ad_id,form_id,field_data,platform" },
        headers: { Authorization: `Bearer ${token}` },
        timeout: Number(process.env.META_GRAPH_TIMEOUT_MS || 15000),
      }
    );
    const data = response.data || {};
    const fields = leadFieldMap(data.field_data);
    const displayName = fields.full_name || fields.nome_completo || fields.name || null;
    const phone = fields.phone_number || fields.telefono || fields.phone || null;
    const email = fields.email || fields.e_mail || null;
    const contactId = crypto.randomUUID();
    const contactExternalId = `lead:${lead.external_lead_id}`;
    const updateConn = await db.getConnection();
    try {
      await updateConn.beginTransaction();
      await updateConn.query(
        `INSERT INTO meta_contacts
           (id, integration_id, channel_type, external_contact_id, display_name, phone, email, profile_json)
         VALUES (?, ?, 'MESSENGER', ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), phone = VALUES(phone),
           email = VALUES(email), profile_json = VALUES(profile_json)`,
        [contactId, lead.integration_id, contactExternalId, displayName, phone, email, JSON.stringify(data)]
      );
      const [[contact]] = await updateConn.query(
        `SELECT id FROM meta_contacts WHERE integration_id = ? AND channel_type = 'MESSENGER'
         AND external_contact_id = ? LIMIT 1`,
        [lead.integration_id, contactExternalId]
      );
      await updateConn.query(
        `UPDATE meta_leads SET contact_id = ?, form_id = COALESCE(?, form_id),
         ad_id = COALESCE(?, ad_id), field_data_json = ?, raw_payload_json = ?,
         hydration_status = 'COMPLETE', hydration_last_error = NULL,
         hydration_next_attempt_at = NULL WHERE id = ?`,
        [contact.id, data.form_id || null, data.ad_id || null, JSON.stringify(data.field_data || []), JSON.stringify(data), lead.id]
      );
      await audit(updateConn, {
        integrationId: lead.integration_id,
        actorKind: "SYSTEM",
        action: "LEAD_HYDRATED",
        entityType: "LEAD",
        entityId: lead.id,
      });
      await updateConn.commit();
    } catch (error) {
      await updateConn.rollback();
      throw error;
    } finally {
      updateConn.release();
    }
    return { processed: true, leadId: lead.id, hydrated: true };
  } catch (error) {
    const message = String(error.response?.data?.error?.message || error.message || error).slice(0, 1000);
    const retry = Number(lead.hydration_attempt_count || 0) + 1 < 5;
    const delayMinutes = Math.min(60, 2 ** Math.max(0, Number(lead.hydration_attempt_count || 0)));
    await db.query(
      `UPDATE meta_leads SET hydration_status = ?, hydration_last_error = ?,
       hydration_next_attempt_at = IF(?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE), NULL)
       WHERE id = ?`,
      [retry ? "RETRY" : "FAILED", message, retry, delayMinutes, lead.id]
    );
    return { processed: true, leadId: lead.id, hydrated: false, retry, error: message };
  }
}

module.exports = {
  approveJob,
  getOverview,
  ingestWebhook,
  listConversations,
  listLeads,
  listMessages,
  processNextOutbound,
  processNextLead,
  queueMessage,
  replayUnmatchedEvents,
  saveIntegration,
  setAiMode,
  updateConversation,
  updateLead,
};
