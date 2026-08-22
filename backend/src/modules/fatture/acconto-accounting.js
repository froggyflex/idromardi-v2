function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Math.round((numberOrZero(value) + Number.EPSILON) * 100) / 100;
}

function getRowAccontoOther(row) {
  return roundMoney(
    numberOrZero(row?.acconto) -
      numberOrZero(row?.imp_acconto) -
      numberOrZero(row?.depfog_acconto)
  );
}

function buildAccontoAccountingCheck({
  rows = [],
  expectedTotal = 0,
  expectedAcquedotto = 0,
  expectedDepFog = 0,
}) {
  const allocatedTotal = roundMoney(
    rows.reduce((sum, row) => sum + numberOrZero(row?.acconto), 0)
  );
  const allocatedAcquedotto = roundMoney(
    rows.reduce((sum, row) => sum + numberOrZero(row?.imp_acconto), 0)
  );
  const allocatedDepFog = roundMoney(
    rows.reduce((sum, row) => sum + numberOrZero(row?.depfog_acconto), 0)
  );
  const allocatedOther = roundMoney(
    rows.reduce((sum, row) => sum + getRowAccontoOther(row), 0)
  );

  const totalResidual = roundMoney(numberOrZero(expectedTotal) - allocatedTotal);
  const acquedottoResidual = roundMoney(
    numberOrZero(expectedAcquedotto) - allocatedAcquedotto
  );
  const depFogResidual = roundMoney(numberOrZero(expectedDepFog) - allocatedDepFog);
  const rowBreakdownResidual = roundMoney(
    allocatedTotal - allocatedAcquedotto - allocatedDepFog - allocatedOther
  );

  return {
    expectedTotal: roundMoney(expectedTotal),
    allocatedTotal,
    totalResidual,
    expectedAcquedotto: roundMoney(expectedAcquedotto),
    allocatedAcquedotto,
    acquedottoResidual,
    expectedDepFog: roundMoney(expectedDepFog),
    allocatedDepFog,
    depFogResidual,
    allocatedOther,
    rowBreakdownResidual,
    passed:
      Math.abs(totalResidual) <= 0.01 &&
      Math.abs(acquedottoResidual) <= 0.01 &&
      Math.abs(depFogResidual) <= 0.01 &&
      Math.abs(rowBreakdownResidual) <= 0.01,
  };
}

module.exports = {
  buildAccontoAccountingCheck,
  getRowAccontoOther,
};
