const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildImportedDocumentKey,
  deleteImportedDocumentFile,
  getImportedDocument,
  parseStoredReference,
  saveImportedDocument,
} = require("./importedDocuments");

test("recognizes durable and legacy imported document references", () => {
  assert.deepEqual(parseStoredReference("r2:imported/file.txt"), {
    provider: "r2",
    key: "imported/file.txt",
  });
  assert.deepEqual(parseStoredReference("local:file.txt"), {
    provider: "local",
    key: "file.txt",
  });
  assert.deepEqual(parseStoredReference("file-123.txt"), {
    provider: "legacy-local",
    key: "file-123.txt",
  });
});

test("builds a scoped R2 key without exposing the original filename", () => {
  const key = buildImportedDocumentKey({
    condominioId: "condominio/15",
    originalFilename: "Bolletta cliente 2026.TXT",
  });

  assert.match(
    key,
    /^imported-invoice-documents\/condominio_15\/\d+_[0-9a-f-]+\.txt$/
  );
  assert.equal(key.includes("Bolletta cliente"), false);
});

test("keeps a durable local copy when the temporary upload is removed", async () => {
  const previous = {
    bucket: process.env.R2_BUCKET,
    endpoint: process.env.R2_ENDPOINT,
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    render: process.env.RENDER,
    renderServiceId: process.env.RENDER_SERVICE_ID,
  };
  delete process.env.R2_BUCKET;
  delete process.env.R2_ENDPOINT;
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.RENDER;
  delete process.env.RENDER_SERVICE_ID;

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "idromardi-import-"));
  const sourcePath = path.join(tempRoot, "bolletta.txt");
  const content = "documento di prova\n";
  await fs.writeFile(sourcePath, content);

  let storedFilename;
  try {
    const saved = await saveImportedDocument({
      sourcePath,
      condominioId: "condominio-test",
      originalFilename: "bolletta.txt",
      mimeType: "text/plain",
    });
    storedFilename = saved.storedFilename;

    assert.equal(saved.provider, "local");
    assert.match(saved.storedFilename, /^local:imported-invoice-documents\//);

    await fs.unlink(sourcePath);
    const stored = await getImportedDocument(saved.storedFilename);
    assert.equal(stored.buffer.toString("utf8"), content);
  } finally {
    if (storedFilename) await deleteImportedDocumentFile(storedFilename);
    await fs.rm(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries({
      R2_BUCKET: previous.bucket,
      R2_ENDPOINT: previous.endpoint,
      R2_ACCOUNT_ID: previous.accountId,
      R2_ACCESS_KEY_ID: previous.accessKeyId,
      R2_SECRET_ACCESS_KEY: previous.secretAccessKey,
      RENDER: previous.render,
      RENDER_SERVICE_ID: previous.renderServiceId,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("refuses temporary local storage on Render when R2 is unavailable", async () => {
  const previous = {
    bucket: process.env.R2_BUCKET,
    render: process.env.RENDER,
  };
  delete process.env.R2_BUCKET;
  process.env.RENDER = "true";

  try {
    await assert.rejects(
      saveImportedDocument({
        sourcePath: "unused.txt",
        condominioId: "condominio-test",
        originalFilename: "bolletta.txt",
        mimeType: "text/plain",
      }),
      (error) => error.statusCode === 503 && /Cloudflare R2/.test(error.message)
    );
  } finally {
    if (previous.bucket === undefined) delete process.env.R2_BUCKET;
    else process.env.R2_BUCKET = previous.bucket;
    if (previous.render === undefined) delete process.env.RENDER;
    else process.env.RENDER = previous.render;
  }
});
