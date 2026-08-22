"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  allocateTariffConsumption,
  buildTariffDateSegments,
  effectiveNucleus,
  getTierSpan,
} = require("./tariff-allocation");

const abcTiers = [
  { ordine: 1, nome: "Agevolata", mc_da_base: 0, mc_a_base: 20, moltiplica_per_nucleo: 1, prezzo_acquedotto: 0.48233 },
  { ordine: 2, nome: "Base", mc_da_base: 21, mc_a_base: 70, moltiplica_per_nucleo: 1, prezzo_acquedotto: 0.875939 },
  { ordine: 3, nome: "Eccedenza", mc_da_base: 71, mc_a_base: null, moltiplica_per_nucleo: 1, prezzo_acquedotto: 1.44144 },
];

test("uses the legacy household fallback only when nucleus is missing", () => {
  assert.equal(effectiveNucleus(0), 3);
  assert.equal(effectiveNucleus(null), 3);
  assert.equal(effectiveNucleus(2), 2);
});

test("interprets configured integer bands without losing cubic metres", () => {
  assert.equal(getTierSpan(abcTiers, 0), 20);
  assert.equal(getTierSpan(abcTiers, 1), 50);
  assert.equal(getTierSpan(abcTiers, 2), Infinity);
});

test("allocates all user consumption over the configured provider tiers", () => {
  const result = allocateTariffConsumption({
    consumption: 96,
    tiers: abcTiers,
    nucleus: 0,
    referenceDays: 190,
    yearDays: 365,
  });

  assert.equal(result.allocatedConsumption, 96);
  assert.equal(result.tiers[0].moltiplicatore_nucleo, 3);
  assert.equal(
    Number(result.tiers.reduce((sum, tier) => sum + tier.importo, 0).toFixed(2)),
    result.total
  );
});

test("honors the actual household size instead of a hardcoded multiplier", () => {
  const forTwoPeople = allocateTariffConsumption({
    consumption: 60,
    tiers: abcTiers,
    nucleus: 2,
    referenceDays: 365,
    yearDays: 365,
  });
  const forFourPeople = allocateTariffConsumption({
    consumption: 60,
    tiers: abcTiers,
    nucleus: 4,
    referenceDays: 365,
    yearDays: 365,
  });

  assert.equal(forTwoPeople.tiers[0].capacity, 40);
  assert.equal(forFourPeople.tiers[0].capacity, 80);
  assert.ok(forTwoPeople.total > forFourPeople.total);
});

test("supports provider tiers that are not multiplied by household size", () => {
  const asisTiers = [
    { ordine: 1, nome: "Prima fascia", mc_da_base: 0, mc_a_base: 10, moltiplica_per_nucleo: 0, prezzo_acquedotto: 1.25 },
    { ordine: 2, nome: "Seconda fascia", mc_da_base: 11, mc_a_base: null, moltiplica_per_nucleo: 0, prezzo_acquedotto: 2 },
  ];
  const result = allocateTariffConsumption({
    consumption: 12,
    tiers: asisTiers,
    nucleus: 5,
    referenceDays: 365,
    yearDays: 365,
  });

  assert.deepEqual(result.tiers.map((tier) => tier.mc_allocati), [10, 2]);
  assert.equal(result.total, 16.5);
});

test("refuses incomplete tariff configurations", () => {
  assert.throws(
    () =>
      allocateTariffConsumption({
        consumption: 25,
        tiers: [abcTiers[0]],
        nucleus: 1,
        referenceDays: 365,
        yearDays: 365,
      }),
    /non coprono 5 mc/
  );
});

test("splits a billing interval when tariff year changes", () => {
  const segments = buildTariffDateSegments({
    startDate: "2025-12-20",
    endDate: "2026-01-11",
    versions: [
      { id: "v2025", anno: 2025, valid_from: "2025-01-01", valid_to: "2025-12-31" },
      { id: "v2026", anno: 2026, valid_from: "2026-01-01", valid_to: "2026-12-31" },
    ],
  });

  assert.deepEqual(
    segments.map((segment) => ({ id: segment.version.id, days: segment.days })),
    [
      { id: "v2025", days: 12 },
      { id: "v2026", days: 10 },
    ]
  );
  assert.equal(segments.some((segment) => segment.fallback), false);
});

test("uses the latest configured tariff for uncovered dates", () => {
  const segments = buildTariffDateSegments({
    startDate: "2025-12-30",
    endDate: "2026-01-02",
    versions: [
      { id: "v2024", anno: 2024, valid_from: "2024-01-01", valid_to: "2024-12-31" },
      { id: "v2026", anno: 2026, valid_from: "2026-01-01", valid_to: "2026-12-31" },
    ],
  });

  assert.equal(segments[0].version.id, "v2026");
  assert.equal(segments[0].fallback, true);
  assert.equal(segments.reduce((sum, segment) => sum + segment.days, 0), 3);
});
