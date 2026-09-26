const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

async function runReadingStateMigration() {
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
    const [[lock]] = await connection.query(
      "SELECT GET_LOCK(CONCAT(DATABASE(), ':reading_state_migration'), 10) AS acquired"
    );
    if (Number(lock.acquired) !== 1) {
      throw new Error("Un'altra migrazione degli stati lettura è già in corso.");
    }
    const migrationPath = path.resolve(
      __dirname,
      "../../database/migrations/008_reading_states.sql"
    );
    await connection.query(fs.readFileSync(migrationPath, "utf8"));
    console.log("Reading states ready: B = Contatore bloccato, T = Telegram");
    return { ok: true };
  } finally {
    await connection
      .query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':reading_state_migration'))")
      .catch(() => {});
    await connection.end();
  }
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function runReadingStateMigrationWithRetry({
  maxAttempts = Number(process.env.READING_STATE_MIGRATION_MAX_ATTEMPTS || 5),
  initialDelayMs = Number(process.env.READING_STATE_MIGRATION_RETRY_DELAY_MS || 2000),
  maxDelayMs = 30000,
} = {}) {
  const attempts = Math.max(1, maxAttempts);
  let delayMs = Math.max(0, initialDelayMs);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runReadingStateMigration();
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.warn(
        `Reading state migration attempt ${attempt}/${attempts} failed: ${
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
  runReadingStateMigration().catch((error) => {
    console.error(error.code || "READING_STATE_MIGRATION_ERROR", error.message);
    process.exitCode = 1;
  });
}

module.exports = { runReadingStateMigration, runReadingStateMigrationWithRetry };
