const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

async function runMetaMigration() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    multipleStatements: true,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  });
  try {
    const migrationPath = path.resolve(
      __dirname,
      "../../database/migrations/003_meta_crm_foundation.sql"
    );
    await connection.query(fs.readFileSync(migrationPath, "utf8"));
    await connection.query(`CREATE TABLE IF NOT EXISTS meta_schema_migrations (
      migration_name VARCHAR(191) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (migration_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
    const migrations = [
      "004_meta_archive_and_message_deletion.sql",
      "005_meta_channel_credentials_and_health.sql",
      "006_meta_instagram_connection_mode.sql",
    ];
    for (const migrationName of migrations) {
      const [applied] = await connection.execute(
        `SELECT migration_name FROM meta_schema_migrations WHERE migration_name = ? LIMIT 1`,
        [migrationName]
      );
      if (applied.length) continue;
      const nextMigrationPath = path.resolve(
        __dirname,
        `../../database/migrations/${migrationName}`
      );
      await connection.beginTransaction();
      try {
        await connection.query(fs.readFileSync(nextMigrationPath, "utf8"));
        await connection.execute(
          `INSERT INTO meta_schema_migrations (migration_name) VALUES (?)`,
          [migrationName]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
    const [rows] = await connection.execute(
      `SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'meta\\_%'`
    );
    console.log(`Meta CRM tables ready: ${Number(rows[0].count || 0)}`);
    return { tableCount: Number(rows[0].count || 0) };
  } finally {
    await connection.end();
  }
}

async function runMetaMigrationWithRetry({
  maxAttempts = Number(process.env.META_MIGRATION_MAX_ATTEMPTS || 5),
  initialDelayMs = Number(process.env.META_MIGRATION_RETRY_DELAY_MS || 2000),
} = {}) {
  let delayMs = Math.max(0, initialDelayMs);
  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
    try {
      return await runMetaMigration();
    } catch (error) {
      if (attempt >= Math.max(1, maxAttempts)) throw error;
      console.warn(`Meta migration attempt ${attempt} failed. Retrying in ${delayMs}ms.`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(30000, Math.max(1000, delayMs * 2));
    }
  }
  return null;
}

if (require.main === module) {
  runMetaMigration().catch((error) => {
    console.error(error.code || "META_MIGRATION_ERROR", error.message);
    process.exitCode = 1;
  });
}

module.exports = { runMetaMigration, runMetaMigrationWithRetry };
