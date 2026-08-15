const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveLegacyTxtTransition } = require("./storno-transition");

test("a period without TXT storno leaves the legacy balance untouched", () => {
  assert.deepEqual(resolveLegacyTxtTransition(0, 3.86), {
    triggered: false,
    matched: 0,
    shortageAbsorbed: 0,
    deferred: 0,
    status: "NESSUNO",
  });
});

test("a smaller TXT amount is absorbed and the legacy target remains authoritative", () => {
  assert.deepEqual(resolveLegacyTxtTransition(2, 3.86), {
    triggered: true,
    matched: 2,
    shortageAbsorbed: 1.86,
    deferred: 0,
    status: "LEGACY_CARENZA_ASSORBITA",
  });
});

test("an exact TXT amount matches the legacy target", () => {
  assert.deepEqual(resolveLegacyTxtTransition(3.86, 3.86), {
    triggered: true,
    matched: 3.86,
    shortageAbsorbed: 0,
    deferred: 0,
    status: "LEGACY_ESATTO",
  });
});

test("a larger TXT amount applies the legacy target and defers only the excess", () => {
  assert.deepEqual(resolveLegacyTxtTransition(5, 3.86), {
    triggered: true,
    matched: 3.86,
    shortageAbsorbed: 0,
    deferred: 1.14,
    status: "LEGACY_ECCESSO_DIFFERITO",
  });
});
