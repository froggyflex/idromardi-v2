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

function publicUser(user, impersonation = null) {
  return {
    id: user.id, username: user.username, role: user.role,
    mustChangePassword: Boolean(user.must_change_password),
    ...(impersonation ? { impersonation } : {}),
  };
}

function createToken(user, impersonation = null) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role || (user.username === DEFAULT_USERNAME ? "ADMIN" : "METER_READER"),
    version: Number(user.token_version || 0),
    ...(impersonation ? { impersonation } : {}),
    iat: now,
    exp: now + (impersonation ? 60 * 60 : TOKEN_TTL_SECONDS),
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
    if (!payload?.sub || !payload?.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

let authTableReady;
function ensureAuthTable() {
  if (!authTableReady) authTableReady = initializeAuthTable().catch(error => { authTableReady = null; throw error; });
  return authTableReady;
}

async function initializeAuthTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_auth_users (
      id CHAR(36) NOT NULL PRIMARY KEY,
      username VARCHAR(80) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('ADMIN', 'REVIEWER', 'METER_READER', 'AMMINISTRATORE') NOT NULL DEFAULT 'METER_READER',
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      token_version INT UNSIGNED NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const [roleColumns] = await db.query(`SHOW COLUMNS FROM app_auth_users LIKE 'role'`);
  if (!roleColumns.length) {
    await db.query(`
      ALTER TABLE app_auth_users
      ADD COLUMN role ENUM('ADMIN', 'REVIEWER', 'METER_READER', 'AMMINISTRATORE')
      NOT NULL DEFAULT 'METER_READER' AFTER password_hash
    `);
  }
  if (roleColumns.length && !roleColumns[0].Type.includes("AMMINISTRATORE")) {
    await db.query("ALTER TABLE app_auth_users MODIFY COLUMN role ENUM('ADMIN', 'REVIEWER', 'METER_READER', 'AMMINISTRATORE') NOT NULL DEFAULT 'METER_READER'");
  }
  const [columns] = await db.query("SHOW COLUMNS FROM app_auth_users");
  for (const [name, definition] of [["must_change_password", "BOOLEAN NOT NULL DEFAULT FALSE"], ["token_version", "INT UNSIGNED NOT NULL DEFAULT 0"]]) {
    if (!columns.some(column => column.Field === name)) await db.query(`ALTER TABLE app_auth_users ADD COLUMN ${name} ${definition}`);
  }
  const fs = require("fs");
  const path = require("path");
  const schema = fs.readFileSync(path.join(__dirname, "amministratori-tables.sql"), "utf8");
  for (const statement of schema.split(";").map(value => value.trim()).filter(Boolean)) await db.query(statement);

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
    user: publicUser(user),
  };
}

async function listUsers() {
  await ensureAuthTable();
  const [rows] = await db.query(`
    SELECT id, username, role, must_change_password, created_at, updated_at
    FROM app_auth_users
    ORDER BY username
  `);
  const [assignments] = await db.query("SELECT user_id, condominio_id FROM app_amministratore_condomini");
  return { users: rows.map(user => ({ ...user, mustChangePassword: Boolean(user.must_change_password), condominioIds: assignments.filter(row => row.user_id === user.id).map(row => row.condominio_id) })) };
}

