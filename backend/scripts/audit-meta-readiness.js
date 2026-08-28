const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

function configured(name) {
  return Boolean(String(process.env[name] || "").trim());
}

async function tableExists(connection, tableName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(row?.total || 0) === 1;
}

async function auditMetaReadiness() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
  });
  try {
    const requiredTables = [
      "meta_integrations",
      "meta_channels",
      "meta_contacts",
      "meta_conversations",
      "meta_messages",
      "meta_webhook_events",
      "meta_outbound_jobs",
      "meta_audit_log",
      "meta_leads",
      "meta_attachments",
    ];
    const existingTables = [];
    for (const table of requiredTables) {
      if (await tableExists(connection, table)) existingTables.push(table);
    }

    let migrations = [];
    if (await tableExists(connection, "meta_schema_migrations")) {
      const [rows] = await connection.query(
        `SELECT migration_name, applied_at FROM meta_schema_migrations ORDER BY migration_name`
      );
      migrations = rows;
    }

    let integrations = [];
    let channels = [];
    let operations = null;
    const missingColumns = [];
    const requiredColumns = {
      meta_channels: ["leads_enabled","last_token_refresh_at","refresh_error","credential_mode","api_sender_id","last_verified_at","encrypted_access_token"],
      meta_messages: ["request_json","idempotency_key","status_payload_json","deleted_at"],
      meta_webhook_events: ["next_attempt_at"],
      meta_leads: ["hydration_locked_at","notes","follow_up_at"],
      meta_contacts: ["consent_note"],
    };
    for (const [table, required] of Object.entries(requiredColumns)) {
      if (!existingTables.includes(table)) continue;
      const [columns] = await connection.query(`SHOW COLUMNS FROM ${table}`);
      for (const name of required) if (!columns.some(column=>column.Field===name)) missingColumns.push(`${table}.${name}`);
    }
    let uncertainState = false, requestIndex = false;
    if (existingTables.includes("meta_outbound_jobs")) {
      const [columns] = await connection.query("SHOW COLUMNS FROM meta_outbound_jobs LIKE 'state'");
      uncertainState = columns.some(column=>String(column.Type).includes("UNCERTAIN"));
    }
    if (existingTables.includes("meta_messages")) {
      const [indexes] = await connection.query("SHOW INDEX FROM meta_messages WHERE Key_name = 'uq_meta_message_request'");
      requestIndex = indexes.some(index=>Number(index.Non_unique)===0);
    }
    const schemaReady = existingTables.length === requiredTables.length && !missingColumns.length && uncertainState && requestIndex;
    if (schemaReady) {
      [integrations] = await connection.query(
        `SELECT name, status, graph_api_version, ai_mode,
                encrypted_access_token IS NOT NULL AS has_fallback_token,
                token_expires_at, last_error IS NOT NULL AS has_error
         FROM meta_integrations ORDER BY created_at DESC`
      );
      [channels] = await connection.query(
        `SELECT channel_type, display_name, status, credential_mode,
                encrypted_access_token IS NOT NULL AS has_token,
                token_expires_at, last_verified_at, last_error IS NOT NULL AS has_error,
                leads_enabled, refresh_error IS NOT NULL AS has_refresh_error
         FROM meta_channels ORDER BY channel_type, created_at`
      );
      const [[summary]] = await connection.query(
        `SELECT
          (SELECT COUNT(*) FROM meta_webhook_events WHERE processing_status = 'FAILED') AS failed_webhooks,
          (SELECT COUNT(*) FROM meta_webhook_events WHERE processing_status = 'UNMATCHED') AS unmatched_webhooks,
          (SELECT MAX(received_at) FROM meta_webhook_events) AS last_webhook_at,
          (SELECT COUNT(*) FROM meta_outbound_jobs WHERE state IN ('READY', 'PROCESSING', 'RETRY')) AS queued_outbound,
          (SELECT COUNT(*) FROM meta_outbound_jobs WHERE state = 'FAILED') AS failed_outbound,
          (SELECT COUNT(*) FROM meta_outbound_jobs WHERE state = 'UNCERTAIN') AS uncertain_outbound,
          (SELECT COUNT(*) FROM meta_leads WHERE hydration_status IN ('FAILED','RETRY','PROCESSING')) AS leads_needing_recovery,
          (SELECT COALESCE(SUM(unread_count), 0) FROM meta_conversations
           WHERE status IN ('OPEN', 'PENDING')) AS unread_messages`
      );
      operations = summary;
    }

    return {
      environment: {
        appSecret: configured("META_APP_SECRET"),
        webhookVerifyToken: configured("META_WEBHOOK_VERIFY_TOKEN"),
        encryptionKey: configured("META_CREDENTIALS_ENCRYPTION_KEY"),
        graphApiVersion: String(process.env.META_GRAPH_API_VERSION || "") || null,
        instagramAppId: configured("META_INSTAGRAM_APP_ID"),
        instagramAppSecret: configured("META_INSTAGRAM_APP_SECRET"),
        publicMediaUrl: configured("META_PUBLIC_BASE_URL") || configured("RENDER_EXTERNAL_URL"),
        outboxWorkerEnabled:
          String(process.env.META_OUTBOX_WORKER_ENABLED || "false").toLowerCase() === "true",
      },
      schema: {
        ready: schemaReady,
        missingColumns,
        uncertainState,
        requestIndex,
        missingTables: requiredTables.filter((table) => !existingTables.includes(table)),
        migrations,
      },
      integrations,
      channels,
      operations,
    };
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  auditMetaReadiness()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(JSON.stringify({
        ready: false,
        code: error.code || "META_AUDIT_FAILED",
        message: error.message,
      }, null, 2));
      process.exitCode = 1;
    });
}

module.exports = { auditMetaReadiness };
