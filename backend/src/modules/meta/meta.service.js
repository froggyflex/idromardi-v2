const crypto = require("crypto");
const axios = require("axios");
const db = require("../../config/db");
const { decryptSecret, encryptSecret } = require("./meta.crypto");
const {
  instagramApiTarget,
  resolveInstagramMode,
  verifyInstagramConnection,
} = require("./meta.instagram");
const webhook = require("./meta.webhook");
const policy = require("./meta.policy");
const assets = require("./meta.assets")({ db, client: axios, audit });
const operations = require("./meta.operations")({ db, client: axios, assets, audit, messageContext, mysqlDateTime, parseJson });

const CHANNEL_TYPES = new Set(["WHATSAPP", "MESSENGER", "INSTAGRAM"]);
const AI_MODES = new Set(["OFF", "DRAFT", "APPROVAL", "AUTO"]);

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function metaApiErrorMessage(error) {
  return policy.safeError(error);
}

function normalizeAccessToken(value) {
  return String(value || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+/g, "");
}

async function inspectMetaAccessToken({
  token,
  appId,
  version,
  requiredScopes = ["whatsapp_business_management", "whatsapp_business_messaging"],
}) {
  const appSecret = String(process.env.META_APP_SECRET || "").trim();
  if (!appSecret) {
    throw httpError(500, "META_APP_SECRET non configurato", "META_APP_SECRET_MISSING");
  }
  const response = await axios.get(`https://graph.facebook.com/${version}/debug_token`, {
    headers: { Authorization: `Bearer ${appId}|${appSecret}` },
    params: { input_token: token },
    timeout: Number(process.env.META_GRAPH_TIMEOUT_MS || 15000),
  });
  const data = response.data?.data || {};
  const scopes = Array.isArray(data.scopes) ? data.scopes.map(String) : [];
  const missingScopes = requiredScopes.filter((scope) => !scopes.includes(scope));
  return {
    isValid: data.is_valid === true,
    appId: data.app_id ? String(data.app_id) : null,
    type: data.type || null,
    expiresAt: Number(data.expires_at || 0) || null,
    dataAccessExpiresAt: Number(data.data_access_expires_at || 0) || null,
    scopes,
    missingScopes,
  };
}

function mysqlDateTime(value = new Date()) {
  const date = policy.utcDate(value);
  if (!date || !Number.isFinite(date.getTime())) throw httpError(400, "Data non valida", "META_DATE_INVALID");
  return date.toISOString().slice(0, 23).replace("T", " ");
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
      (SELECT COALESCE(SUM(unread_count), 0) FROM meta_conversations
       WHERE status IN ('OPEN', 'PENDING')) AS unread_messages,
      (SELECT COUNT(*) FROM meta_outbound_jobs WHERE state = 'WAITING_APPROVAL') AS awaiting_approval,
      (SELECT COUNT(*) FROM meta_outbound_jobs WHERE state IN ('READY', 'PROCESSING', 'RETRY')) AS queued_messages,
      (SELECT COUNT(*) FROM meta_outbound_jobs WHERE state IN ('FAILED', 'UNCERTAIN')) AS failed_messages,
      (SELECT COUNT(*) FROM meta_leads WHERE hydration_status IN ('FAILED','RETRY','PROCESSING')) AS lead_errors`),
    db.query(`SELECT id, name, business_account_id, app_id, graph_api_version, token_expires_at,
                     status, ai_mode, last_error, created_at, updated_at,
                     encrypted_access_token IS NOT NULL AS has_access_token
              FROM meta_integrations ORDER BY created_at DESC`),
    db.query(`SELECT id, integration_id, channel_type, external_account_id, display_name, status,
                     token_expires_at, credential_mode, api_sender_id, leads_enabled, last_token_refresh_at, refresh_error,
                     last_verified_at, last_error, created_at, updated_at,
                     encrypted_access_token IS NOT NULL AS has_access_token
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
    instagramLogin: {
      appId: String(process.env.META_INSTAGRAM_APP_ID || "").trim() || null,
      appSecretConfigured: Boolean(String(process.env.META_INSTAGRAM_APP_SECRET || "").trim()),
      verifyTokenConfigured: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
    },
    outboxWorkerEnabled:
      String(process.env.META_OUTBOX_WORKER_ENABLED || "false").toLowerCase() === "true",
  };
}

