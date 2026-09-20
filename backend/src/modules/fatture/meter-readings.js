function isInverseMeter(utenza) {
  const value =
    utenza?.Contatore_Inverso ??
    utenza?.contatore_inverso ??
    utenza?.inverso ??
    "NO";

  return value === true || Number(value) === 1 || String(value).trim().toUpperCase() === "SI";
}

function buildReading(source, value, state) {
  if (!source && value === null && state === null) return null;

  return {
    ...(source || {}),
    valore_lettura: value,
    stato_lettura: state,
  };
}

function resolveBillingReadings(utenza, currentReading, previousReading) {
  const inverse = isInverseMeter(utenza);
  const rawCurrentValue = currentReading?.valore_lettura ?? null;
  const rawPreviousValue = previousReading?.valore_lettura ?? null;
  const currentState = currentReading?.stato_lettura ?? null;
  const previousState = previousReading?.stato_lettura ?? null;

  const currentValue = inverse ? rawPreviousValue : rawCurrentValue;
  const previousValue = inverse ? rawCurrentValue : rawPreviousValue;

  return {
    inverse,
    currentValue,
    previousValue,
    currentState,
    previousState,
    current: buildReading(currentReading || previousReading, currentValue, currentState),
    previous: buildReading(previousReading || currentReading, previousValue, previousState),
  };
}

module.exports = {
  isInverseMeter,
  resolveBillingReadings,
};
