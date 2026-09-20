export function calculateReadingConsumption(
  currentValue: unknown,
  previousValue: unknown,
  state: unknown,
  inverse = false
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

  const normalizedState = String(state || "").trim().toUpperCase();

  if (inverse) {
    if (normalizedState === "S") return Math.max(0, current);
    return previous >= current ? previous - current : 0;
  }

  if (current < previous) {
    return normalizedState === "S"
      ? Math.max(0, current)
      : 0;
  }

  return current - previous;
}

export function readingFromConsumption(
  consumptionValue: unknown,
  previousValue: unknown,
  state: unknown,
  inverse = false
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
  return Number.isFinite(previous)
    ? inverse
      ? Math.max(0, previous - consumption)
      : previous + consumption
    : null;
}

export function isInverseMeter(utenza: any): boolean {
  const value =
    utenza?.Contatore_Inverso ??
    utenza?.contatore_inverso ??
    utenza?.inverso ??
    "NO";

  return value === true || Number(value) === 1 || String(value).trim().toUpperCase() === "SI";
}