async function getUnreadSummary() {
  const [[summary]] = await db.query(
    `SELECT
       COALESCE(SUM(cv.unread_count), 0) AS total,
       COALESCE(SUM(IF(ch.channel_type = 'WHATSAPP', cv.unread_count, 0)), 0) AS whatsapp,
       COALESCE(SUM(IF(ch.channel_type = 'MESSENGER', cv.unread_count, 0)), 0) AS messenger,
       COALESCE(SUM(IF(ch.channel_type = 'INSTAGRAM', cv.unread_count, 0)), 0) AS instagram,
       COUNT(DISTINCT IF(cv.unread_count > 0, cv.id, NULL)) AS conversations
     FROM meta_conversations cv
     JOIN meta_channels ch ON ch.id = cv.channel_id
     WHERE cv.status IN ('OPEN', 'PENDING')`
  );
  return {
    total: Number(summary?.total || 0),
    conversations: Number(summary?.conversations || 0),
    byChannel: {
      whatsapp: Number(summary?.whatsapp || 0),
      messenger: Number(summary?.messenger || 0),
      instagram: Number(summary?.instagram || 0),
    },
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
  if(channels.length)throw httpError(400,"Salva e verifica ogni canale nella sezione Canali di produzione.","META_USE_CHANNEL_SETUP");
  for (const channel of channels) {
    const type = String(channel.channelType || "").toUpperCase();
    if (!CHANNEL_TYPES.has(type) || !String(channel.externalAccountId || "").trim()) {
      throw httpError(400, "Canale Meta non valido", "META_CHANNEL_INVALID");
    }
  }

  const normalizedToken = input.accessToken ? normalizeAccessToken(input.accessToken) : "";
  const token = normalizedToken ? encryptSecret(normalizedToken) : null;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query(
      `SELECT id, encrypted_access_token, status, app_id, business_account_id, graph_api_version FROM meta_integrations WHERE id = ? LIMIT 1 FOR UPDATE`,
      [id]
    );
    const [[channelSummary]] = existing.length
      ? await conn.query(
          `SELECT COUNT(*) AS count, COALESCE(SUM(status = 'ACTIVE'), 0) AS active
           FROM meta_channels WHERE integration_id = ?`,
          [id]
        )
      : [[{ count: 0, active: 0 }]];
    const changedIdentity = existing.length && (
      String(existing[0].app_id || "") !== String(input.appId || "") ||
      String(existing[0].business_account_id || "") !== String(input.businessAccountId || "") ||
      String(existing[0].graph_api_version || "") !== graphVersion
    );
    if(changedIdentity) {
      await conn.query("UPDATE meta_channels SET status=IF(status='PAUSED','PAUSED','PENDING'),last_verified_at=NULL,last_error='Configurazione generale modificata: verifica nuovamente il canale' WHERE integration_id=?",[id]);
    }
    const willBeConnected = !changedIdentity && Boolean(
      Number(channelSummary?.active || 0) > 0 ||
        ((token || existing[0]?.encrypted_access_token) && channels.length)
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
          input.status === "PAUSED" || (input.status === undefined && existing[0].status === "PAUSED") ? "PAUSED" : willBeConnected ? "CONNECTED" : "PENDING",
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

async function refreshIntegrationConnectionStatus(conn, integrationId) {
  const [[summary]] = await conn.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'ACTIVE'), 0) AS active
     FROM meta_channels WHERE integration_id = ?`,
    [integrationId]
  );
  const status = Number(summary?.active || 0) > 0 ? "CONNECTED" : "PENDING";
  await conn.query(
    `UPDATE meta_integrations SET status = ?, last_error = IF(? = 'CONNECTED', NULL, last_error)
     WHERE id = ? AND status <> 'PAUSED'`,
    [status, status, integrationId]
  );
  return { status, total: Number(summary?.total || 0), active: Number(summary?.active || 0) };
}

async function saveChannel(integrationId, input, actor) {
  const channelType = String(input.channelType || "").toUpperCase();
  const externalAccountId = String(input.externalAccountId || "").trim();
  if (!CHANNEL_TYPES.has(channelType) || !externalAccountId) {
    throw httpError(400, "Tipo canale e ID account sono obbligatori", "META_CHANNEL_INVALID");
  }
  const normalizedToken = input.accessToken ? normalizeAccessToken(input.accessToken) : "";
  const encryptedToken = normalizedToken ? encryptSecret(normalizedToken) : null;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[integration]] = await conn.query(
      `SELECT id, encrypted_access_token, token_iv, token_auth_tag, token_expires_at
       FROM meta_integrations WHERE id = ? LIMIT 1 FOR UPDATE`,
      [integrationId]
    );
    if (!integration) {
      throw httpError(404, "Integrazione Meta non trovata", "META_INTEGRATION_NOT_FOUND");
    }
    const requestedId = input.id ? String(input.id) : null;
    const [[existing]] = requestedId
      ? await conn.query(
          `SELECT * FROM meta_channels WHERE id = ? AND integration_id = ? LIMIT 1 FOR UPDATE`,
          [requestedId, integrationId]
        )
      : await conn.query(
          `SELECT * FROM meta_channels WHERE integration_id = ? AND channel_type = ?
           ORDER BY created_at LIMIT 1 FOR UPDATE`,
          [integrationId, channelType]
        );
    if (requestedId && !existing) {
      throw httpError(404, "Canale Meta non trovato", "META_CHANNEL_NOT_FOUND");
    }
    if(!existing || existing.external_account_id !== externalAccountId) {
      const [duplicates] = await conn.query("SELECT id,integration_id FROM meta_channels WHERE channel_type=? AND external_account_id=? AND integration_id<>? LIMIT 1",[channelType,externalAccountId,integrationId]);
      if(duplicates.length)throw httpError(409,"Questo account è già collegato a un’altra integrazione. Selezionala per aggiornare il token; non duplicare lo stesso canale.","META_CHANNEL_ALREADY_LINKED");
    }
    // Never move an existing history/queue to a different sender account.
    if (existing && (existing.external_account_id !== externalAccountId || existing.channel_type !== channelType)) {
      const [[history]] = await conn.query("SELECT COUNT(*) AS count FROM meta_conversations WHERE channel_id = ?", [existing.id]);
      if (Number(history.count)) throw httpError(409,
        "Questo canale ha uno storico. Crea una nuova integrazione per il numero/account di produzione; conserva il canale di prova in pausa.",
        "META_CHANNEL_HAS_HISTORY");
    }
    const channelId = existing?.id || crypto.randomUUID();
    const credentialMode = channelType === "INSTAGRAM"
      ? resolveInstagramMode(input.credentialMode, existing?.credential_mode)
      : null;
    const legacyWhatsAppCredential =
      channelType === "WHATSAPP" && !encryptedToken && !existing?.encrypted_access_token
        ? integration
        : null;
    if (existing) {
      await conn.query(
        `UPDATE meta_channels SET channel_type = ?, external_account_id = ?, display_name = ?,
           encrypted_access_token = COALESCE(?, encrypted_access_token),
           token_iv = COALESCE(?, token_iv), token_auth_tag = COALESCE(?, token_auth_tag),
           token_expires_at = ?, credential_mode = ?, api_sender_id = NULL,
           status = 'PENDING', last_verified_at = NULL, last_error = NULL
         WHERE id = ?`,
        [
          channelType,
          externalAccountId,
          input.displayName ? String(input.displayName).trim() : null,
          encryptedToken?.encrypted || legacyWhatsAppCredential?.encrypted_access_token || null,
          encryptedToken?.iv || legacyWhatsAppCredential?.token_iv || null,
          encryptedToken?.authTag || legacyWhatsAppCredential?.token_auth_tag || null,
          input.tokenExpiresAt
            ? mysqlDateTime(input.tokenExpiresAt)
            : encryptedToken
              ? null
              : existing.token_expires_at || legacyWhatsAppCredential?.token_expires_at || null,
          credentialMode,
          channelId,
        ]
      );
    } else {
      await conn.query(
        `INSERT INTO meta_channels
           (id, integration_id, channel_type, external_account_id, display_name, status,
            encrypted_access_token, token_iv, token_auth_tag, token_expires_at, credential_mode)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)`,
        [
          channelId,
          integrationId,
          channelType,
          externalAccountId,
          input.displayName ? String(input.displayName).trim() : null,
          encryptedToken?.encrypted || legacyWhatsAppCredential?.encrypted_access_token || null,
          encryptedToken?.iv || legacyWhatsAppCredential?.token_iv || null,
          encryptedToken?.authTag || legacyWhatsAppCredential?.token_auth_tag || null,
          input.tokenExpiresAt
            ? mysqlDateTime(input.tokenExpiresAt)
            : legacyWhatsAppCredential?.token_expires_at || null,
          credentialMode,
        ]
      );
    }
    if(encryptedToken) await conn.query("UPDATE meta_channels SET refresh_error=NULL,last_token_refresh_at=NULL WHERE id=?",[channelId]);
    if (input.leadsEnabled !== undefined && channelType === "MESSENGER") {
      await conn.query("UPDATE meta_channels SET leads_enabled = ? WHERE id = ?", [input.leadsEnabled === true ? 1 : 0, channelId]);
    }
    await refreshIntegrationConnectionStatus(conn, integrationId);
    await audit(conn, {
      integrationId,
      actorId: actor.sub,
      actorKind: "HUMAN",
      action: existing ? "CHANNEL_UPDATED" : "CHANNEL_CREATED",
      entityType: "CHANNEL",
      entityId: channelId,
      details: { channelType, externalAccountId, credentialMode, tokenUpdated: Boolean(encryptedToken) },
    });
    await conn.commit();
    return { channelId, overview: await getOverview() };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

function effectiveChannelCredential(channel) {
  if (channel.encrypted_access_token) {
    return {
      encrypted: channel.encrypted_access_token,
      iv: channel.token_iv,
      authTag: channel.token_auth_tag,
    };
  }
  if (channel.channel_type === "WHATSAPP" && channel.integration_access_token) {
    return {
      encrypted: channel.integration_access_token,
      iv: channel.integration_token_iv,
      authTag: channel.integration_token_auth_tag,
    };
  }
  return null;
}

async function verifyChannel(channelId, actor) {
  const [[channel]] = await db.query(
    `SELECT ch.*, i.business_account_id, i.app_id, i.graph_api_version,
            i.encrypted_access_token AS integration_access_token,
            i.token_iv AS integration_token_iv,
            i.token_auth_tag AS integration_token_auth_tag
     FROM meta_channels ch
     JOIN meta_integrations i ON i.id = ch.integration_id
     WHERE ch.id = ? LIMIT 1`,
    [channelId]
  );
  if (!channel) throw httpError(404, "Canale Meta non trovato", "META_CHANNEL_NOT_FOUND");
  if (channel.status === "PAUSED") {
    throw httpError(409, "Riattiva il canale prima di verificarlo", "META_CHANNEL_PAUSED");
  }
  const credentialSnapshot = [channelId, channel.external_account_id,
    channel.encrypted_access_token || null, channel.credential_mode || null];
  const credential = effectiveChannelCredential(channel);
  if (!credential?.encrypted) {
    throw httpError(400, "Access token del canale non presente", "META_CHANNEL_TOKEN_MISSING");
  }
  const version = String(
    channel.graph_api_version || process.env.META_GRAPH_API_VERSION || ""
  ).trim();
  if (!version) throw httpError(400, "Versione Graph API mancante", "META_GRAPH_VERSION_MISSING");
  let verifiedName = channel.display_name || null;
  let details = {};
  try {
    const token = decryptSecret(credential);
    const requestConfig = {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      timeout: Number(process.env.META_GRAPH_TIMEOUT_MS || 15000),
    };
    if (channel.channel_type === "WHATSAPP") {
      const wabaId = String(channel.business_account_id || "").trim();
      const appId = String(channel.app_id || "").trim();
      if (!wabaId || !appId) {
        throw httpError(400, "WABA ID e Meta App ID sono obbligatori", "META_WHATSAPP_DATA_MISSING");
      }
      const inspection = await inspectMetaAccessToken({ token, appId, version });
      if (!inspection.isValid || inspection.missingScopes.length) {
        throw httpError(
          403,
          inspection.missingScopes.length
            ? `Permessi token mancanti: ${inspection.missingScopes.join(", ")}`
            : "Il token WhatsApp non è valido",
          "META_WHATSAPP_TOKEN_INVALID"
        );
      }
      if (inspection.appId && inspection.appId !== appId) {
        throw httpError(403, "Il token appartiene a una Meta App diversa", "META_TOKEN_APP_MISMATCH");
      }
      const baseUrl = `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}`;
      await axios.post(`${baseUrl}/subscribed_apps`, null, requestConfig);
      const phonesResponse = await axios.get(`${baseUrl}/phone_numbers`, {
        ...requestConfig,
        params: { fields: "id,display_phone_number,verified_name,status,quality_rating" },
      });
      const phones = Array.isArray(phonesResponse.data?.data) ? phonesResponse.data.data : [];
      const phone = phones.find((item) => String(item.id) === String(channel.external_account_id));
      if (!phone) {
        throw httpError(409, "Il Phone Number ID non appartiene al WABA configurato", "META_PHONE_MISMATCH");
      }
      if (phone.status && phone.status !== "CONNECTED") {
        throw httpError(409, `Numero WhatsApp non operativo (${phone.status}). Completa la registrazione in WhatsApp Manager.`, "META_PHONE_NOT_CONNECTED");
      }
      verifiedName = phone.verified_name || phone.display_phone_number || verifiedName;
      details = {
        phoneNumber: phone.display_phone_number || null,
        qualityRating: phone.quality_rating || null,
        tokenType: inspection.type,
        scopes: inspection.scopes,
        expiresAt: inspection.expiresAt,
        dataAccessExpiresAt: inspection.dataAccessExpiresAt,
      };
    } else if (channel.channel_type === "MESSENGER") {
      const baseUrl = `https://graph.facebook.com/${version}`;
      const appId = String(channel.app_id || "").trim();
      if (!appId) throw httpError(400, "Meta App ID obbligatorio", "META_APP_ID_MISSING");
      const inspection = await inspectMetaAccessToken({
        token,
        appId,
        version,
        requiredScopes: [
          "pages_messaging",
          "pages_manage_metadata",
          "pages_read_engagement",
          ...(channel.leads_enabled ? ["leads_retrieval", "pages_show_list", "ads_management", "pages_manage_ads"] : []),
        ],
      });
      if (!inspection.isValid || inspection.missingScopes.length) {
        throw httpError(
          403,
          inspection.missingScopes.length
            ? `Permessi token mancanti: ${inspection.missingScopes.join(", ")}`
            : "Il Page access token non è valido",
          "META_MESSENGER_TOKEN_INVALID"
        );
      }
      if (inspection.appId && inspection.appId !== appId) {
        throw httpError(403, "Il Page token appartiene a una Meta App diversa", "META_TOKEN_APP_MISMATCH");
      }
      const profileResponse = await axios.get(`${baseUrl}/me`, {
        ...requestConfig,
        params: { fields: "id,name" },
      });
      if (String(profileResponse.data?.id || "") !== String(channel.external_account_id)) {
        throw httpError(409, "Il Page access token appartiene a una Pagina diversa", "META_PAGE_MISMATCH");
      }
      const subscriptionUrl = `${baseUrl}/${encodeURIComponent(channel.external_account_id)}/subscribed_apps`;
      const existingSubscriptions = await axios.get(subscriptionUrl, requestConfig);
      const existingFields = (existingSubscriptions.data?.data || []).find(item => String(item.id) === appId)?.subscribed_fields || [];
      const subscribedFields = [...new Set([...existingFields, "messages", "messaging_postbacks", "message_deliveries", "message_reads",
        ...(channel.leads_enabled ? ["leadgen"] : [])])];
      const subscribed = await axios.post(subscriptionUrl, null, {
        ...requestConfig,
        params: {
          subscribed_fields:
            subscribedFields.join(","),
        },
      });
      if (subscribed.data?.success !== true) throw httpError(502, "Meta non ha confermato l'iscrizione della Pagina.", "META_SUBSCRIPTION_FAILED");
      verifiedName = profileResponse.data?.name || verifiedName;
      details = {
        pageId: profileResponse.data?.id,
        subscribedFields,
        scopes: inspection.scopes,
        expiresAt: inspection.expiresAt,
        dataAccessExpiresAt: inspection.dataAccessExpiresAt,
      };
    } else {
      details = await verifyInstagramConnection({
        channel, token, version, client: axios, inspectToken: inspectMetaAccessToken,
        config: {
          instagramAppId: String(process.env.META_INSTAGRAM_APP_ID || "").trim(),
          instagramAppSecret: String(process.env.META_INSTAGRAM_APP_SECRET || "").trim(),
          mainAppSecret: String(process.env.META_APP_SECRET || "").trim(),
          verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
          timeout: Number(process.env.META_GRAPH_TIMEOUT_MS || 15000),
        },
      });
      verifiedName = details.username ? `@${details.username}` : verifiedName;
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [verificationUpdate] = await conn.query(
        `UPDATE meta_channels SET status = 'ACTIVE', display_name = COALESCE(?, display_name),
         credential_mode = ?, api_sender_id = ?,
         last_verified_at = CURRENT_TIMESTAMP(3), last_error = NULL
         WHERE id = ? AND external_account_id = ? AND encrypted_access_token <=> ?
           AND credential_mode <=> ? AND status <> 'PAUSED'`,
        [
          verifiedName,
          channel.channel_type === "INSTAGRAM" ? details.credentialMode || null : null,
          channel.channel_type === "INSTAGRAM"
            ? details.pageId || details.instagramId || channel.external_account_id
            : channel.external_account_id,
          ...credentialSnapshot,
        ]
      );
      if (!verificationUpdate.affectedRows) {
        throw httpError(409, "Il canale è stato modificato durante la verifica: verifica nuovamente i dati salvati.", "META_CHANNEL_CHANGED");
      }
      const expiries = [details.expiresAt, details.dataAccessExpiresAt].filter(value => Number(value) > 0);
      if (channel.channel_type !== "INSTAGRAM") {
        await conn.query("UPDATE meta_channels SET token_expires_at = ? WHERE id = ?", [
          expiries.length ? mysqlDateTime(new Date(Math.min(...expiries) * 1000)) : null, channelId,
        ]);
      }
      await refreshIntegrationConnectionStatus(conn, channel.integration_id);
      await audit(conn, {
        integrationId: channel.integration_id,
        actorId: actor.sub,
        actorKind: "HUMAN",
        action: "CHANNEL_CONNECTION_VERIFIED",
        entityType: "CHANNEL",
        entityId: channelId,
        details: { channelType: channel.channel_type, ...details },
      });
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    const replay = await replayUnmatchedEvents();
    return { fullyConnected: true, channelType: channel.channel_type, details, replay, overview: await getOverview() };
  } catch (error) {
    const message = metaApiErrorMessage(error);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE meta_channels SET status = 'ERROR', last_error = ?
         WHERE id = ? AND external_account_id = ? AND encrypted_access_token <=> ?
           AND credential_mode <=> ? AND status <> 'PAUSED'`,
        [message, ...credentialSnapshot]
      );
      await refreshIntegrationConnectionStatus(conn, channel.integration_id);
      await conn.commit();
    } catch (updateError) {
      await conn.rollback();
      console.error("Unable to persist Meta channel verification error", updateError);
    } finally {
      conn.release();
    }
    const failure = httpError(502, `Verifica ${channel.channel_type} non riuscita: ${message}`, "META_CHANNEL_VERIFICATION_FAILED");
    if (error.verification) failure.verification = error.verification;
    throw failure;
  }
}

async function setChannelStatus(channelId, status, actor) {
  const normalized = String(status || "").toUpperCase();
  if (!new Set(["PAUSED", "PENDING"]).has(normalized)) {
    throw httpError(400, "Stato canale non valido", "META_CHANNEL_STATUS_INVALID");
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[channel]] = await conn.query(
      `SELECT integration_id, channel_type FROM meta_channels WHERE id = ? LIMIT 1 FOR UPDATE`,
      [channelId]
    );
    if (!channel) throw httpError(404, "Canale Meta non trovato", "META_CHANNEL_NOT_FOUND");
    await conn.query(`UPDATE meta_channels SET status = ? WHERE id = ?`, [normalized, channelId]);
    await refreshIntegrationConnectionStatus(conn, channel.integration_id);
    await audit(conn, {
      integrationId: channel.integration_id,
      actorId: actor.sub,
      actorKind: "HUMAN",
      action: "CHANNEL_STATUS_CHANGED",
      entityType: "CHANNEL",
      entityId: channelId,
      details: { channelType: channel.channel_type, status: normalized },
    });
    await conn.commit();
    return { ok: true, overview: await getOverview() };
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
     WHERE c.channel_type = ? AND c.external_account_id = ?
     ORDER BY (c.status = 'ACTIVE') DESC,c.last_verified_at DESC,c.updated_at DESC,c.id DESC LIMIT 2`,
    [channelType, accountId]
  );
  if(rows.length>1 && rows[0].status==='ACTIVE' && rows[1].status==='ACTIVE')throw httpError(409,"Lo stesso account è attivo in più integrazioni. Sospendi il duplicato e recupera gli eventi.","META_DUPLICATE_ACTIVE_CHANNEL");
  return rows[0] || null;
}

