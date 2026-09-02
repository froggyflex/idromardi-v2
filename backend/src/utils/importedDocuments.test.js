const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildImportedDocumentKey,
  parseStoredReference,
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
