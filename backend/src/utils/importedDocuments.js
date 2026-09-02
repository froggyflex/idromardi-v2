const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");
const { v4: uuid } = require("uuid");

const R2_REFERENCE_PREFIX = "r2:";
const LOCAL_REFERENCE_PREFIX = "local:";
const IMPORTED_DOCUMENT_KEY_PREFIX = "imported-invoice-documents";
const LOCAL_IMPORT_ROOT = path.resolve(
  __dirname,
  "../../runtime_uploads/fatture-import"
);

function getR2Config() {
  return {
    bucket: process.env.R2_BUCKET,
    endpoint:
      process.env.R2_ENDPOINT ||
      (process.env.R2_ACCOUNT_ID
        ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        : null),
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  };
}

function isR2Configured() {
  const config = getR2Config();
  return Boolean(
    config.bucket && config.endpoint && config.accessKeyId && config.secretAccessKey
  );
}

let r2Client;
function getR2Client() {
  if (!isR2Configured()) {
    const error = new Error("Cloudflare R2 non configurato");
    error.statusCode = 500;
    throw error;
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

function safeKeyPart(value, fallback = "unknown") {
  return (
    String(value || fallback)
      .trim()
      .replace(/[^\w.-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || fallback
  );
}

function buildImportedDocumentKey({ condominioId, originalFilename }) {
  const extension = path.extname(String(originalFilename || "")).toLowerCase();
  const safeExtension = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";

  return [
    IMPORTED_DOCUMENT_KEY_PREFIX,
    safeKeyPart(condominioId, "no-condominio"),
    `${Date.now()}_${uuid()}${safeExtension}`,
  ].join("/");
}

function parseStoredReference(storedFilename) {
  const value = String(storedFilename || "").trim();
  if (value.startsWith(R2_REFERENCE_PREFIX)) {
    return { provider: "r2", key: value.slice(R2_REFERENCE_PREFIX.length) };
  }
  if (value.startsWith(LOCAL_REFERENCE_PREFIX)) {
    return { provider: "local", key: value.slice(LOCAL_REFERENCE_PREFIX.length) };
  }

  // Rows created before R2 support contain only the Multer filename.
  return { provider: "legacy-local", key: value };
}

function resolveLocalImportPath(key) {
  if (!key || key.includes("..") || path.isAbsolute(key)) {
    const error = new Error("Percorso del documento importato non valido");
    error.statusCode = 400;
    throw error;
  }

  const destination = path.resolve(LOCAL_IMPORT_ROOT, ...key.split(/[\\/]+/));
  if (!destination.startsWith(`${LOCAL_IMPORT_ROOT}${path.sep}`)) {
    const error = new Error("Percorso del documento importato non valido");
    error.statusCode = 400;
    throw error;
  }
  return destination;
}

async function saveImportedDocument({
  sourcePath,
  condominioId,
  originalFilename,
  mimeType,
}) {
  if (!isR2Configured()) {
    return {
      storedFilename: path.basename(sourcePath),
      provider: "local",
    };
  }

  const key = buildImportedDocumentKey({ condominioId, originalFilename });
  const config = getR2Config();
  const buffer = await fsPromises.readFile(sourcePath);

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType || "application/octet-stream",
      ContentDisposition: `attachment; filename="${safeKeyPart(
        originalFilename,
        "documento"
      )}"`,
    })
  );

  return {
    storedFilename: `${R2_REFERENCE_PREFIX}${key}`,
    provider: "r2",
  };
}

async function getImportedDocument(storedFilename) {
  const reference = parseStoredReference(storedFilename);
  if (!reference.key) {
    const error = new Error("Nessun file associato al documento");
    error.statusCode = 400;
    throw error;
  }

  if (reference.provider === "r2") {
    try {
      const config = getR2Config();
      const response = await getR2Client().send(
        new GetObjectCommand({ Bucket: config.bucket, Key: reference.key })
      );
      return {
        buffer: Buffer.from(await response.Body.transformToByteArray()),
        provider: "r2",
      };
    } catch (error) {
      if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
        const notFound = new Error("File importato non trovato nell'archivio R2");
        notFound.statusCode = 410;
        throw notFound;
      }
      throw error;
    }
  }

  const localPath = resolveLocalImportPath(reference.key);
  try {
    return {
      buffer: await fsPromises.readFile(localPath),
      provider: reference.provider,
      localPath,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      const notFound = new Error(
        "Il file originale non e piu disponibile sul disco temporaneo. Ricaricalo per archiviarlo in modo permanente."
      );
      notFound.statusCode = 410;
      throw notFound;
    }
    throw error;
  }
}

async function deleteImportedDocumentFile(storedFilename) {
  const reference = parseStoredReference(storedFilename);
  if (!reference.key) return false;

  if (reference.provider === "r2") {
    if (!isR2Configured()) return false;
    const config = getR2Config();
    await getR2Client().send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: reference.key })
    );
    return true;
  }

  const localPath = resolveLocalImportPath(reference.key);
  try {
    await fsPromises.unlink(localPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function removeUploadTempFile(filePath) {
  if (!filePath) return;
  try {
    await fsPromises.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function localImportedDocumentExists(storedFilename) {
  const reference = parseStoredReference(storedFilename);
  if (reference.provider === "r2" || !reference.key) return false;
  return fs.existsSync(resolveLocalImportPath(reference.key));
}

module.exports = {
  buildImportedDocumentKey,
  deleteImportedDocumentFile,
  getImportedDocument,
  isR2Configured,
  localImportedDocumentExists,
  parseStoredReference,
  removeUploadTempFile,
  saveImportedDocument,
};