async function upsertInboundMessage(conn, channel, event) {
  if (!event.contactId || !event.externalMessageId) return;
  // Check the message tombstone before touching the contact or reopening a thread.
  const [[existing]] = await conn.query(
    "SELECT id FROM meta_messages WHERE channel_id = ? AND external_message_id = ? LIMIT 1",
    [channel.id, event.externalMessageId]);
  if (existing) {
    if (event.isEcho) await applyStatus(conn, channel, { ...event, status: "SENT" });
    return;
  }
  const contactId = crypto.randomUUID();
  await conn.query(
    `INSERT INTO meta_contacts (id, integration_id, channel_type, external_contact_id, display_name, phone)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE display_name = COALESCE(VALUES(display_name), display_name)`,
    [contactId, channel.integration_id, event.channelType, event.contactId, event.contactName || null,
      event.channelType === "WHATSAPP" ? event.contactId : null]);
  const [[contact]] = await conn.query(
    "SELECT id FROM meta_contacts WHERE integration_id = ? AND channel_type = ? AND external_contact_id = ? LIMIT 1",
    [channel.integration_id, event.channelType, event.contactId]);
  const conversationId = crypto.randomUUID();
  await conn.query(
    `INSERT INTO meta_conversations (id, integration_id, channel_id, contact_id)
     VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
    [conversationId, channel.integration_id, channel.id, contact.id]);
  const [[conversation]] = await conn.query(
    "SELECT id FROM meta_conversations WHERE channel_id = ? AND contact_id = ? LIMIT 1 FOR UPDATE", [channel.id, contact.id]);
  const [insert] = await conn.query(
    `INSERT IGNORE INTO meta_messages
     (id, conversation_id, channel_id, external_message_id, direction, sender_kind, message_type, body_text, payload_json, status, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), conversation.id, channel.id, event.externalMessageId,
      event.isEcho ? "OUTBOUND" : "INBOUND", event.isEcho ? "SYSTEM" : "CONTACT",
      event.messageType, event.text, JSON.stringify(event.payload || {}), event.isEcho ? "SENT" : "RECEIVED", mysqlDateTime(event.occurredAt)]);
  if (!insert.affectedRows) return;
  const occurred = mysqlDateTime(event.occurredAt);
  await conn.query(
    `UPDATE meta_conversations SET
       last_message_at = GREATEST(COALESCE(last_message_at, ?), ?),
       last_inbound_at = IF(?, last_inbound_at, GREATEST(COALESCE(last_inbound_at, ?), ?)),
       reply_window_expires_at = IF(?, reply_window_expires_at, DATE_ADD(last_inbound_at, INTERVAL 24 HOUR)),
       unread_count = unread_count + ?,
       archived_at = IF(? OR status = 'SPAM', archived_at, NULL),
       status = IF(? OR status = 'SPAM', status, 'OPEN')
     WHERE id = ?`,
    [occurred, occurred, event.isEcho ? 1 : 0, occurred, occurred, event.isEcho ? 1 : 0,
      event.isEcho ? 0 : 1, event.isEcho ? 1 : 0, event.isEcho ? 1 : 0, conversation.id]);
}

