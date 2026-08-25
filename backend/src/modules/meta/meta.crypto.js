const crypto = require("crypto");

function credentialKey() {
  const configured = String(process.env.META_CREDENTIALS_ENCRYPTION_KEY || "").trim();
  if (!configured) {
    const error = new Error("META_CREDENTIALS_ENCRYPTION_KEY non configurata");
    error.statusCode = 503;
    error.code = "META_ENCRYPTION_KEY_MISSING";
    throw error;
  }

  let key;
  try {
    key = Buffer.from(configured, "base64");
  } catch {
    key = null;
  }
  if (!key || key.length !== 32) {
    const error = new Error(
      "META_CREDENTIALS_ENCRYPTION_KEY deve essere una chiave base64 da 32 byte"
    );
    error.statusCode = 503;
    error.code = "META_ENCRYPTION_KEY_INVALID";
    throw error;
  }
  return key;
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptSecret({ encrypted, iv, authTag }) {
  if (!encrypted || !iv || !authTag) return null;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    credentialKey(),
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

module.exports = { decryptSecret, encryptSecret };
