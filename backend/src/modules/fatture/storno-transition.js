function money(value) {
  const parsed = Number(value);
  return Math.round((Number.isFinite(parsed) ? parsed : 0) * 100) / 100;
}

function resolveLegacyTxtTransition(txtRequestedValue, legacyOpenValue) {
  const txtRequested = money(Math.max(0, money(txtRequestedValue)));
  const legacyOpen = money(Math.max(0, money(legacyOpenValue)));

  if (txtRequested <= 0 || legacyOpen <= 0) {
    return {
      triggered: false,
      matched: 0,
      shortageAbsorbed: 0,
      deferred: 0,
      status: "NESSUNO",
    };
  }

  if (txtRequested < legacyOpen) {
    return {
      triggered: true,
      matched: txtRequested,
      shortageAbsorbed: money(legacyOpen - txtRequested),
      deferred: 0,
      status: "LEGACY_CARENZA_ASSORBITA",
    };
  }

  if (txtRequested > legacyOpen) {
    return {
      triggered: true,
      matched: legacyOpen,
      shortageAbsorbed: 0,
      deferred: money(txtRequested - legacyOpen),
      status: "LEGACY_ECCESSO_DIFFERITO",
    };
  }

  return {
    triggered: true,
    matched: legacyOpen,
    shortageAbsorbed: 0,
    deferred: 0,
    status: "LEGACY_ESATTO",
  };
}

module.exports = { resolveLegacyTxtTransition };