function presentMessages(rows) {
  return serializeRows(rows).map(row => {
    const attachments = require("./meta.assets").attachmentDescriptors(row);
    const { payload_json, status_payload_json, request_json, ...safe } = row;
    return { ...safe, attachments };
  });
}

async function upsertLead(conn, channel, event) {
  await conn.query(
    `INSERT INTO meta_leads
       (id, integration_id, channel_id, external_lead_id, form_id, ad_id,
        raw_payload_json, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE raw_payload_json = IF(hydration_status = 'COMPLETE',raw_payload_json,VALUES(raw_payload_json))`,
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
  if (!["SENT", "DELIVERED", "READ", "FAILED"].includes(event.status)) return true;
  if (event.status === "READ" && !event.externalMessageId && event.contactId) {
    await conn.query(
      `UPDATE meta_messages m JOIN meta_conversations cv ON cv.id = m.conversation_id
       JOIN meta_contacts c ON c.id = cv.contact_id SET m.status = 'READ'
       WHERE m.channel_id = ? AND m.direction = 'OUTBOUND' AND c.external_contact_id = ?
         AND m.occurred_at <= ? AND m.status IN ('SENT', 'DELIVERED')`,
      [channel.id, event.contactId, mysqlDateTime(event.occurredAt)]);
    return true;
  }
  const [[message]] = await conn.query(
    "SELECT id, status, deleted_at FROM meta_messages WHERE channel_id = ? AND external_message_id = ? FOR UPDATE",
    [channel.id, event.externalMessageId]);
  if (!message) return false; // Receipt may arrive before the HTTP send response.
  const ranks = { SENT: 1, DELIVERED: 2, READ: 3 };
  const advance = event.status === "FAILED" ? !["DELIVERED", "READ"].includes(message.status)
    : (ranks[event.status] || 0) >= (ranks[message.status] || 0);
  if (advance) await conn.query(
    "UPDATE meta_messages SET status = ?, status_payload_json = ?, error_message = ? WHERE id = ?",
    [event.status, message.deleted_at ? null : JSON.stringify(event.payload || {}),
      event.status === "FAILED" ? String(event.payload?.errors?.[0]?.message || "Consegna non riuscita").slice(0,1000) : null, message.id]);
  if(advance) await conn.query(
    `UPDATE meta_outbound_jobs SET state = ?, last_error = ?, locked_at = NULL WHERE message_id = ?
     AND state IN ('PROCESSING','UNCERTAIN','RETRY','SENT','FAILED')`,
    [event.status === "FAILED" ? "FAILED" : "SENT", event.status === "FAILED" ? "Consegna rifiutata da Meta" : null, message.id]);
  return true;
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
    if (event.kind === "STATUS" && !(await applyStatus(conn, channel, event))) unmatched += 1;
  }
  return { events: events.length, matched, unmatched };
}

