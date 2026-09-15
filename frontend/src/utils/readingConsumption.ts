export function calculateReadingConsumption(
  currentValue: unknown,
  previousValue: unknown,
  state: unknown
): number | null {
  if (
    currentValue === null ||
    currentValue === undefined ||
    currentValue === "" ||
    previousValue === null ||
    previousValue === undefined ||
    previousValue === ""
  ) {
    return null;
  }

  const current = Number(currentValue);
  const previous = Number(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;

  if (current < previous) {
    return String(state || "").trim().toUpperCase() === "S"
      ? Math.max(0, current)
      : 0;
  }

  return current - previous;
}

export function readingFromConsumption(
  consumptionValue: unknown,
  previousValue: unknown,
  state: unknown
): number | null {
  if (consumptionValue === null || consumptionValue === undefined || consumptionValue === "") {
    return null;
  }

  const consumption = Number(consumptionValue);
  if (!Number.isFinite(consumption) || consumption < 0) return null;

  if (String(state || "").trim().toUpperCase() === "S") {
    return consumption;
  }

  const previous = Number(previousValue);
  return Number.isFinite(previous) ? previous + consumption : null;
}
