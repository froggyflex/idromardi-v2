const fs = require("fs/promises");
const path = require("path");
const {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");

const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Local fallback photos must never live below `uploads`, because that directory
// is intentionally exposed by Express for legacy public assets.
const LOCAL_PHOTO_ROOT = path.resolve(
  __dirname,
  "../../runtime_uploads/mobile-readings"
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

function assertPhotoMimeType(mimeType) {
  const extension = MIME_EXTENSIONS[mimeType];
  if (!extension) {
    const error = new Error("Sono ammesse solo immagini JPEG, PNG o WEBP");
    error.statusCode = 415;
    throw error;
  }
  return extension;
}

async function saveReadingPhoto({ submissionId, buffer, mimeType, sha256 }) {
  const extension = assertPhotoMimeType(mimeType);
  // Including the checksum prevents two concurrent, different retries from
  // overwriting the object that won the database transaction.
  const relativeKey = `mobile-readings/${submissionId}/${sha256}.${extension}`;

  if (isR2Configured()) {
    const config = getR2Config();
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: relativeKey,
        Body: buffer,
        ContentType: mimeType,
        Metadata: { sha256 },
      })
    );
    return `r2:${relativeKey}`;
  }

  const destination = path.join(
    LOCAL_PHOTO_ROOT,
    ...relativeKey.replace(/^mobile-readings\//, "").split("/")
  );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, buffer);
  return `local:${relativeKey}`;
}

async function getReadingPhoto(objectKey) {
  const [provider, ...keyParts] = String(objectKey || "").split(":");
  const key = keyParts.join(":");
  if (!key || key.includes("..")) {
    const error = new Error("Foto non disponibile");
    error.statusCode = 404;
    throw error;
  }

  if (provider === "r2") {
    const config = getR2Config();
    const response = await getR2Client().send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key })
    );
    return {
      buffer: Buffer.from(await response.Body.transformToByteArray()),
      mimeType: response.ContentType || "application/octet-stream",
    };
  }

  if (provider === "local") {
    const relativePath = key.replace(/^mobile-readings\//, "");
    const destination = path.resolve(LOCAL_PHOTO_ROOT, ...relativePath.split("/"));
    if (!destination.startsWith(`${LOCAL_PHOTO_ROOT}${path.sep}`)) {
      const error = new Error("Percorso foto non valido");
      error.statusCode = 400;
      throw error;
    }
    return { buffer: await fs.readFile(destination) };
  }

  const error = new Error("Provider foto non valido");
  error.statusCode = 500;
  throw error;
}

module.exports = {
  assertPhotoMimeType,
  getReadingPhoto,
  saveReadingPhoto,
};
