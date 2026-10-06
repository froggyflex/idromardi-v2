const LABELS = {
  kicker: "Ripartizione consumi idrici", title: "Bolletta di Ripartizione", subtitle: "Documento amministrativo interno",
  customer: "Intestatario / riferimento utenza", condominium: "Condominio", userId: "ID utente", location: "Ubicazione", total: "Totale documento",
  readings: "Letture e consumi", period: "Periodo", readingDate: "Data lettura", readingStatus: "Stato lettura",
  previous: "Lettura precedente", current: "Lettura attuale", consumption: "Consumo totale",
  costs: "Dettaglio economico", item: "Voce", amount: "Importo", water: "Acquedotto", sewer: "Fognatura", treatment: "Depurazione",
  fixed: "Quota fissa", adjustment: "Conguaglio", charges: "Oneri", equalization: "Oneri perequazione", vat: "IVA",
  advanceWater: "Acconto Acquedotto", advanceSewer: "Acconto dep./fog.", advanceOther: "Acconto QF/IVA/perequazione/altri",
  reversalTxt: "Storno da documento TXT", reversalLegacy: "Storno acconto piattaforma precedente", reversalCredit: "Storno credito periodi precedenti",
  reversal: "Storno acconto", remainingCredit: "Credito residuo rinviato", creditNote: "Non incluso nel totale; disponibile per un periodo successivo",
  rounding: "Arrotondamento", tiers: "Dettagli Ripartizione", notes: "Note lettura", references: "Riferimenti",
  footer: "Documento generato per finalita di ripartizione interna dei consumi idrici.",
};
const SECTION_NAMES = { readings: "Letture e consumi", costs: "Dettaglio economico", tiers: "Ripartizione", notes: "Note lettura", references: "Riferimenti" };
const DEFAULT_TEMPLATE = {
  labels: LABELS,
  page: { gap: 2.2, padding: 3, mainWidth: 64, titleSize: 17, customerSize: 12.5, totalSize: 17 },
  sections: {
    readings: { column: "main", order: 0, fontSize: 8.4, padding: 2.4 },
    costs: { column: "main", order: 1, fontSize: 8.4, padding: 2.12 },
    tiers: { column: "side", order: 0, fontSize: 7.8, padding: 3 },
    notes: { column: "side", order: 1, fontSize: 7.4, padding: 3 },
    references: { column: "side", order: 2, fontSize: 7.4, padding: 3 },
  },
};
function invalid(message) { return Object.assign(new Error(message), { statusCode: 400 }); }
function object(value) { return value && typeof value === "object" && !Array.isArray(value); }
function bounded(value, min, max, key) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw invalid(`Valore non valido: ${key} (${min}-${max}).`);
  return value;
}
function validateOverrides(input) {
  if (!object(input)) throw invalid("Modello non valido.");
  const out = {};
  for (const key of Object.keys(input)) if (!["labels", "page", "sections"].includes(key)) throw invalid(`Proprieta sconosciuta: ${key}`);
  if (input.labels !== undefined) {
    if (!object(input.labels)) throw invalid("Etichette non valide.");
    out.labels = {};
    for (const [key, value] of Object.entries(input.labels)) {
      if (!Object.hasOwn(LABELS, key) || typeof value !== "string" || !value.trim() || value.length > (key === "footer" || key === "creditNote" ? 220 : 100) || /[\x00-\x1f]/.test(value)) throw invalid(`Etichetta non valida: ${key}`);
      out.labels[key] = value.trim();
    }
  }
  if (input.page !== undefined) {
    if (!object(input.page)) throw invalid("Pagina non valida.");
    out.page = {};
    const bounds = { gap: [0, 6], padding: [1, 6], mainWidth: [50, 75], titleSize: [12, 24], customerSize: [9, 18], totalSize: [12, 26] };
    for (const [key, value] of Object.entries(input.page)) {
      if (!bounds[key]) throw invalid(`Parametro sconosciuto: ${key}`);
      out.page[key] = bounded(value, ...bounds[key], key);
    }
  }
  if (input.sections !== undefined) {
    if (!object(input.sections)) throw invalid("Sezioni non valide.");
    out.sections = {};
    for (const [id, config] of Object.entries(input.sections)) {
      if (!Object.hasOwn(SECTION_NAMES, id) || !object(config)) throw invalid(`Sezione non valida: ${id}`);
      out.sections[id] = {};
      for (const [key, value] of Object.entries(config)) {
        if (key === "column") {
          if (!["main", "side", "full"].includes(value)) throw invalid("Colonna non valida.");
          out.sections[id][key] = value;
        } else if (key === "order") {
          out.sections[id][key] = bounded(value, 0, 20, key);
          if (!Number.isInteger(value)) throw invalid("Ordine non valido.");
        } else if (key === "fontSize") out.sections[id][key] = bounded(value, 7, 12, key);
        else if (key === "padding") out.sections[id][key] = bounded(value, 1, 6, key);
        else throw invalid(`Parametro sezione sconosciuto: ${key}`);
      }
    }
  }
  return out;
}
function resolveTemplate(base = DEFAULT_TEMPLATE, overrides = {}) {
  return {
    labels: { ...base.labels, ...overrides.labels }, page: { ...base.page, ...overrides.page },
    sections: Object.fromEntries(Object.keys(SECTION_NAMES).map(id => [id, { ...base.sections[id], ...overrides.sections?.[id] }])),
  };
}
function diffTemplate(base, effective) {
  const out = { labels: {}, page: {}, sections: {} };
  for (const group of ["labels", "page"]) for (const [key, value] of Object.entries(effective[group])) if (value !== base[group][key]) out[group][key] = value;
  for (const [id, config] of Object.entries(effective.sections)) {
    const diff = Object.fromEntries(Object.entries(config).filter(([key, value]) => value !== base.sections[id][key]));
    if (Object.keys(diff).length) out.sections[id] = diff;
  }
  return out;
}
module.exports = { DEFAULT_TEMPLATE, SECTION_NAMES, validateOverrides, resolveTemplate, diffTemplate };
