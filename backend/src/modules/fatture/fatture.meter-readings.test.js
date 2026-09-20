const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isInverseMeter,
  resolveBillingReadings,
} = require("./meter-readings");

test("normal meters retain current and previous readings", () => {
  const result = resolveBillingReadings(
    { Contatore_Inverso: "NO" },
    { valore_lettura: 125, stato_lettura: "X" },
    { valore_lettura: 100, stato_lettura: "K" }
  );

  assert.equal(result.inverse, false);
  assert.equal(result.currentValue, 125);
  assert.equal(result.previousValue, 100);
  assert.equal(result.current.stato_lettura, "X");
});

test("inverse meters keep chronological columns and reverse only the consumption formula", () => {
  const result = resolveBillingReadings(
    { Contatore_Inverso: "SI" },
    { valore_lettura: 20, stato_lettura: "Y" },
    { valore_lettura: 50, stato_lettura: "K" }
  );

  assert.equal(result.inverse, true);
  assert.equal(result.currentValue, 20);
  assert.equal(result.previousValue, 50);
  assert.equal(result.calculationCurrentValue, 50);
  assert.equal(result.calculationPreviousValue, 20);
  assert.equal(result.current.valore_lettura, 20);
  assert.equal(result.previous.valore_lettura, 50);
  assert.equal(
    result.calculationCurrentValue - result.calculationPreviousValue,
    30
  );
});

test("inverse meters preserve missing readings instead of producing zero consumption", () => {
  const result = resolveBillingReadings(
    { contatore_inverso: "SI" },
    null,
    { valore_lettura: 100, stato_lettura: "K" }
  );

  assert.equal(result.currentValue, null);
  assert.equal(result.previousValue, 100);
  assert.equal(result.calculationCurrentValue, 100);
  assert.equal(result.calculationPreviousValue, null);
  assert.equal(result.current, null);
});

test("inverse meter accepts boolean and numeric database representations", () => {
  assert.equal(isInverseMeter({ inverso: true }), true);
  assert.equal(isInverseMeter({ inverso: 1 }), true);
  assert.equal(isInverseMeter({ inverso: 0 }), false);
});
