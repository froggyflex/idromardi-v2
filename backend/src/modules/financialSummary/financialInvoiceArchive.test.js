const test = require("node:test");
const assert = require("node:assert/strict");
const { archiveIssuedInvoice } = require("./financialInvoiceArchive");

test("archives an issued invoice under its billing snapshot", async () => {
  let savedInput;
  const result = await archiveIssuedInvoice({
    financialInvoiceId: "invoice-1352",
    billingSessionId: "billing-session-6-2026",
    condominioId: "condominio-1",
    documentNumber: "FT-001352-VIA ROMA, 1",
    progressive: 1352,
    periodLabel: "31/03/2026 - 30/06/2026",
    generatePdf: async () => Buffer.from("%PDF-test"),
    saveDocument: async (input) => {
      savedInput = input;
      return {
        id: "generated-1",
        document_type: input.documentType,
        filename: input.filename,
      };
    },
  });

  assert.equal(savedInput.fatturaId, "billing-session-6-2026");
  assert.equal(savedInput.documentType, "fattura_emessa");
  assert.equal(savedInput.replace, true);
  assert.equal(savedInput.metadata.financialInvoiceId, "invoice-1352");
  assert.equal(savedInput.filename, "fattura_FT-001352-VIA-ROMA-1.pdf");
  assert.equal(result.archivedDocument.id, "generated-1");
  assert.equal(result.archiveWarning, null);
});

test("keeps invoice registration successful when PDF archiving fails", async () => {
  const errors = [];
  const result = await archiveIssuedInvoice({
    financialInvoiceId: "invoice-1352",
    billingSessionId: "billing-session-6-2026",
    condominioId: "condominio-1",
    documentNumber: "FT-001352",
    generatePdf: async () => {
      throw new Error("R2 unavailable");
    },
    saveDocument: async () => assert.fail("save must not run"),
    logger: { error: (...args) => errors.push(args) },
  });

  assert.equal(result.archivedDocument, null);
  assert.match(result.archiveWarning, /registrata correttamente/);
  assert.equal(errors.length, 1);
});