async function processStoredWebhook(id) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[event]] = await conn.query("SELECT * FROM meta_webhook_events WHERE id = ? FOR UPDATE SKIP LOCKED", [id]);
    if (!event || event.processing_status === "PROCESSED") { await conn.commit(); return { processed: false }; }
    const result = await processWebhookPayload(conn, parseJson(event.payload_json) || {});
    await conn.query(
      `UPDATE meta_webhook_events SET processing_status = ?, attempt_count = attempt_count + 1,
       error_message = NULL, processed_at = CURRENT_TIMESTAMP(3),
       next_attempt_at = IF(?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE), NULL) WHERE id = ?`,
      [result.unmatched ? "UNMATCHED" : "PROCESSED", result.unmatched > 0, id]);
    await conn.commit();
    return { processed: true, ...result };
  } catch (error) {
    await conn.rollback();
    await db.query(
      `UPDATE meta_webhook_events SET processing_status = 'FAILED', attempt_count = attempt_count + 1,
       error_message = ?, next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE)
       WHERE id = ? AND processing_status <> 'PROCESSED'`, [policy.safeError(error), id]);
    return { processed: false, failed: true };
  } finally { conn.release(); }
}

async function replayUnmatchedEvents({ limit = 100, automatic = false } = {}) {
  const safeLimit = Math.max(1, policy.boundedInt(limit, 100, 500));
  const [rows] = await db.query(
    `SELECT id FROM meta_webhook_events WHERE processing_status IN ('RECEIVED','FAILED','UNMATCHED')
     ${automatic ? "AND attempt_count < 20 AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP(3))" : ""}
     ORDER BY received_at LIMIT ?`, [safeLimit]);
  const summary = { examined: rows.length, processed: 0, stillUnmatched: 0, failed: 0 };
  for (const row of rows) {
    const result = await processStoredWebhook(row.id);
    if (result.failed) summary.failed++;
    else if (result.unmatched) summary.stillUnmatched++;
    else if (result.processed) summary.processed++;
  }
  return summary;
}

// Backwards-compatible endpoint: each channel must pass the same current checks.
async function verifyWhatsAppIntegration(integrationId, actor) {
  const [channels] = await db.query("SELECT id FROM meta_channels WHERE integration_id=? AND channel_type='WHATSAPP'",[integrationId]);
  if(!channels.length)throw httpError(404,"Nessun canale WhatsApp configurato.","META_CHANNEL_NOT_FOUND");
  const results=[];
  for(const channel of channels)results.push(await verifyChannel(channel.id,actor));
  return {fullyConnected:true,channels:results,overview:await getOverview()};
}

async function ingestWebhook(rawBody, payload) {
  const key = webhook.eventKey(rawBody);
  await db.query(
    "INSERT IGNORE INTO meta_webhook_events (id, event_key, object_type, payload_json) VALUES (?, ?, ?, ?)",
    [crypto.randomUUID(), key, payload?.object || null, JSON.stringify(payload)]);
  const [[stored]] = await db.query("SELECT id, processing_status FROM meta_webhook_events WHERE event_key = ?", [key]);
  if (stored.processing_status === "PROCESSED") return { accepted: true, duplicate: true };
  // Store first. A failed local processor must not make an accepted event disappear:
  // duplicate delivery and the worker can both recover this durable row.
  const result = await processStoredWebhook(stored.id);
  return { accepted: true, ...result };
}

async function listConversations({ status = "ACTIVE", channel = "ALL", limit = 100, offset = 0, search = "", id = null } = {}) {
  const safeLimit = Math.max(1, policy.boundedInt(limit,100,200));
  const normalizedStatus = String(status).toUpperCase();
  const normalizedChannel = String(channel).toUpperCase();
  if (normalizedChannel !== "ALL" && !CHANNEL_TYPES.has(normalizedChannel)) {
    throw httpError(400, "Filtro canale non valido", "META_CHANNEL_FILTER_INVALID");
  }
  const params = [];
  const clauses = [];
  if (id) { clauses.push("cv.id = ?"); params.push(String(id)); }
  if (normalizedStatus === "ACTIVE") {
    clauses.push("cv.status <> 'ARCHIVED'");
  } else if (normalizedStatus !== "ALL") {
    clauses.push("cv.status = ?");
    params.push(normalizedStatus);
  }
  if (normalizedChannel !== "ALL") {
    clauses.push("ch.channel_type = ?");
    params.push(normalizedChannel);
  }
  if (String(search).trim()) {
    clauses.push("LOCATE(LOWER(?), LOWER(CONCAT_WS(' ',c.display_name,c.phone,c.email,c.external_contact_id))) > 0");
    params.push(String(search).trim().slice(0,200));
  }
  params.push(safeLimit + 1, policy.boundedInt(offset,0,1000000));
  const [rows] = await db.query(
    `SELECT cv.*, c.display_name, c.external_contact_id, c.phone, c.email, c.consent_status, c.consent_note,
            ch.channel_type, ch.display_name AS channel_name, ch.status AS channel_status,
            last_message.body_text AS last_message_text,
            last_message.deleted_at AS last_message_deleted_at,
            last_message.sender_kind AS last_message_sender
     FROM meta_conversations cv
     JOIN meta_contacts c ON c.id = cv.contact_id
     JOIN meta_channels ch ON ch.id = cv.channel_id
     LEFT JOIN meta_messages last_message ON last_message.id = (
       SELECT m.id FROM meta_messages m WHERE m.conversation_id = cv.id
       ORDER BY m.occurred_at DESC, m.created_at DESC, m.id DESC LIMIT 1
     )
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY cv.last_message_at DESC, cv.id DESC LIMIT ? OFFSET ?`,
    params
  );
  return { conversations: serializeRows(rows.slice(0,safeLimit)), hasMore: rows.length > safeLimit };
}

