const crypto = require("crypto");
const {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { v4: uuid } = require("uuid");
const db = require("../config/db");

const DOCUMENT_MIME_TYPE = "application/pdf";
let generatedDocumentColumns = null;

function getR2Config() {
  const bucket = process.env.R2_BUCKET;
  const endpoint =
    process.env.R2_ENDPOINT ||
    (process.env.R2_ACCOUNT_ID
      ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : null);

  return {
    bucket,
    endpoint,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  };
}

function isR2Configured() {
  const config = getR2Config();
  return Boolean(
    config.bucket &&
      config.endpoint &&
      config.accessKeyId &&
      config.secretAccessKey
  );
}

let r2Client = null;

function getR2Client() {
  if (!isR2Configured()) {
    const err = new Error("Cloudflare R2 non configurato");
    err.statusCode = 500;
    throw err;
  }

  if (!r2Client) {
    const config = getR2Config();
    r2Client = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  return r2Client;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function safeKeyPart(value, fallback = "unknown") {
  return String(value || fallback)
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function buildDocumentKey({ condominioId, fatturaId, documentType, filename }) {
  return [
    "generated-documents",
    safeKeyPart(condominioId, "no-condominio"),
    safeKeyPart(fatturaId, "no-fattura"),
    safeKeyPart(documentType, "documento"),
    `${Date.now()}_${safeKeyPart(filename, "document.pdf")}`,
  ].join("/");
}

async function uploadPdfToR2({ key, buffer, filename }) {
  const config = getR2Config();
  const client = getR2Client();

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: DOCUMENT_MIME_TYPE,
      ContentDisposition: `inline; filename="${filename}"`,
    })
  );
}

async function getPdfFromR2(key) {
  const config = getR2Config();
  const client = getR2Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    })
  );

  return Buffer.from(await response.Body.transformToByteArray());
}

async function deletePdfFromR2(key) {
  if (!key || !isR2Configured()) return;

  const config = getR2Config();
  const client = getR2Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    })
  );
}

async function getSignedPdfUrl(key, expiresIn = 300) {
  const config = getR2Config();
  const client = getR2Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
    { expiresIn }
  );
}

async function saveGeneratedDocument({
  id,
  condominioId,
  fatturaId = null,
  utenzaId = null,
  documentType,
  filename,
  periodLabel = null,
  buffer,
  replace = false,
  metadata = {},
}) {
  if (!Buffer.isBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }

  if (buffer.slice(0, 4).toString() !== "%PDF") {
    const err = new Error("Documento PDF non valido");
    err.statusCode = 500;
    throw err;
  }

  const documentId = id || uuid();
  const checksum = sha256(buffer);
  const r2Key = buildDocumentKey({
    condominioId,
    fatturaId,
    documentType,
    filename,
  });
  const columns = await getGeneratedDocumentColumns();
  const canScopeReplaceByUtenza = !utenzaId || columns.has("id_utenza");
  const shouldReplace = replace && canScopeReplaceByUtenza;
  let existing = [];

  if (shouldReplace) {
    const [existingRows] = await db.query(
      `
      SELECT id, r2_key
      FROM generated_documents
      WHERE condominio_id <=> ?
        AND fattura_id <=> ?
        AND document_type = ?
        ${utenzaId && columns.has("id_utenza") ? "AND id_utenza = ?" : ""}
      `,
      [
        condominioId || null,
        fatturaId || null,
        documentType,
        ...(utenzaId && columns.has("id_utenza") ? [utenzaId] : []),
      ]
    );
    existing = existingRows;
  }

  await uploadPdfToR2({ key: r2Key, buffer, filename });

  const insertColumns = [
    "id",
    "condominio_id",
    "fattura_id",
    "document_type",
    "filename",
    "r2_key",
    "mime_type",
    "file_size",
    "checksum_sha256",
  ];
  const values = [
    documentId,
    condominioId || null,
    fatturaId || null,
    documentType,
    filename,
    r2Key,
    DOCUMENT_MIME_TYPE,
    buffer.length,
    checksum,
  ];

  if (columns.has("id_utenza")) {
    insertColumns.push("id_utenza");
    values.push(utenzaId || null);
  }

  if (columns.has("period_label")) {
    insertColumns.push("period_label");
    values.push(periodLabel || metadata?.periodLabel || metadata?.trimestreLabel || null);
  }

  insertColumns.push("created_at");

  await db.query(
    `
    INSERT INTO generated_documents
      (${insertColumns.join(", ")})
    VALUES (${values.map(() => "?").join(", ")}, CURRENT_TIMESTAMP)
    `,
    values
  );

  if (Object.keys(metadata || {}).length) {
    await maybeStoreMetadata(documentId, metadata);
  }

  if (shouldReplace && existing.length) {
    const ids = existing.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(",");

    await db.query(
      `DELETE FROM generated_documents WHERE id IN (${placeholders})`,
      ids
    );

    for (const row of existing) {
      await deletePdfFromR2(row.r2_key).catch((error) => {
        console.warn("Errore eliminazione vecchio documento R2:", error?.message);
      });
    }
  }

  return {
    id: documentId,
    condominio_id: condominioId || null,
    fattura_id: fatturaId || null,
    id_utenza: utenzaId || null,
    document_type: documentType,
    filename,
    r2_key: r2Key,
    mime_type: DOCUMENT_MIME_TYPE,
    file_size: buffer.length,
    checksum_sha256: checksum,
    period_label: periodLabel || metadata?.periodLabel || metadata?.trimestreLabel || null,
  };
}

