const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

async function runMobileMigration() {
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
      "../../database/migrations/001_mobile_readings.sql"
    );
    await connection.query(fs.readFileSync(migrationPath, "utf8"));
    const [rows] = await connection.execute(
      `SELECT COUNT(*) AS count
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME LIKE 'mobile_reading_%'`
    );
    const tableCount = Number(rows[0].count || 0);
    console.log(`Mobile reading tables ready: ${tableCount}`);
    return { tableCount };
  } finally {
    await connection.end();
  }
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function runMobileMigrationWithRetry({
  maxAttempts = Number(process.env.MOBILE_MIGRATION_MAX_ATTEMPTS || 5),
  initialDelayMs = Number(process.env.MOBILE_MIGRATION_RETRY_DELAY_MS || 2000),
  maxDelayMs = 30000,
} = {}) {
  const attempts = Math.max(1, maxAttempts);
  let delayMs = Math.max(0, initialDelayMs);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runMobileMigration();
    } catch (error) {
      if (attempt >= attempts) throw error;

      console.warn(
        `Mobile migration attempt ${attempt}/${attempts} failed: ${
          error?.code || error?.message || "unknown error"
        }. Retrying in ${delayMs}ms.`
      );
      await wait(delayMs);
      delayMs = Math.min(maxDelayMs, Math.max(1000, delayMs * 2));
    }
  }

  return null;
}

if (require.main === module) {
  runMobileMigration().catch((error) => {
    console.error(error.code || "MIGRATION_ERROR", error.message);
    process.exitCode = 1;
  });
}

module.exports = { runMobileMigration, runMobileMigrationWithRetry };
