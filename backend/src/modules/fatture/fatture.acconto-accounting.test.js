const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAccontoAccountingCheck,
  getRowAccontoOther,
} = require("./acconto-accounting");

const providers = ["ABC", "ASIS", "ACEA", "HERA", "IREN", "A2A", "NEPTA"];

for (const provider of providers) {
  test(`${provider}: the document acconto total is allocated exactly once`, () => {
    const rows = [
      { acconto: 169.71, imp_acconto: 99.97, depfog_acconto: 46.05 },
      { acconto: 169.70, imp_acconto: 99.97, depfog_acconto: 46.05 },
    ];

    const check = buildAccontoAccountingCheck({
      rows,
      expectedTotal: 339.41,
      expectedAcquedotto: 199.94,
      expectedDepFog: 92.1,
    });

    assert.equal(check.passed, true);
    assert.equal(check.allocatedTotal, 339.41);
    assert.equal(check.allocatedOther, 47.37);
    assert.equal(check.totalResidual, 0);
  });
}

test("detects an acconto allocation that does not match the document", () => {
  const check = buildAccontoAccountingCheck({
    rows: [{ acconto: 100, imp_acconto: 60, depfog_acconto: 20 }],
    expectedTotal: 101,
    expectedAcquedotto: 60,
    expectedDepFog: 20,
  });

  assert.equal(check.passed, false);
  assert.equal(check.totalResidual, 1);
});

test("derives the non-acquedotto and non-dep/fog share without double counting", () => {
  assert.equal(
    getRowAccontoOther({ acconto: 13.06, imp_acconto: 7.69, depfog_acconto: 3.55 }),
    1.82
  );
});
