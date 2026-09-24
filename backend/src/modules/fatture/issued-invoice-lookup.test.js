const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findBestIssuedInvoice,
  formatPeriodLabel,
  scorePeriodMatch,
} = require("./issued-invoice-lookup");

const previous = {
  period_month: 3,
  period_year: 2026,
  data_lettura_operatore: "2026-03-31",
};
const current = {
  period_month: 6,
  period_year: 2026,
  data_lettura_operatore: "2026-06-18",
};

test("matches historical invoice descriptions that used month and year", () => {
  assert.ok(scorePeriodMatch({
    descrizione: "Lettura e fatturazione consumi idrici periodo dal 3.2026 al 6.2026 per condominio",
  }, previous, current) > 0);
});

test("prefers an exact full-date period and ignores another billing period", () => {
  const selected = findBestIssuedInvoice([
    {
      id: "wrong",
      descrizione: "Lettura e fatturazione consumi idrici periodo dal 12.2025 al 3.2026",
      created_at: "2026-07-02",
    },
    {
      id: "month-match",
      descrizione: "Lettura e fatturazione consumi idrici periodo dal 3.2026 al 6.2026",
      created_at: "2026-07-01",
    },
    {
      id: "exact-match",
      descrizione: "Lettura e fatturazione consumi idrici periodo dal 31/03/2026 al 18/06/2026",
      created_at: "2026-06-30",
    },
  ], previous, current);

  assert.equal(selected.id, "exact-match");
  assert.equal(formatPeriodLabel(previous, current), "03/2026 - 06/2026");
});
