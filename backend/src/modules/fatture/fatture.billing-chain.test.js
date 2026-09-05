const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildReplayCalculationInput,
  prepareLaterSessionsForReplay,
} = require("./billing-chain");

test("replays later periods in chronological order with their saved inputs", () => {
  const sessions = [
    {
      id: "june",
      stato: "CALCOLATA",
      period_year: 2026,
      period_month: 6,
      tf_code: "TF1",
      imported_document_id: 12,
      calculation_context_json: JSON.stringify({
        tfCode: "TF3",
        annoTariffa: 2026,
        totaleDocumento: 300,
        parsedAccontoTotale: 25,
      }),
    },
    {
      id: "march",
      stato: "CALCOLATA",
      period_year: 2026,
      period_month: 3,
      tf_code: "TF2",
      imported_document_id: 11,
      calculation_context_json: JSON.stringify({ totaleDocumento: 200 }),
    },
  ];

  const prepared = prepareLaterSessionsForReplay(sessions);

  assert.deepEqual(prepared.map((item) => item.session.id), ["march", "june"]);
  assert.equal(prepared[0].input.tfCode, "TF2");
  assert.equal(prepared[1].input.tfCode, "TF3");
  assert.equal(prepared[1].input.parsedAccontoTotale, 25);
  assert.equal(prepared[1].input.importedDocumentId, 12);
});

test("blocks a chain containing a confirmed period", () => {
  assert.throws(
    () =>
      prepareLaterSessionsForReplay([
        {
          id: "confirmed",
          stato: "CONFERMATA",
          period_year: 2026,
          period_month: 6,
          calculation_context_json: "{}",
        },
      ]),
    (error) =>
      error.code === "CHAIN_RECALCULATION_CONFIRMED_PERIOD" &&
      error.statusCode === 409 &&
      error.dependencies[0].periodo === "6/2026"
  );
});

test("blocks replay when a later period has no saved calculation context", () => {
  assert.throws(
    () =>
      buildReplayCalculationInput({
        id: "missing-context",
        stato: "CALCOLATA",
        period_year: 2026,
        period_month: 3,
      }),
    (error) =>
      error.code === "CHAIN_RECALCULATION_CONTEXT_MISSING" &&
      error.failedPeriod === "3/2026"
  );
});
