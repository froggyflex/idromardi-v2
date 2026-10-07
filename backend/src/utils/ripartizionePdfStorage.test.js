const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { resolveRipartizionePdfPath, readRipartizionePdf } = require("./ripartizionePdfStorage");

test("legacy upload paths resolve from the backend instead of the server's working directory", () => {
  const expected = path.resolve(__dirname, "../../uploads/ripartizioni/bill.pdf");
  for (const stored of ["/uploads/ripartizioni/bill.pdf", "uploads/ripartizioni/bill.pdf", "backend/uploads/ripartizioni/bill.pdf", "uploads\\ripartizioni\\bill.pdf", "./uploads/ripartizioni/bill.pdf"]) {
    assert.equal(resolveRipartizionePdfPath(stored), expected);
  }
  assert.equal(resolveRipartizionePdfPath(expected), expected);
});

test("empty file references produce the same actionable error as a lost archived PDF", async () => {
  await assert.rejects(readRipartizionePdf({ filepath: null }), { statusCode: 410, code: "PDF_FILE_MISSING" });
});
