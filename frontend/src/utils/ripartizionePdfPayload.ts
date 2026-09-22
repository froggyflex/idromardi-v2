type Values = Record<string, any>;

function pick(source: Values | null | undefined, keys: string[]) {
  return Object.fromEntries(keys.filter(key => source?.[key] !== undefined).map(key => [key, source![key]]));
}

export function buildRipartizionePdfPayload(righe: Values[], dettaglioByUtenza: Record<string, Values[]>) {
  const rows = righe.map(row => ({
    utenza: pick(row.utenza, ["id", "id_user", "Nome", "Cognome", "Isolato", "Scala", "Interno"]),
    attuale: pick(row.attuale, ["valore_lettura", "stato_lettura"]),
    precedente: pick(row.precedente, ["valore_lettura"]),
    riga: pick(row.riga, [
      "lettura_attuale", "lettura_precedente", "stato_attuale", "consumo_totale",
      "consumo_acconto", "acconto", "imp_acconto", "depfog_acconto",
      "storno_acconto", "storno_txt_aggiuntivo", "storno_legacy", "storno_legacy_periodo",
      "totale", "imp_acquedotto", "imp_fognatura", "imp_depurazione", "imp_qf",
      "conguaglio", "imp_oneri_base_display", "imp_oneri", "imp_oneri_perequazione_display",
      "imp_iva", "minimum_payable_credit_euro", "credito_storno_residuo", "imp_arr",
    ]),
  }));
  const details = Object.fromEntries(rows.map(row => {
    const id = String(row.utenza.id ?? "");
    return [id, (dettaglioByUtenza[id] || []).map(tier => pick(tier, ["label", "ordine", "mc_allocati", "importo"]))];
  }));
  return { righe: rows, dettaglioByUtenza: details };
}