async function getGeneratedDocumentColumns() {
  if (generatedDocumentColumns) return generatedDocumentColumns;

  const [columns] = await db.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'generated_documents'
    `
  );

  generatedDocumentColumns = new Set(columns.map((row) => row.COLUMN_NAME));
  return generatedDocumentColumns;
}

async function maybeStoreMetadata(documentId, metadata) {
  const columns = await getGeneratedDocumentColumns();

  if (!columns.has("metadata_json")) return;

  await db.query(
    `UPDATE generated_documents SET metadata_json = ? WHERE id = ?`,
    [JSON.stringify(metadata), documentId]
  );
}

async function getGeneratedDocumentById(id, { condominioId, utenzaId } = {}) {
  const params = [id];
  const filters = ["id = ?"];

  if (condominioId) {
    filters.push("condominio_id = ?");
    params.push(condominioId);
  }

  if (utenzaId) {
    filters.push("id_utenza = ?");
    params.push(utenzaId);
  }

  const [rows] = await db.query(
    `
    SELECT *
    FROM generated_documents
    WHERE ${filters.join(" AND ")}
    LIMIT 1
    `,
    params
  );

  return rows[0] || null;
}

function normalizeDocumentTypes(documentTypes) {
  if (!documentTypes) return [];

  const values = Array.isArray(documentTypes)
    ? documentTypes
    : String(documentTypes).split(",");

  return values.map((value) => String(value).trim()).filter(Boolean);
}

async function listGeneratedDocuments({
  condominioId,
  fatturaId = null,
  utenzaId = null,
  documentTypes = null,
  latestPerType = false,
} = {}) {
  const params = [];
  const filters = [];
  const typeFilters = normalizeDocumentTypes(documentTypes);

  if (condominioId) {
    filters.push("condominio_id = ?");
    params.push(condominioId);
  }

  if (fatturaId) {
    filters.push("fattura_id = ?");
    params.push(fatturaId);
  }

  if (utenzaId) {
    filters.push("id_utenza = ?");
    params.push(utenzaId);
  }

  if (typeFilters.length) {
    filters.push(`document_type IN (${typeFilters.map(() => "?").join(", ")})`);
    params.push(...typeFilters);
  }

  const columns = await getGeneratedDocumentColumns();
  const selectColumns = [
    "id",
    "condominio_id",
    "fattura_id",
    "document_type",
    "filename",
    "mime_type",
    "file_size",
    "checksum_sha256",
    "created_at",
  ];

  if (columns.has("id_utenza")) {
    selectColumns.splice(4, 0, "id_utenza");
  }

  if (columns.has("period_label")) {
    selectColumns.splice(7, 0, "period_label");
  }

  const [rows] = await db.query(
    `
    SELECT
      ${selectColumns.join(",\n      ")}
    FROM generated_documents
    ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY created_at DESC
    `,
    params
  );

  if (!latestPerType) {
    return rows;
  }

  const seenTypes = new Set();
  return rows.filter((row) => {
    if (seenTypes.has(row.document_type)) {
      return false;
    }

    seenTypes.add(row.document_type);
    return true;
  });
}

async function getLatestGeneratedDocument({
  condominioId,
  fatturaId = null,
  utenzaId = null,
  documentType,
} = {}) {
  const params = [];
  const filters = [];

  if (condominioId) {
    filters.push("condominio_id = ?");
    params.push(condominioId);
  }

  if (fatturaId) {
    filters.push("fattura_id = ?");
    params.push(fatturaId);
  }

  if (utenzaId) {
    filters.push("id_utenza = ?");
    params.push(utenzaId);
  }

  if (documentType) {
    filters.push("document_type = ?");
    params.push(documentType);
  }

  const [rows] = await db.query(
    `
    SELECT *
    FROM generated_documents
    ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY created_at DESC
    LIMIT 1
    `,
    params
  );

  return rows[0] || null;
}

module.exports = {
  DOCUMENT_MIME_TYPE,
  deletePdfFromR2,
  getGeneratedDocumentById,
  getLatestGeneratedDocument,
  getPdfFromR2,
  getSignedPdfUrl,
  isR2Configured,
  listGeneratedDocuments,
  saveGeneratedDocument,
};