async function listMessages(conversationId, { limit = 200, before = null } = {}) {
  const safeLimit = Math.max(1, policy.boundedInt(limit,200,500));
  let cursor = null;
  if (before) {
    const [[row]] = await db.query("SELECT occurred_at,created_at,id FROM meta_messages WHERE id = ? AND conversation_id = ?", [before,conversationId]);
    if (!row) throw httpError(400,"Cursore messaggi non valido.","META_CURSOR_INVALID");
    cursor = row;
  }
  const [rows] = await db.query(
    `SELECT recent.* FROM (
       SELECT meta_messages.*, (SELECT state FROM meta_outbound_jobs WHERE message_id=meta_messages.id LIMIT 1) AS delivery_state FROM meta_messages WHERE conversation_id = ?
       ${cursor ? "AND (occurred_at,created_at,id) < (?,?,?)" : ""}
       ORDER BY occurred_at DESC, created_at DESC, id DESC LIMIT ?
     ) AS recent
     ORDER BY recent.occurred_at ASC, recent.created_at ASC, recent.id ASC`,
    [conversationId, ...(cursor ? [cursor.occurred_at,cursor.created_at,cursor.id] : []),safeLimit+1]
  );
  return { messages: presentMessages(rows.slice(-safeLimit)), hasMore: rows.length > safeLimit };
}

async function readConversation(conversationId, { limit = 200 } = {}) {
  const safeLimit = Math.max(1, policy.boundedInt(limit,200,500));
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[conversation]] = await conn.query(
      `SELECT id FROM meta_conversations WHERE id = ? LIMIT 1 FOR UPDATE`,
      [conversationId]
    );
    if (!conversation) {
      throw httpError(404, "Conversazione non trovata", "META_CONVERSATION_NOT_FOUND");
    }
    const [rows] = await conn.query(
      `SELECT recent.* FROM (
         SELECT meta_messages.*, (SELECT state FROM meta_outbound_jobs WHERE message_id=meta_messages.id LIMIT 1) AS delivery_state FROM meta_messages WHERE conversation_id = ?
         ORDER BY occurred_at DESC, created_at DESC, id DESC LIMIT ?
       ) AS recent
       ORDER BY recent.occurred_at ASC, recent.created_at ASC, recent.id ASC`,
      [conversationId, safeLimit]
    );
    await conn.query(`UPDATE meta_conversations SET unread_count = 0 WHERE id = ?`, [conversationId]);
    await conn.commit();
    return { messages: presentMessages(rows), hasMore: rows.length === safeLimit };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function listLeads({ status = "ALL", limit = 100, offset = 0, search = "" } = {}) {
  const safeLimit = Math.max(1, policy.boundedInt(limit,100,500));
  const params = [];
  let clause = "";
  if (status !== "ALL") {
    clause = "WHERE l.status = ?";
    params.push(String(status).toUpperCase());
  }
  if (String(search).trim()) {
    clause += `${clause ? " AND" : "WHERE"} LOCATE(LOWER(?),LOWER(CONCAT_WS(' ',c.display_name,c.phone,c.email,l.external_lead_id,l.notes))) > 0`;
    params.push(String(search).trim().slice(0,200));
  }
  params.push(safeLimit+1,policy.boundedInt(offset,0,1000000));
  const [rows] = await db.query(
    `SELECT l.*, c.display_name, c.phone, c.email, ch.channel_type, u.username AS assigned_name
     FROM meta_leads l
     LEFT JOIN meta_contacts c ON c.id = l.contact_id
     LEFT JOIN meta_channels ch ON ch.id = l.channel_id
     LEFT JOIN app_auth_users u ON u.id = l.assigned_to
     ${clause} ORDER BY l.received_at DESC,l.id DESC LIMIT ? OFFSET ?`,
    params
  );
  return { leads: serializeRows(rows.slice(0,safeLimit)), hasMore: rows.length > safeLimit };
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
    if (!new Set(["OPEN", "PENDING", "CLOSED", "SPAM", "ARCHIVED"]).has(status)) {
      throw httpError(400, "Stato conversazione non valido", "META_CONVERSATION_STATUS_INVALID");
    }
    updates.push("status = ?");
    params.push(status);
    updates.push(status === "ARCHIVED" ? "archived_at = CURRENT_TIMESTAMP(3)" : "archived_at = NULL");
    if (status === "ARCHIVED") updates.push("unread_count = 0");
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

async function deleteMessage(conversationId, messageId, actor) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[message]] = await conn.query(
      `SELECT m.*,cv.integration_id,cv.contact_id FROM meta_messages m
       JOIN meta_conversations cv ON cv.id=m.conversation_id
       WHERE m.id=? AND m.conversation_id=? FOR UPDATE`,[messageId,conversationId]);
    if(!message)throw httpError(404,"Messaggio non trovato","META_MESSAGE_NOT_FOUND");
    if(message.deleted_at){await conn.commit();return {ok:true,alreadyDeleted:true};}
    const [[running]]=await conn.query("SELECT id FROM meta_outbound_jobs WHERE message_id=? AND state='PROCESSING'",[messageId]);
    if(running)throw httpError(409,"Attendi la conclusione dell'invio prima di eliminare.","META_MESSAGE_IN_FLIGHT");
    await conn.query(`UPDATE meta_outbound_jobs SET state='CANCELLED',last_error='Contenuto eliminato'
      WHERE message_id=? AND state IN ('READY','RETRY','WAITING_APPROVAL','FAILED','UNCERTAIN')`,[messageId]);
    await conn.query(`UPDATE meta_messages SET body_text=NULL,payload_json=NULL,request_json=NULL,status_payload_json=NULL,error_message=NULL,
      deleted_at=CURRENT_TIMESTAMP(3),deleted_by=? WHERE id=?`,[actor.sub,messageId]);
    await conn.query("DELETE FROM meta_attachments WHERE message_id=?",[messageId]);
    await conn.query("UPDATE meta_contacts SET profile_json=NULL WHERE id=?",[message.contact_id]);
    if(message.external_message_id){
      const [events]=await conn.query("SELECT id,payload_json FROM meta_webhook_events WHERE JSON_SEARCH(payload_json,'one',?) IS NOT NULL FOR UPDATE",[message.external_message_id]);
      for(const event of events) await conn.query("UPDATE meta_webhook_events SET payload_json=? WHERE id=?",
        [JSON.stringify(policy.redactPayload(parseJson(event.payload_json),new Set([message.external_message_id]))||{}),event.id]);
    }
    await audit(conn,{integrationId:message.integration_id,actorId:actor.sub,actorKind:"HUMAN",action:"MESSAGE_CONTENT_DELETED",entityType:"MESSAGE",entityId:messageId});
    await conn.commit();return {ok:true};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
}

