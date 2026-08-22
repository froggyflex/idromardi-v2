"use strict";

const DEFAULT_NUCLEUS_SIZE = 3;

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((numberOrZero(value) + Number.EPSILON) * factor) / factor;
}

function effectiveNucleus(value, fallback = DEFAULT_NUCLEUS_SIZE) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isEnabled(value) {
  if (typeof value === "string") {
    return !["", "0", "FALSE", "NO"].includes(value.trim().toUpperCase());
  }
  return Boolean(Number(value));
}

function getTierSpan(ordered, index) {
  const tier = ordered[index];
  if (tier.mc_a_base === null || tier.mc_a_base === undefined || tier.mc_a_base === "") {
    return Infinity;
  }

  const from = numberOrZero(tier.mc_da_base);
  const to = numberOrZero(tier.mc_a_base);
  let span = to - from;

  // Tariffe Casa Idrica accepts the common integer notation 0-20, 21-70,
  // 71-100. In that notation, subsequent limits are inclusive.
  const previousTo = index > 0 ? ordered[index - 1].mc_a_base : null;
  const isContiguousIntegerBand =
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    ((index === 0 && from === 1) ||
      (previousTo !== null &&
        previousTo !== undefined &&
        Number.isInteger(Number(previousTo)) &&
        from === Number(previousTo) + 1));

  if (isContiguousIntegerBand) span += 1;
  return Math.max(0, span);
}

function allocateTariffConsumption({
  consumption,
  tiers,
  nucleus,
  units = 1,
  referenceDays,
  yearDays,
  key = null,
}) {
  const ordered = Array.isArray(tiers)
    ? [...tiers].sort((a, b) => numberOrZero(a.ordine) - numberOrZero(b.ordine))
    : [];

  if (!ordered.length) {
    throw new Error("Nessuno scaglione acquedotto configurato per la tariffa selezionata");
  }

  let remaining = Math.max(0, numberOrZero(consumption));
  const days = numberOrZero(referenceDays);
  const daysInYear = numberOrZero(yearDays);

  if (remaining > 0 && (days <= 0 || daysInYear <= 0)) {
    throw new Error("Giorni di consumo non validi per il calcolo degli scaglioni");
  }

  const householdSize = effectiveNucleus(nucleus);
  const unitCount = Math.max(1, numberOrZero(units));
  const allocations = [];
  let total = 0;

  for (let index = 0; index < ordered.length && remaining > 0; index += 1) {
    const tier = ordered[index];
    const annualSpan = getTierSpan(ordered, index);
    const householdMultiplier = isEnabled(tier.moltiplica_per_nucleo)
      ? householdSize
      : 1;
    const capacity =
      annualSpan === Infinity
        ? Infinity
        : (annualSpan * householdMultiplier * unitCount * days) / daysInYear;
    const allocated = capacity === Infinity ? remaining : Math.min(remaining, capacity);
    const allocatedMc = round(allocated, 3);
    const price = numberOrZero(tier.prezzo_acquedotto);
    const amount = round(allocatedMc * price, 2);

    total = round(total + amount, 2);
    remaining = Math.max(0, remaining - allocated);
    allocations.push({
      ordine: numberOrZero(tier.ordine),
      label:
        tier.label ||
        tier.nome ||
        tier.descrizione ||
        `Scaglione ${tier.ordine || index + 1}`,
      mc_allocati: allocatedMc,
      price,
      importo: amount,
      mc_da_base: numberOrZero(tier.mc_da_base),
      mc_a_base:
        tier.mc_a_base === null || tier.mc_a_base === undefined || tier.mc_a_base === ""
          ? null
          : numberOrZero(tier.mc_a_base),
      key,
      capacity: capacity === Infinity ? null : round(capacity, 3),
      moltiplicatore_nucleo: householdMultiplier,
      unita: unitCount,
    });
  }

  if (remaining > 0.0005) {
    throw new Error(
      `Gli scaglioni configurati non coprono ${round(remaining, 3)} mc di consumo`
    );
  }

  return {
    total: round(total, 2),
    tiers: allocations,
    allocatedConsumption: round(
      allocations.reduce((sum, item) => sum + item.mc_allocati, 0),
      3
    ),
  };
}

module.exports = {
  DEFAULT_NUCLEUS_SIZE,
  allocateTariffConsumption,
  effectiveNucleus,
  getTierSpan,
};
