function parseITDate(str) {
  if (!str) return null;
  const [dd, mm, yyyy] = str.split("/");
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function summarizePeriodiAndTariffe( data) {
  const periodi = Array.isArray(data?.periodi_fatturazione) ? data.periodi_fatturazione : [];
  const tariffe = Array.isArray(data?.componente_tariffa_acquedotto)
    ? data.componente_tariffa_acquedotto
    : [];

  return periodi.map((periodo) => {
    const pStart = parseITDate(periodo.data_inizio);
    const pEnd = parseITDate(periodo.data_fine);

    const righeTariffa = tariffe.filter((r) => {
      const rStart = parseITDate(r.from_date);
      const rEnd = parseITDate(r.to_date);
      return rStart && rEnd && pStart && pEnd && rStart >= pStart && rEnd <= pEnd;
    });

    const quantita = righeTariffa.reduce((s, r) => s + Number(r.quantita || 0), 0);
    const importo = righeTariffa.reduce((s, r) => s + Number(r.importo || 0), 0);

    const positiveRows = righeTariffa.filter((r) => Number(r.quantita || 0) > 0);
    const negativeRows = righeTariffa.filter((r) => Number(r.quantita || 0) < 0);

    const quantitaPositive = positiveRows.reduce((s, r) => s + Number(r.quantita || 0), 0);
    const importoPositive = positiveRows.reduce((s, r) => s + Number(r.importo || 0), 0);

    const quantitaNegative = negativeRows.reduce((s, r) => s + Number(r.quantita || 0), 0);
    const importoNegative = negativeRows.reduce((s, r) => s + Number(r.importo || 0), 0);

    return {
      tipo_lettura: periodo.tipo_lettura,
      data_inizio: periodo.data_inizio,
      data_fine: periodo.data_fine,
      consumo_periodo_mc: Number(periodo.consumo_mc || 0),
      righe_tariffa: righeTariffa.map((r) => ({
        from_date: r.from_date,
        to_date: r.to_date,
        quantita: Number(r.quantita || 0),
        importo: Number(r.importo || 0),
        tariffa: Number(r.tariffa || 0)
      })),
      totali: {
        quantita: round2(quantita),
        importo: round2(importo),
        quantita_positive: round2(quantitaPositive),
        importo_positive: round2(importoPositive),
        quantita_negative: round2(quantitaNegative),
        importo_negative: round2(importoNegative)
      }
    };
  });
}