async function messageContext(conversationId, conn = db) {
  const [[row]] = await conn.query(
    `SELECT cv.*, cv.status AS conversation_status, c.consent_status, c.external_contact_id,
       ch.channel_type, ch.status AS channel_status, ch.token_expires_at,
       i.status AS integration_status, i.ai_mode
     FROM meta_conversations cv JOIN meta_contacts c ON c.id = cv.contact_id
     JOIN meta_channels ch ON ch.id = cv.channel_id JOIN meta_integrations i ON i.id = cv.integration_id
     WHERE cv.id = ?`, [conversationId]);
  if (!row) throw httpError(404, "Conversazione non trovata", "META_CONVERSATION_NOT_FOUND");
  return row;
}

async function queueMessage(conversationId, input, actor) {
  const key = policy.requestKey(conversationId, input.idempotencyKey);
  const existingResult = async (conn) => {
    const [[found]] = await conn.query(
      `SELECT m.id AS messageId, j.id AS jobId, j.state FROM meta_messages m
       JOIN meta_outbound_jobs j ON j.message_id = m.id WHERE m.idempotency_key = ?`, [key]);
    return found ? { ...found, duplicate: true, awaitingApproval: found.state === "WAITING_APPROVAL" } : null;
  };
  const previous = await existingResult(db);
  if (previous) return previous;
  const conversation = await messageContext(conversationId);
  const senderKind = String(input.senderKind || "HUMAN").toUpperCase();
  if (!["HUMAN","AI"].includes(senderKind)) throw httpError(400, "Mittente non valido", "META_SENDER_INVALID");
  let request = { type: "text" };
  let text = String(input.text || "").trim();
  if (input.template) {
    request = await assets.prepareTemplate(conversation.channel_id, input.template);
    text = request.preview;
  } else if (input.attachmentId) {
    request = await assets.prepareMedia(conversation.channel_id, input.attachmentId, actor);
    text = request.filename;
  } else if (!text || text.length > 4096 || (conversation.channel_type === "INSTAGRAM" && Buffer.byteLength(text,"utf8") > 1000)) {
    throw httpError(400, "Messaggio vuoto o troppo lungo (Instagram: massimo 1000 byte).", "META_MESSAGE_INVALID");
  }
  const requiresApproval = senderKind === "AI" && conversation.ai_mode !== "AUTO";
  // Approval state is checked again at dispatch; drafts may be created for review.
  policy.assertCanSend({ ...conversation, requester_kind: senderKind, approval_status: "APPROVED" }, request);
  const messageId = crypto.randomUUID(), jobId = crypto.randomUUID();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const current = await messageContext(conversationId, conn);
    policy.assertCanSend({ ...current, requester_kind: senderKind, approval_status: "APPROVED" }, request);
    await conn.query(
      `INSERT INTO meta_messages
       (id,conversation_id,channel_id,direction,sender_kind,sender_user_id,message_type,body_text,request_json,idempotency_key,status,occurred_at)
       VALUES (?,?,?,'OUTBOUND',?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3))`,
      [messageId,conversationId,conversation.channel_id,senderKind,actor.sub,request.type.toUpperCase(),text,JSON.stringify(request),key,requiresApproval ? "DRAFT" : "QUEUED"]);
    if (request.type === "media") {
      const [attached] = await conn.query("UPDATE meta_attachments SET message_id = ? WHERE id = ? AND message_id IS NULL AND created_by = ?",
        [messageId,request.attachmentId,actor.sub]);
      if (!attached.affectedRows) throw httpError(409,"Allegato già utilizzato.","META_MEDIA_IN_USE");
    }
    await conn.query(
      `INSERT INTO meta_outbound_jobs (id,message_id,integration_id,requested_by,requester_kind,approval_status,state)
       VALUES (?,?,?,?,?,?,?)`,
      [jobId,messageId,conversation.integration_id,actor.sub,senderKind,requiresApproval ? "PENDING" : "APPROVED",requiresApproval ? "WAITING_APPROVAL" : "READY"]);
    await conn.query("UPDATE meta_conversations SET last_message_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [conversationId]);
    await audit(conn,{integrationId:conversation.integration_id,actorId:actor.sub,actorKind:senderKind,action:"MESSAGE_QUEUED",entityType:"MESSAGE",entityId:messageId});
    await conn.commit();
    return { messageId, jobId, awaitingApproval: requiresApproval };
  } catch(error) {
    await conn.rollback();
    if (error.code === "ER_DUP_ENTRY") { const found = await existingResult(db); if (found) return found; }
    throw error;
  } finally { conn.release(); }
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

async function processNextOutbound({ jobId = null, force = false } = {}) {
  const claim = await db.getConnection();
  let job;
  try {
    await claim.beginTransaction();
    await claim.query(
      `UPDATE meta_outbound_jobs SET state = 'UNCERTAIN', locked_at = NULL,
       last_error = 'Invio interrotto: verificare con il destinatario prima di riprovare.'
       WHERE state = 'PROCESSING' AND (locked_at IS NULL OR locked_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE))`);
    if (force) await claim.query("UPDATE meta_outbound_jobs SET next_attempt_at = NULL WHERE state = 'RETRY'" + (jobId ? " AND id = ?" : ""), jobId ? [jobId] : []);
    const [[selected]] = await claim.query(
      `SELECT j.*, m.channel_id, m.body_text, m.request_json, m.conversation_id,
       c.external_contact_id, ch.channel_type, ch.external_account_id, ch.credential_mode, ch.api_sender_id,
       ch.encrypted_access_token, ch.token_iv, ch.token_auth_tag, i.graph_api_version
       FROM meta_outbound_jobs j JOIN meta_messages m ON m.id = j.message_id
       JOIN meta_conversations cv ON cv.id = m.conversation_id JOIN meta_contacts c ON c.id = cv.contact_id
       JOIN meta_channels ch ON ch.id = m.channel_id JOIN meta_integrations i ON i.id = j.integration_id
       WHERE j.state IN ('READY','RETRY') AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= CURRENT_TIMESTAMP(3))
       AND ch.status = 'ACTIVE' AND i.status = 'CONNECTED' ${jobId ? "AND j.id = ?" : ""}
       ORDER BY j.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, jobId ? [jobId] : []);
    job = selected;
    if (!job) { await claim.commit(); return { processed: false, reason: "NO_ELIGIBLE_JOB", detail: "Nessun invio pronto. Controlla canali, errori e prossimi tentativi nel centro attività." }; }
    await claim.query("UPDATE meta_outbound_jobs SET state = 'PROCESSING', attempt_count = attempt_count + 1, locked_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [job.id]);
    await claim.commit();
  } catch(error) { await claim.rollback(); throw error; } finally { claim.release(); }
  let phase = "prepare", sendConn, externalId;
  try {
    const request = parseJson(job.request_json) || { type: "text" };
    policy.assertCanSend({ ...(await messageContext(job.conversation_id)), ...job }, request);
    const token = decryptSecret({ encrypted: job.encrypted_access_token, iv: job.token_iv, authTag: job.token_auth_tag });
    const version = job.graph_api_version || process.env.META_GRAPH_API_VERSION;
    if (!token || !/^v\d+\.\d+$/.test(version || "")) throw policy.problem("Token o versione API mancanti.", "META_CONFIGURATION");
    const delivery = await assets.buildSendBody(job, request, token, version);
    // Serialize the final dispatch with archive/consent/delete/credential edits.
    sendConn = await db.getConnection();
    await sendConn.beginTransaction();
    const [[currentJob]] = await sendConn.query(
      `SELECT j.state, m.deleted_at, ch.encrypted_access_token FROM meta_outbound_jobs j
       JOIN meta_messages m ON m.id = j.message_id JOIN meta_conversations cv ON cv.id = m.conversation_id
       JOIN meta_contacts c ON c.id = cv.contact_id JOIN meta_channels ch ON ch.id = m.channel_id
       JOIN meta_integrations i ON i.id = j.integration_id WHERE j.id = ? FOR UPDATE`, [job.id]);
    if (currentJob?.state !== "PROCESSING" || currentJob.encrypted_access_token !== job.encrypted_access_token) {
      throw policy.problem("Invio sospeso: messaggio o credenziali modificati.", "META_SEND_CHANGED");
    }
    policy.assertCanSend({ ...(await messageContext(job.conversation_id, sendConn)), ...job, deleted_at: currentJob.deleted_at }, request);
    phase = "send";
    const response = await axios.post(delivery.url, delivery.body, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type":"application/json" },
      timeout: 15000, maxRedirects: 0 });
    externalId = response.data?.messages?.[0]?.id || response.data?.message_id || null;
    if (!externalId) throw new Error("Meta returned no message id");
    await sendConn.query(
      `UPDATE meta_messages SET status = IF(status IN ('DELIVERED','READ'),status,'SENT'),
       external_message_id = ?, payload_json = ?, error_message = NULL WHERE id = ?`,
      [externalId, JSON.stringify(response.data || {}), job.message_id]);
    await sendConn.query("UPDATE meta_outbound_jobs SET state = 'SENT', locked_at = NULL, last_error = NULL WHERE id = ?", [job.id]);
    await sendConn.commit();
    return { processed:true,jobId:job.id,sent:true };
  } catch(error) {
    if (sendConn) await sendConn.rollback();
    const failure = policy.deliveryFailure(error, phase);
    let state = failure.state;
    if (state === "RETRY" && Number(job.attempt_count) + 1 >= 5) state = "FAILED";
    const message = state === "UNCERTAIN" ? "Esito non confermato. Verifica con il destinatario prima di riprovare." : policy.safeError(error);
    const [updated] = await db.query(
      `UPDATE meta_outbound_jobs SET state = ?, last_error = ?, locked_at = NULL,
       next_attempt_at = IF(? = 'RETRY',DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL ? MINUTE),NULL)
       WHERE id = ? AND state = 'PROCESSING'`,
      [state,message,state,Math.min(60,2 ** Number(job.attempt_count || 0)),job.id]);
    if (updated.affectedRows) await db.query(
      `UPDATE meta_messages SET status = ?, error_message = ?, external_message_id = COALESCE(?,external_message_id)
       WHERE id = ? AND status NOT IN ('DELIVERED','READ')`,
      [state === "RETRY" ? "QUEUED" : "FAILED",message,externalId || null,job.message_id]);
    if (failure.credentialError) await db.query(
      "UPDATE meta_channels SET status = 'ERROR', last_error = ? WHERE id = ? AND encrypted_access_token = ?",
      [message,job.channel_id,job.encrypted_access_token]);
    return { processed:true,jobId:job.id,sent:false,retry:state === "RETRY",state,error:message };
  } finally { if(sendConn) sendConn.release(); }
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
    await conn.query("UPDATE meta_leads SET hydration_status='RETRY',hydration_locked_at=NULL,hydration_next_attempt_at=NULL WHERE hydration_status='PROCESSING' AND (hydration_locked_at IS NULL OR hydration_locked_at<DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL 5 MINUTE))");
    const [rows] = await conn.query(
      `SELECT l.*, i.graph_api_version,
              ch.encrypted_access_token, ch.token_iv, ch.token_auth_tag
       FROM meta_leads l
       JOIN meta_integrations i ON i.id = l.integration_id
       LEFT JOIN meta_channels ch ON ch.id = l.channel_id
       WHERE l.hydration_status IN ('PENDING', 'RETRY')
         AND (l.hydration_next_attempt_at IS NULL OR l.hydration_next_attempt_at <= CURRENT_TIMESTAMP(3))
         AND i.status = 'CONNECTED' AND ch.status = 'ACTIVE' AND ch.leads_enabled = 1
       ORDER BY l.received_at LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    lead = rows[0];
    if (!lead) {
      await conn.commit();
      return { processed: false };
    }
    await conn.query(
      `UPDATE meta_leads SET hydration_status = 'PROCESSING',
       hydration_locked_at = CURRENT_TIMESTAMP(3), hydration_attempt_count = hydration_attempt_count + 1 WHERE id = ?`,
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
    if (!token || !/^v\d+\.\d+$/.test(version || "")) throw policy.problem("Credenziali o versione Graph API mancanti", "META_CONFIGURATION");
    const response = await axios.get(
      `https://graph.facebook.com/${version}/${encodeURIComponent(lead.external_lead_id)}`,
      {
        params: { fields: "id,created_time,ad_id,form_id,field_data,platform,custom_disclaimer_responses" },
        headers: { Authorization: `Bearer ${token}` },
        timeout: Number(process.env.META_GRAPH_TIMEOUT_MS || 15000),
        maxRedirects: 0,
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
      const [[stillPresent]] = await updateConn.query("SELECT id FROM meta_leads WHERE id = ? AND hydration_status = 'PROCESSING' FOR UPDATE",[lead.id]);
      if (!stillPresent) throw httpError(409,"Lead eliminato o modificato durante il recupero.","META_LEAD_CHANGED");
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
         hydration_status = 'COMPLETE', hydration_locked_at = NULL, hydration_last_error = NULL,
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
    const message = metaApiErrorMessage(error);
    const failure = policy.deliveryFailure(error, "prepare");
    const retry = failure.state === "RETRY" && Number(lead.hydration_attempt_count || 0) + 1 < 5;
    const delayMinutes = Math.min(60, 2 ** Math.max(0, Number(lead.hydration_attempt_count || 0)));
    await db.query(
      `UPDATE meta_leads SET hydration_status = ?, hydration_locked_at = NULL, hydration_last_error = ?,
       hydration_next_attempt_at = IF(?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE), NULL)
       WHERE id = ? AND hydration_status = 'PROCESSING'`,
      [retry ? "RETRY" : "FAILED", message, retry, delayMinutes, lead.id]
    );
    return { processed: true, leadId: lead.id, hydrated: false, retry, error: message };
  }
}

module.exports = {
  assets,
  operations,
  approveJob,
  deleteMessage,
  getOverview,
  getUnreadSummary,
  ingestWebhook,
  listConversations,
  listLeads,
  listMessages,
  readConversation,
  processNextOutbound,
  processNextLead,
  queueMessage,
  replayUnmatchedEvents,
  saveChannel,
  saveIntegration,
  setChannelStatus,
  setAiMode,
  updateConversation,
  updateLead,
  verifyChannel,
  verifyWhatsAppIntegration,
};
