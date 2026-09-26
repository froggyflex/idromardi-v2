function normalizeState(value) {
  return String(value || "").trim().toUpperCase();
}

function isBlockedMeterState(value) {
  return normalizeState(value) === "B";
}

function followsPreviousExceptionalState(value) {
  return ["Y", "B"].includes(normalizeState(value));
}

function resolveReadingValue({ state, submittedValue, previousValue }) {
  if (isBlockedMeterState(state)) {
    const previous = Number(previousValue);
    if (
      previousValue === null ||
      previousValue === undefined ||
      previousValue === "" ||
      !Number.isFinite(previous)
    ) {
      const error = new Error(
        "Lo stato B richiede una lettura precedente: impossibile impostare il contatore come bloccato."
      );
      error.statusCode = 409;
      error.code = "BLOCKED_METER_WITHOUT_PREVIOUS_READING";
      throw error;
    }
    return previous;
  }

  if (submittedValue === null || submittedValue === "" || submittedValue === undefined) {
    return null;
  }

  const value = Number(submittedValue);
  return Number.isFinite(value) ? value : null;
}

module.exports = {
  followsPreviousExceptionalState,
  isBlockedMeterState,
  normalizeState,
  resolveReadingValue,
};
