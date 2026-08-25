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
