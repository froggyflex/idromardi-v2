const crypto = require("crypto");
const db = require("../../config/db");

const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD || "prova";
const CONFIGURED_AUTH_SECRET =
  process.env.AUTH_TOKEN_SECRET || process.env.AUTH_SECRET || process.env.JWT_SECRET;
const AUTH_SECRET = CONFIGURED_AUTH_SECRET || "idromardi-local-auth-secret";

if (
  process.env.NODE_ENV === "production" &&
  (!CONFIGURED_AUTH_SECRET || CONFIGURED_AUTH_SECRET.length < 32)
) {
  throw new Error("AUTH_TOKEN_SECRET must contain at least 32 characters in production");
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payloadBase64) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(payloadBase64).digest("base64url");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHash] = String(storedHash || "").split(":");
  if (!salt || !expectedHash) return false;

  const actualHash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
}

function createToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role || (user.username === DEFAULT_USERNAME ? "ADMIN" : "METER_READER"),
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const payloadBase64 = base64url(JSON.stringify(payload));
  return `${payloadBase64}.${signPayload(payloadBase64)}`;
}

function verifyToken(token) {
  const [payloadBase64, signature] = String(token || "").split(".");
  if (!payloadBase64 || !signature) return null;

  const expectedSignature = signPayload(payloadBase64);
  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
    if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function ensureAuthTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_auth_users (
      id CHAR(36) NOT NULL PRIMARY KEY,
      username VARCHAR(80) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('ADMIN', 'REVIEWER', 'METER_READER') NOT NULL DEFAULT 'METER_READER',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const [roleColumns] = await db.query(`SHOW COLUMNS FROM app_auth_users LIKE 'role'`);
  if (!roleColumns.length) {
    await db.query(`
      ALTER TABLE app_auth_users
      ADD COLUMN role ENUM('ADMIN', 'REVIEWER', 'METER_READER')
      NOT NULL DEFAULT 'METER_READER' AFTER password_hash
    `);
  }

  const [rows] = await db.query(`SELECT id FROM app_auth_users WHERE username = ? LIMIT 1`, [
    DEFAULT_USERNAME,
  ]);

  if (!rows.length) {
    if (process.env.NODE_ENV === "production" && !process.env.INITIAL_ADMIN_PASSWORD) {
      throw new Error(
        "INITIAL_ADMIN_PASSWORD is required when creating the first production administrator"
      );
    }
    await db.query(
      `INSERT INTO app_auth_users (id, username, password_hash, role) VALUES (?, ?, ?, 'ADMIN')`,
      [crypto.randomUUID(), DEFAULT_USERNAME, hashPassword(DEFAULT_PASSWORD)]
    );
  } else {
    await db.query(`UPDATE app_auth_users SET role = 'ADMIN' WHERE username = ?`, [
      DEFAULT_USERNAME,
    ]);
  }
}

async function login({ username, password }) {
  await ensureAuthTable();

  const [rows] = await db.query(`SELECT * FROM app_auth_users WHERE username = ? LIMIT 1`, [
    String(username || "").trim(),
  ]);
  const user = rows[0];

  if (!user || !verifyPassword(password, user.password_hash)) {
    const err = new Error("Credenziali non valide");
    err.statusCode = 401;
    throw err;
  }

  return {
    token: createToken(user),
    user: {
      id: user.id,
      username: user.username,
      role: user.role || (user.username === DEFAULT_USERNAME ? "ADMIN" : "METER_READER"),
    },
  };
}

async function listUsers() {
  await ensureAuthTable();
  const [rows] = await db.query(`
    SELECT id, username, role, created_at, updated_at
    FROM app_auth_users
    ORDER BY username
  `);
  return { users: rows };
}

async function createUser({ username, password, role = "METER_READER" }) {
  await ensureAuthTable();
  const normalizedUsername = String(username || "").trim();
  const normalizedRole = String(role || "").trim().toUpperCase();
  const allowedRoles = new Set(["ADMIN", "REVIEWER", "METER_READER"]);

  if (normalizedUsername.length < 3) {
    const err = new Error("Lo username deve contenere almeno 3 caratteri");
    err.statusCode = 400;
    throw err;
  }
  if (String(password || "").length < 8) {
    const err = new Error("La password deve contenere almeno 8 caratteri");
    err.statusCode = 400;
    throw err;
  }
  if (!allowedRoles.has(normalizedRole)) {
    const err = new Error("Ruolo non valido");
    err.statusCode = 400;
    throw err;
  }

  const id = crypto.randomUUID();
  try {
    await db.query(
      `INSERT INTO app_auth_users (id, username, password_hash, role) VALUES (?, ?, ?, ?)`,
      [id, normalizedUsername, hashPassword(password), normalizedRole]
    );
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      const err = new Error("Username già esistente");
      err.statusCode = 409;
      throw err;
    }
    throw error;
  }

  return { user: { id, username: normalizedUsername, role: normalizedRole } };
}

async function changePassword({ username, currentPassword, newPassword }) {
  await ensureAuthTable();

  if (!newPassword || String(newPassword).length < 8) {
    const err = new Error("La nuova password deve contenere almeno 8 caratteri");
    err.statusCode = 400;
    throw err;
  }

  const [rows] = await db.query(`SELECT * FROM app_auth_users WHERE username = ? LIMIT 1`, [
    username || DEFAULT_USERNAME,
  ]);
  const user = rows[0];

  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    const err = new Error("Password attuale non valida");
    err.statusCode = 401;
    throw err;
  }

  await db.query(`UPDATE app_auth_users SET password_hash = ? WHERE id = ?`, [
    hashPassword(newPassword),
    user.id,
  ]);

  return { ok: true };
}

module.exports = {
  login,
  changePassword,
  verifyToken,
  ensureAuthTable,
  listUsers,
  createUser,
};
