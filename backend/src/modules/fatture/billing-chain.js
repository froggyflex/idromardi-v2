function chainError(message, code, statusCode = 422, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
}

function periodLabel(session) {
  const month = Number(session?.period_month || session?.periodo_attuale_mese || 0);
  const year = Number(session?.period_year || session?.periodo_attuale_anno || 0);
  return month > 0 && year > 0 ? `${month}/${year}` : String(session?.id || "Periodo sconosciuto");
}

function parseStoredContext(session) {
  const raw = session?.calculation_context_json;
  if (!raw) return null;

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildReplayCalculationInput(session) {
  const context = parseStoredContext(session);
  if (!context) {
    throw chainError(
      `Il periodo ${periodLabel(session)} non contiene i dati di calcolo necessari per una rielaborazione automatica.`,
      "CHAIN_RECALCULATION_CONTEXT_MISSING",
      422,
      { failedSessionId: session?.id || null, failedPeriod: periodLabel(session) }
    );
  }

  return {
    sessionId: session.id,
    tfCode: context.tfCode || session.tf_code || "TF1",
    annoAtt: context.annoTariffa ?? session.period_year ?? null,
    eurStorno: context.eurStorno ?? context.parsedStornoTotale ?? 0,
    parsedQF: context.parsedQuotaFissa ?? null,
    parsedAccontoImporto: context.parsedAccontoImporto ?? null,
    parsedAccontoDepFog: context.parsedAccontoDepFog ?? null,
    parsedAccontoTotale: context.parsedAccontoTotale ?? null,
    parsedOneriPerequazione: context.parsedOneriPerequazione ?? null,
    parsedOneriPerequazioneAcconto: context.parsedOneriPerequazioneAcconto ?? null,
    totaleParsedWithOneri:
      context.totaleDocumento ?? context.abcDocumentTotal ?? session.grand_total ?? 0,
    importedDocumentId:
      context.importedDocumentId ?? session.imported_document_id ?? null,
    calculationContext: context,
  };
}

function prepareLaterSessionsForReplay(sessions) {
  const ordered = [...(sessions || [])].sort((a, b) => {
    const yearDiff = Number(a.period_year || 0) - Number(b.period_year || 0);
    if (yearDiff) return yearDiff;
    return Number(a.period_month || 0) - Number(b.period_month || 0);
  });
  const confirmed = ordered.filter(
    (session) => String(session.stato || "").toUpperCase() === "CONFERMATA"
  );

  if (confirmed.length) {
    const dependencies = confirmed.map((session) => ({
      id: session.id,
      stato: session.stato,
      mese: Number(session.period_month),
      anno: Number(session.period_year),
      periodo: periodLabel(session),
    }));
    throw chainError(
      "La rielaborazione non puo proseguire perche uno o piu periodi successivi sono confermati.",
      "CHAIN_RECALCULATION_CONFIRMED_PERIOD",
      409,
      { dependencies }
    );
  }

  return ordered.map((session) => ({
    session,
    input: buildReplayCalculationInput(session),
    period: periodLabel(session),
  }));
}

module.exports = {
  buildReplayCalculationInput,
  parseStoredContext,
  periodLabel,
  prepareLaterSessionsForReplay,
};
