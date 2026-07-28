const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    multipleStatements: true,
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
    console.log(`Mobile reading tables ready: ${rows[0].count}`);
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error(error.code || "MIGRATION_ERROR", error.message);
  process.exitCode = 1;
});