async function createUser({ username, password, role = "METER_READER", condominioIds = [] }) {
  await ensureAuthTable();
  const normalizedUsername = String(username || "").trim();
  const normalizedRole = String(role || "").trim().toUpperCase();
  const allowedRoles = new Set(["ADMIN", "REVIEWER", "METER_READER", "AMMINISTRATORE"]);

  if (normalizedUsername.length < 3 || normalizedUsername.length > 80) {
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
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO app_auth_users (id, username, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?)`,
      [id, normalizedUsername, hashPassword(password), normalizedRole, normalizedRole === "AMMINISTRATORE"]
    );
    if (normalizedRole === "AMMINISTRATORE") await replaceAssignments(connection, id, condominioIds);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error?.code === "ER_DUP_ENTRY") {
      const err = new Error("Username già esistente");
      err.statusCode = 409;
      throw err;
    }
    throw error;
  } finally {
    connection.release();
  }

  return { user: { id, username: normalizedUsername, role: normalizedRole, mustChangePassword: normalizedRole === "AMMINISTRATORE", condominioIds } };
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
  if (verifyPassword(newPassword, user.password_hash)) throw accessError("Scegli una password diversa da quella temporanea o attuale", 400);

  const [changed] = await db.query(`UPDATE app_auth_users SET password_hash = ?, must_change_password = FALSE, token_version = token_version + 1 WHERE id = ? AND token_version = ?`, [
    hashPassword(newPassword),
    user.id,
    user.token_version,
  ]);
  if (!changed.affectedRows) throw accessError("La password è stata modificata. Accedi nuovamente", 409);

  user.must_change_password = false;
  user.token_version = Number(user.token_version) + 1;
  return { ok: true, token: createToken(user), user: publicUser(user) };
}

function accessError(message, statusCode = 403) {
  return Object.assign(new Error(message), { statusCode });
}

async function authenticateToken(token) {
  const payload = verifyToken(token);
  if (!payload) return null;
  await ensureAuthTable();
  const [[user]] = await db.query("SELECT * FROM app_auth_users WHERE id = ?", [payload.sub]);
  if (!user || user.role !== payload.role || Number(user.token_version) !== Number(payload.version || 0)) return null;
  if (payload.impersonation) {
    const actor = await getImpersonatingAdmin(payload);
    if (!actor || user.role !== "AMMINISTRATORE") return null;
  }
  return { ...payload, username: user.username, mustChangePassword: Boolean(user.must_change_password) };
}

async function getImpersonatingAdmin(payload) {
  const [[actor]] = await db.query("SELECT * FROM app_auth_users WHERE id = ?", [payload.impersonation.actorId]);
  const [[audit]] = await db.query("SELECT id FROM app_auth_impersonations WHERE id = ? AND actor_id = ? AND target_id = ? AND ended_at IS NULL AND expires_at > CURRENT_TIMESTAMP", [payload.impersonation.id, payload.impersonation.actorId, payload.sub]);
  return actor?.role === "ADMIN" && !actor.must_change_password && Number(actor.token_version) === payload.impersonation.actorVersion && audit ? actor : null;
}

async function startImpersonation(actor, targetId) {
  const [[target]] = await db.query("SELECT * FROM app_auth_users WHERE id = ?", [targetId]);
  if (!target || target.role !== "AMMINISTRATORE") throw accessError("Amministratore non trovato", 404);
  const impersonation = { id: crypto.randomUUID(), actorId: actor.sub, actorUsername: actor.username, actorVersion: Number(actor.version || 0) };
  await db.query("INSERT INTO app_auth_impersonations (id, actor_id, target_id, expires_at) VALUES (?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 HOUR))", [impersonation.id, actor.sub, targetId]);
  return { token: createToken(target, impersonation), user: publicUser(target, impersonation) };
}

async function endImpersonation(payload) {
  if (!payload.impersonation) throw accessError("Nessuna sessione di assistenza attiva", 400);
  const actor = await getImpersonatingAdmin(payload);
  if (!actor) throw accessError("Sessione di assistenza scaduta", 401);
  await db.query("UPDATE app_auth_impersonations SET ended_at = CURRENT_TIMESTAMP WHERE id = ?", [payload.impersonation.id]);
  return { token: createToken(actor), user: publicUser(actor) };
}

async function replaceAssignments(connection, userId, condominioIds) {
  if (!Array.isArray(condominioIds) || condominioIds.some(id => typeof id !== "string" || id.length > 36)) throw accessError("Elenco condomini non valido", 400);
  const ids = [...new Set(condominioIds)];
  for (const id of ids) {
    const [[condominio]] = await connection.query("SELECT id FROM condomini_v2 WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!condominio) throw accessError("Condominio non trovato", 400);
  }
  await connection.query("DELETE FROM app_amministratore_condomini WHERE user_id = ?", [userId]);
  for (const id of ids) await connection.query("INSERT INTO app_amministratore_condomini (user_id, condominio_id) VALUES (?, ?)", [userId, id]);
}

async function updateAssignments(userId, condominioIds) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[user]] = await connection.query("SELECT role FROM app_auth_users WHERE id = ? FOR UPDATE", [userId]);
    if (user?.role !== "AMMINISTRATORE") throw accessError("Amministratore non trovato", 404);
    await replaceAssignments(connection, userId, condominioIds);
    await connection.commit();
    return { ok: true };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

async function listAssignableCondomini() {
  const [condomini] = await db.query("SELECT id, codice, nome, indirizzo FROM condomini_v2 WHERE deleted_at IS NULL ORDER BY nome");
  return { condomini };
}

module.exports = {
  login,
  changePassword,
  verifyToken,
  ensureAuthTable,
  listUsers,
  createUser,
  authenticateToken,
  startImpersonation,
  endImpersonation,
  updateAssignments,
  listAssignableCondomini,
};
