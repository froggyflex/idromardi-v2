function isInverseMeter(utenza) {
  const value =
    utenza?.Contatore_Inverso ??
    utenza?.contatore_inverso ??
    utenza?.inverso ??
    "NO";

  return value === true || Number(value) === 1 || String(value).trim().toUpperCase() === "SI";
}

function resolveBillingReadings(utenza, currentReading, previousReading) {
  const inverse = isInverseMeter(utenza);
  const currentValue = currentReading?.valore_lettura ?? null;
  const previousValue = previousReading?.valore_lettura ?? null;
  const currentState = currentReading?.stato_lettura ?? null;
  const previousState = previousReading?.stato_lettura ?? null;

  return {
    inverse,
    currentValue,
    previousValue,
    calculationCurrentValue: inverse ? previousValue : currentValue,
    calculationPreviousValue: inverse ? currentValue : previousValue,
    currentState,
    previousState,
    current: currentReading || null,
    previous: previousReading || null,
  };
}

module.exports = {
  isInverseMeter,
  resolveBillingReadings,
};
