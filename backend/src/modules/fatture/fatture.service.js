const db = require("../../config/db");
const { v4: uuid } = require("uuid");

/* ---------------- Helpers ---------------- */

function assertUUID(value, name) {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!value || !uuidRegex.test(value)) {
    throw new Error(`${name} must be a valid UUID`);
  }
}



function n2(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function round2(x) {
  return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
}

function yearDaysCount(year) {
  // leap year check
  const y = Number(year);
  const leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
  return leap ? 366 : 365;
}

/**
 * Allocate acquedotto amount using scaglioni for a given consumo and giorniRef.
 *
 * Scaglione structure assumed:
 * - mc_da_base
 * - mc_a_base (nullable => Infinity)
 * - moltiplica_per_nucleo (0/1)
 * - prezzo_acquedotto
 *
 * Effective tier capacity for the billing window:
 * annual_limit_base * (nucleo if flag) * nuae
 * then prorated by giorniRef/yearDaysCount
 */
function allocateAcquedotto({ consumo, scaglioni, nucleo, nuae, giorniRef, yearDays }) {
  let remaining = Math.max(0, n2(consumo));
  let total = 0;

  const N = Math.max(1, n2(nucleo));
  const A = Math.max(1, n2(nuae));
  const days = Math.max(0, n2(giorniRef));

  // Sort by ordine or mc_da_base ascending (defensive)
  const ordered = [...scaglioni].sort((a, b) => n2(a.ordine) - n2(b.ordine));

  for (const s of ordered) {
    if (remaining <= 0) break;

    const baseFrom = n2(s.mc_da_base);
    const baseTo = s.mc_a_base === null ? null : n2(s.mc_a_base);

    

    // annual span for this tier in base mc/year
    const spanBase = (baseTo === null) ? Infinity : Math.max(0, baseTo - baseFrom);

    // multiplier rule
    const multN = 3; //n2(s.moltiplica_per_nucleo) ? N : 1;

  //  console.log(`Scaglione ${s.ordine}: base [${baseFrom}, ${baseTo ?? "∞"}], moltiplica_per_nucleo=${s.moltiplica_per_nucleo}, prezzo_acquedotto=${s.prezzo_acquedotto}`);

    // prorated tier capacity
    const capacity =
      spanBase === Infinity
        ? Infinity
        : (spanBase * multN * A / yearDays) * days;

    const take = capacity === Infinity ? remaining : Math.min(remaining, capacity);

    const price = n2(s.prezzo_acquedotto);
    total += take * price;

    remaining -= take;
  }

  return round2(total);
}

/* ---------------- Load Tariffe for ABC ---------------- */
/**
 * For now we assume provider ABC has:
 * - categories: RESIDENTE / NON_RESIDENTE
 * - scaglioni per category
 * - componenti_mc: FOGNATURA, DEPURAZIONE per category
 * - quote_fisse: QF (annual amount) per category (or global)
 *
 * We'll read from your existing tariff tables:
 * - casa_idrica_tariffe (version)
 * - casa_idrica_tariff_categorie
 * - casa_idrica_tariff_scaglioni
 * - casa_idrica_tariff_componenti_mc
 * - casa_idrica_tariff_quote_fisse
 */
async function loadTariffeABC(conn, { anno, categoriaCodice, tfCode }) {
  // find latest tariff version for ABC that matches anno
  // If you already select version elsewhere, change this to use that id.
  const [verRows] = await conn.query(
    `
    SELECT t.*
    FROM casa_idrica_tariffe t
    JOIN casa_idrica p ON p.id = t.id_casa_idrica
    WHERE p.codice = 'ABC'
      AND t.anno = ?
    ORDER BY t.valid_from DESC
    LIMIT 1
    `,
    [anno]
  );
  if (verRows.length === 0) throw new Error(`No ABC tariff version for anno ${anno}`);
  const version = verRows[0];

  
  const [catRows] = await conn.query(
    `
    SELECT *
    FROM casa_idrica_tariff_categorie
    WHERE id_tariffa = ? AND codice = ?
    LIMIT 1
    `,
    [version.id, categoriaCodice]
  );
  if (catRows.length === 0) throw new Error(`No category ${categoriaCodice} for ABC anno ${anno}`);
  const categoria = catRows[0];

  const [scaglioni] = await conn.query(
    `
    SELECT *
    FROM casa_idrica_tariff_scaglioni
    WHERE id_categoria = ?
    ORDER BY ordine ASC
    `,
    [categoria.id]
  );

  const [comp] = await conn.query(
    `
    SELECT *
    FROM casa_idrica_tariff_componenti_mc
    WHERE id_categoria = ?
    `,
    [categoria.id]
  );

  const getComp = (code) => {
    const row = comp.find((x) => String(x.codice).toUpperCase() === code);
    return row ? n2(row.prezzo_mc) : 0;
  };

  const prezzoFognatura = getComp("FOGNATURA");
  const prezzoDepurazione = getComp("DEPURAZIONE");

  const [qfRows] = await conn.query(
    `
    SELECT *
    FROM casa_idrica_tariff_quote_fisse
    WHERE id_categoria = ? AND codice = 'QF'
    LIMIT 1
    `,
    [categoria.id]
  );

  // interpret QF importo as annual amount (legacy behavior)
  const qfAnnua = qfRows.length ? n2(qfRows[0].importo) : 0;

  return {
    tariffVersion: version,
    categoria,
    scaglioni,
    prezzoFognatura,
    prezzoDepurazione,
    qfAnnua,
  };
}

/* ---------------- Session Create/Load ---------------- */

exports.createOrLoadSession = async function ({
  idCondominio,
  idCasaIdrica,
  idPeriodoAttuale,
  idPeriodoPrecedente,
  giorniQF,
  giorniConsumi,
  giorniAcconto,
  varie = 0,
  dataFattura = null,
  dataCasaIdrica = null,
}) {
  assertUUID(idCondominio, "idCondominio");
  assertUUID(idPeriodoAttuale, "idPeriodoAttuale");
  assertUUID(idPeriodoPrecedente, "idPeriodoPrecedente");
  assertUUID(idCasaIdrica, "idCasaIdrica");


  const conn = await db.getConnection();
  try {
    // Load condominio snapshot values
    const [condRows] = await conn.query(
      `SELECT oneri, oneri_doppio FROM condomini_v2 WHERE id = ? LIMIT 1`,
      [idCondominio]
    );
    if (condRows.length === 0) throw new Error("Condominio not found");

    const oneriSnap = n2(condRows[0].oneri);
    const doppioSnap = n2(condRows[0].oneri_doppio);

    
    // Check existing session for (condominio + periodo attuale)
    const [existing] = await conn.query(
      `
      SELECT *
      FROM fatture_sessioni
      WHERE id_condominio = ?
        AND id_periodo_attuale = ?
      LIMIT 1
      `,
      [idCondominio, idPeriodoAttuale]
    );

    if (existing.length > 0) {
      return { session: existing[0] };
    }

    const id = uuid();

    await conn.query(
    `
    INSERT INTO fatture_sessioni
    (
        id,
        id_condominio,
        id_casa_idrica,
        id_periodo_attuale,
        id_periodo_precedente,
        giorni_qf,
        giorni_consumi,
        giorni_acconto,
        varie,
        stato, 
        oneri_snapshot,
        oneri_doppio_snapshot
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'BOZZA', ?, ?)
    `,
    [
        id,
        idCondominio,
        idCasaIdrica,
        idPeriodoAttuale,
        idPeriodoPrecedente,
        giorniQF,
        giorniConsumi,
        giorniAcconto || 0,
        varie || 0,
        oneriSnap,
        doppioSnap
    ]
    );

    const [sessionRows] = await conn.query(
      `SELECT * FROM fatture_sessioni WHERE id = ? LIMIT 1`,
      [id]
    );

    return { session: sessionRows[0] };
  } finally {
    conn.release();
  }
};

exports.getSessionDetail = async function ({ sessionId, condominioId }) {
  assertUUID(sessionId, "sessionId");
  assertUUID(condominioId, "condominioId");

  const conn = await db.getConnection();
  try {
    const [sRows] = await conn.query(
      `SELECT * FROM fatture_sessioni WHERE id = ? AND id_condominio = ? LIMIT 1`,
      [sessionId, condominioId  ]
    );
    if (sRows.length === 0) throw new Error("Session not found");
    const session = sRows[0];

    // Period sessions
    const [paRows] = await conn.query(
      `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
      [session.id_periodo_attuale]
    );
    const [ppRows] = await conn.query(
      `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
      [session.id_periodo_precedente]
    );

    const periodoAttuale = paRows[0] || null;
    const periodoPrecedente = ppRows[0] || null;

    // Utenze active during current period
    const y = Number(periodoAttuale?.period_year || new Date().getFullYear());
    const m = Number(periodoAttuale?.period_month || 1);

    // Month bounds in UTC
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

    const [utenze] = await conn.query(
      `
      SELECT *
      FROM utenze_v2
      WHERE condominio_id = ?
        AND stato = 'ATTIVA'
        AND (data_attivazione IS NULL OR data_attivazione <= ?)
        AND (data_chiusura IS NULL OR data_chiusura >= ?)
      ORDER BY id_user ASC
      `,
      [session.id_condominio, end, start]
    );

    // Load readings for both periods
    const utenzaIds = utenze.map((u) => u.id);
    let righeAtt = [];
    let righePrec = [];

    if (utenzaIds.length > 0) {
      const inList = utenzaIds.map(() => "?").join(",");

      const [ra] = await conn.query(
        `
        SELECT id_utenza, valore_lettura, stato_lettura
        FROM letture_righe
        WHERE id_sessione = ?
          AND id_utenza IN (${inList})
        `,
        [session.id_periodo_attuale, ...utenzaIds]
      );
      righeAtt = ra;

      const [rp] = await conn.query(
        `
        SELECT id_utenza, valore_lettura, stato_lettura
        FROM letture_righe
        WHERE id_sessione = ?
          AND id_utenza IN (${inList})
        `,
        [session.id_periodo_precedente, ...utenzaIds]
      );
      righePrec = rp;
    }


    const [righeRows] = await conn.query(
        `
        SELECT 
          fr.*,
          u.id_user,
          CONCAT(u.nome,' ',u.cognome) AS utente,
          u.doppio_contatore
        FROM fatture_righe fr
        JOIN utenze_v2 u ON u.id = fr.id_utenza
        WHERE fr.id_fattura = ?
        ORDER BY u.id_user ASC
        `,
        [sessionId]
    );

    const mapAtt = new Map(righeAtt.map((r) => [r.id_utenza, r]));
    const mapPrec = new Map(righePrec.map((r) => [r.id_utenza, r]));
    const mapRighe = new Map(righeRows.map((r) => [r.id_utenza, r]));

    const grid = utenze.map((u) => ({
      utenza: u,
      attuale: mapAtt.get(u.id) || null,
      precedente: mapPrec.get(u.id) || null,  
      riga: mapRighe.get(u.id) || null,
      
    }));

    // General meter (for display)
    const contGenAtt = periodoAttuale?.contatore_generale_valore ?? null;
    const contGenPrec = periodoPrecedente?.contatore_generale_valore ?? null;

    const dataOperatoreA = periodoAttuale?.dataOperatore ?? null;
    const dataCasaA = periodoAttuale?.dataCasaIdrica ?? null;

    const dataOperatoreP = periodoPrecedente?.dataOperatore ?? null;
    const dataCasaP = periodoPrecedente?.dataCasaIdrica ?? null;

    return {
      session,
      periodoAttuale,
      periodoPrecedente,
      contatoreGenerale: { attuale: contGenAtt, precedente: contGenPrec },
      grid,
    };
  } finally {
    conn.release();
  }
};

exports.updateSessionParams = async function ({
  sessionId,
  giorniQF,
  giorniConsumi,
  giorniAcconto,
  varie,
  dataFattura,
  dataCasaIdrica,
  giorniCasa
}) {
  assertUUID(sessionId, "sessionId");
 
  
  const conn = await db.getConnection();
  try {
    await conn.query(
      `
      UPDATE fatture_sessioni
      SET
        giorni_qf = COALESCE(?, giorni_qf),
        giorni_consumi = COALESCE(?, giorni_consumi),
        giorni_acconto = ?,
        varie = COALESCE(?, varie),
        data_fattura = ?,
        data_casa_idrica = ?,
        giorni_interni = ?
      WHERE id = ?
      `,
      [
        giorniQF === undefined ? null : Number(giorniQF),
        giorniConsumi === undefined ? null : Number(giorniConsumi),
        giorniAcconto === undefined ? null : (giorniAcconto === null ? null : Number(giorniAcconto)),
        varie === undefined ? null : round2(varie),
        dataFattura ?? null,
        dataCasaIdrica ?? null,
        giorniCasa !== undefined ? (giorniCasa === null ? null : Number(giorniCasa)) : null,
        sessionId,
      ]
    );

    const [rows] = await conn.query(`SELECT * FROM fatture_sessioni WHERE id = ? LIMIT 1`, [
      sessionId,
    ]);
    return { session: rows[0] };
  } finally {
    conn.release();
  }
};

/* ---------------- Calculation ---------------- */
function n2(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}
function round2(x) {
  return Math.round((n2(x) + Number.EPSILON) * 100) / 100;
}
function yearDaysCount(year) {
  const y = Number(year);
  const leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
  return leap ? 366 : 365;
}

/**
 * Legacy-style GENERAL meter pricing (ABC)
 * - con_agev cap: (20 * totNuc * num_nuae / yearDays) * giorniInterni
 * - base cap:     (50 * totNuc * num_nuae / yearDays) * giorniInterni
 * - fascia cap:   (30 * totNuc * num_nuae / yearDays) * giorniInterni
 * - prices: imposteG[0..4] (agev, base, fascia3, fascia4, fascia5)
 */

async function loadSessionForUpdate(conn, sessionId) {
  const [rows] = await conn.query(
    `SELECT * FROM fatture_sessioni WHERE id = ? FOR UPDATE`,
    [sessionId]
  );

  if (!rows.length) throw new Error("Session not found");

  if (rows[0].stato === "CONFERMATA") {
    throw new Error("Session is confirmed and cannot be recalculated");
  }

  return rows[0];
}
async function updateSessionTotals(conn, sessionId, generale, interni = null) {

  await conn.query(
    `
    UPDATE fatture_sessioni
    SET
      stato = 'BOZZA',
      tot_acquedotto = ?,
      tot_fognatura = ?,
      tot_depurazione = ?,
      tot_qf = ?,
      tot_iva = ?,
      grand_total = ?
    WHERE id = ?
    `,
    [
      generale.impCons,
      generale.fog,
      generale.dep,
      generale.qfTot,
      generale.iva,
      generale.grand,
      sessionId
    ]
  );
}
  
async function loadPeriodoData(conn, session) {

  const [paRows] = await conn.query(
    `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
    [session.id_periodo_attuale]
  );

  const [ppRows] = await conn.query(
    `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
    [session.id_periodo_precedente]
  );

  if (!paRows.length || !ppRows.length) {
    throw new Error("Periods not found");
  }

  const periodoAttuale = paRows[0];
  const periodoPrecedente = ppRows[0];

  const yearDays = yearDaysCount(Number(periodoAttuale.period_year));

  return {
    periodoAttuale,
    periodoPrecedente,
    yearDays
  };
}

function calcolaGeneraleLegacy({
  consumo,
  totNuc,
  numNuae,
  giorniInterni,
  yearDays,
  imposteG,
  prezzoFognatura,
  prezzoDepurazione,
  qfAnnua,
  giorniQF,
  varie,
  aliquotaIva = 0.10,
}) {
  const consumoP = Math.max(0, n2(consumo));
  const N = Math.max(0, n2(totNuc));
  const A = Math.max(1, n2(numNuae));
  const daysCons = Math.max(0, n2(giorniInterni));
  const daysQFv = Math.max(0, n2(giorniQF));
  const yd = Math.max(365, n2(yearDays));

  const p0 = n2(imposteG?.[0]);
  const p1 = n2(imposteG?.[1]);
  const p2 = n2(imposteG?.[2]);
  const p3 = n2(imposteG?.[3]);
  const p4 = n2(imposteG?.[4]);

  // capacities
  const con_agev = (20 * N * A / yd) * daysCons;
  const co_fbase = (50 * N * A / yd) * daysCons;
  const fascia   = (30 * N * A / yd) * daysCons;

  let remaining = consumoP;
  let impCons = 0;

  // Agevolata
  const takeAgev = Math.min(remaining, con_agev);
  impCons += takeAgev * p0;
  remaining -= takeAgev;

  // Base
  if (remaining > 0) {
    const takeBase = Math.min(remaining, co_fbase);
    impCons += takeBase * p1;
    remaining -= takeBase;
  }

  // Fasce successive: first fascia @p2, second @p3, third and beyond @p4
  let fasciaIndex = 0; // 0->p2, 1->p3, 2+->p4
  while (remaining > 0) {
    const cap = fascia > 0 ? fascia : remaining; // avoid infinite loop if fascia==0
    const take = Math.min(remaining, cap);

    const price =
      fasciaIndex === 0 ? p2 :
      fasciaIndex === 1 ? p3 :
      p4;

    impCons += take * price;

    remaining -= take;
    fasciaIndex += 1;

    if (fascia <= 0) break;
  }

  // Dep + Fog on total consumption
  const depFog = consumoP * (n2(prezzoDepurazione) + n2(prezzoFognatura));

  // QF generale
  const qfTot = (n2(qfAnnua) / yd) * A * daysQFv;
  const qfPerUtenza = qfTot / A;

  const varieTot = n2(varie);

  const baseIva = impCons + depFog + qfTot;
  const iva = baseIva * n2(aliquotaIva);

  const totale = baseIva + iva + varieTot;
 

  return {
    caps: {
      con_agev: round2(con_agev),
      co_fbase: round2(co_fbase),
      fascia: round2(fascia),
    },
    impCons: round2(impCons),
    depFog: round2(depFog),
    qfTot: round2(qfTot),
    qfPerUtenza: round2(qfPerUtenza),
    varie: round2(varieTot),
    iva: round2(iva),
    totale: round2(totale),
  };
}
async function loadFullSession(conn, sessionId, interniTotals = null) {

  const [sessionRows] = await conn.query(
    `SELECT * FROM fatture_sessioni WHERE id = ? LIMIT 1`,
    [sessionId]
  );

  if (!sessionRows.length) {
    throw new Error("Session not found after calculation");
  }

  const [righeRows] = await conn.query(
    `
    SELECT 
      fr.*,
      u.id_user,
      CONCAT(u.nome,' ',u.cognome) AS utente,
      u.doppio_contatore
    FROM fatture_righe fr
    JOIN utenze_v2 u ON u.id = fr.id_utenza
    WHERE fr.id_fattura = ?
    ORDER BY u.id_user ASC
    `,
    [sessionId]
  );

  return {
    session: sessionRows[0],
    righe: righeRows
  };
}
async function calculateGenerale(conn, sessionId) {
  assertUUID(sessionId, "sessionId");

   
  try {
    const [sRows] = await conn.query(
      `SELECT * FROM fatture_sessioni WHERE id = ? LIMIT 1`,
      [sessionId]
    );
    if (sRows.length === 0) throw new Error("Session not found");
    const session = sRows[0];

    // Period current
    const [paRows] = await conn.query(
      `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
      [session.id_periodo_attuale]
    );

    // Period previous  
    const [ppRows] = await conn.query(
      `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
      [session.id_periodo_precedente]
    );

    if (paRows.length === 0) throw new Error("Periodo attuale not found");
    const periodoAttuale = paRows[0];

    if (ppRows.length === 0) throw new Error("Periodo precedente not found");
    const periodoPrecedente = ppRows[0];

    const anno = Number(periodoAttuale.period_year);
    const yd = yearDaysCount(anno);

    // Active utenze in current period → totNuc = SUM(nucleo)
    const y = Number(periodoAttuale.period_year);
    const m = Number(periodoAttuale.period_month);
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

    const [utenze] = await conn.query(
      `
      SELECT nucleo
      FROM utenze_v2
      WHERE  condominio_id = ?
        AND stato = 'ATTIVA'
        AND (data_attivazione IS NULL OR data_attivazione <= ?)
        AND (data_chiusura IS NULL OR data_chiusura >= ?)
      `,
      [session.id_condominio, end, start]
    );

    const totNuc = 3; //utenze.reduce((sum, u) => sum + Math.max(1, n2(u.nucleo)), 0)/;

 
    let numNuae = 1;
    const [cRows] = await conn.query(
      `SELECT nuae FROM condomini_v2 WHERE id = ? LIMIT 1`,
      [session.id_condominio]
    );
    if (cRows.length > 0 && cRows[0].nuae != null) numNuae = Math.max(1, n2(cRows[0].nuae));

     
    // General consumption from "contatore generale"
    const consumoGenerale =
      (periodoAttuale.contatore_generale_valore != null && periodoPrecedente.contatore_generale_valore != null)
        ? n2(periodoAttuale.contatore_generale_valore) - n2(periodoPrecedente.contatore_generale_valore)
        : null;
 
    const valAtt = n2(periodoAttuale.contatore_generale_valore);
    const valPrec = n2(periodoPrecedente.contatore_generale_valore);

    const consumo = (session.contatore_generale_attuale != null && session.contatore_generale_precedente != null)
      ? Math.max(0, valAtt - valPrec)
      : (consumoGenerale == null ? 0 : Math.max(0, n2(consumoGenerale)));

    // Load tariffs (ABC) — map prices from scaglioni
    // You already have loadTariffeABC(conn, { anno, categoriaCodice })
    const tariff = await loadTariffeABC(conn, { anno, categoriaCodice: "RESIDENTE" });

    const ordered = [...(tariff.scaglioni || [])].sort((a, b) => n2(a.ordine) - n2(b.ordine));
    const imposteG = [
      n2(ordered[0]?.prezzo_acquedotto),
      n2(ordered[1]?.prezzo_acquedotto),
      n2(ordered[2]?.prezzo_acquedotto),
      n2(ordered[3]?.prezzo_acquedotto),
      n2(ordered[4]?.prezzo_acquedotto),
    ];

    const out = calcolaGeneraleLegacy({
      consumo,
      totNuc,
      numNuae,
      giorniInterni: session.giorni_consumi,
       
      yearDays: yd,
      imposteG,
      prezzoFognatura: tariff.prezzoFognatura,
      prezzoDepurazione: tariff.prezzoDepurazione,
      qfAnnua: tariff.qfAnnua,
      giorniQF: session.giorni_qf,
      varie: session.varie,
      aliquotaIva: 0.10,
    });

     
    return {
      meta: {
        anno,
        yearDays: yd,
        totNuc,
        numNuae,
        consumo,
        imposteG,
      },
      generale: out,
    };
  } finally {
    conn.release();
  }
};


 function internoBase(x) {
  const s = String(x ?? "").trim();
  // "1A" -> "1", "12B" -> "12", "7" -> "7"
  const m = s.match(/^(\d+)/);
  return m ? m[1] : s; // fallback
}
async function calculateInterni(conn, session, generale, tfCode) {
  // ---------- helpers ----------
  const pick = (obj, ...keys) => {
    for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null) return obj[k];
    return undefined;
  };
  const upper = (v, fallback = "") => String(v ?? fallback).toUpperCase();
  const isSpecial = (u) => upper(pick(u, "tipo", "Tipo"), "") === "SPECIAL";

  const internoBase = (x) => {
    const s = String(x ?? "").trim();
    const m = s.match(/^(\d+)/);
    return m ? m[1] : s;
  };

  const isPureNumericInterno = (x) => /^\d+$/.test(String(x ?? "").trim());

  // ---------- Load periods ----------
  const [[periodoAttuale]] = await conn.query(
    `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
    [session.id_periodo_attuale]
  );
  const [[periodoPrecedente]] = await conn.query(
    `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
    [session.id_periodo_precedente]
  );
  if (!periodoAttuale || !periodoPrecedente) throw new Error("Periods not found");

  const anno = Number(periodoAttuale.period_year);
  const yearDays = yearDaysCount(anno);

  const y = Number(periodoAttuale.period_year);
  const m = Number(periodoAttuale.period_month);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  // ---------- Active utenze ----------
  // Alias casing issues once and for all
  const [utenzeRaw] = await conn.query(
    `
    SELECT
      u.*,
      u.Doppio_Contatore AS doppio_contatore,
       
      u.Nucleo AS nucleo,
       
      u.Tipo AS tipo,
      u.Isolato AS Isolato,
      u.Scala AS Scala,
      u.Interno AS Interno
    FROM utenze_v2 u
    WHERE u.condominio_id = ?
      AND u.stato = 'ATTIVA'
      AND (u.data_attivazione IS NULL OR u.data_attivazione <= ?)
      AND (u.data_chiusura IS NULL OR u.data_chiusura >= ?)
    ORDER BY u.id ASC
    `,
    [session.id_condominio, end, start]
  );
  if (!utenzeRaw.length) throw new Error("No active utenze");

  const utenze = utenzeRaw.map((u) => ({
    ...u,
    Isolato: pick(u, "Isolato", "isolato") ?? "",
    Scala: pick(u, "Scala", "scala") ?? "",
    Interno: pick(u, "Interno", "interno") ?? "",
    tipo: pick(u, "tipo", "Tipo") ?? "",
    nucleo: pick(u, "nucleo", "Nucleo") ?? 1,
    nuae: pick(u, "nuae", "Nuae") ?? 1,
  }));

  // ---------- Load readings ----------
  const ids = utenze.map((u) => u.id);
  const inList = ids.map(() => "?").join(",");

  const [righeAtt] = await conn.query(
    `
    SELECT id_utenza, valore_lettura, stato_lettura
    FROM letture_righe
    WHERE id_sessione = ?
      AND id_utenza IN (${inList})
    `,
    [session.id_periodo_attuale, ...ids]
  );

  const [righePrec] = await conn.query(
    `
    SELECT id_utenza, valore_lettura, stato_lettura
    FROM letture_righe
    WHERE id_sessione = ?
      AND id_utenza IN (${inList})
    `,
    [session.id_periodo_precedente, ...ids]
  );

  const mapAtt = new Map(righeAtt.map((r) => [r.id_utenza, r]));
  const mapPrec = new Map(righePrec.map((r) => [r.id_utenza, r]));

  // ---------- Condo NUAEs for QF distribution ----------
  const [[condo]] = await conn.query(
    `SELECT nuae FROM condomini_v2 WHERE id = ? LIMIT 1`,
    [session.id_condominio]
  );
  const totNuae = condo?.nuae != null ? Math.max(1, n2(condo.nuae)) : 1;
  const qfPerNuae = totNuae > 0 ? n2(generale.qfTot) / totNuae : 0;

  // ---------- Clear snapshot ----------
  await conn.query(`DELETE FROM fatture_righe WHERE id_fattura = ?`, [session.id]);

  // ---------- Params ----------
  const giorniCons = Math.max(0, n2(session.giorni_consumi));
  const giorniAcc = session.giorni_acconto ? Math.max(0, n2(session.giorni_acconto)) : 0;

  // ---------- Group by UNIT (isolato|scala|internoBase) ----------
  const byUnit = new Map();

  for (const u of utenze) {
    const isDoppio = String(u.Doppio_Contatore).toUpperCase() === "SI";

    // If not doppio → always standalone
    if (!isDoppio) {
      byUnit.set(`__single_${u.id}`, [u]);
      continue;
    }

    const groupKey = u.billing_group_id;

    // If doppio but no billing group → standalone (data inconsistency protection)
    if (!groupKey) {
      byUnit.set(`__single_${u.id}`, [u]);
      continue;
    }

    if (!byUnit.has(groupKey)) {
      byUnit.set(groupKey, []);
    }

    byUnit.get(groupKey).push(u);
  }

  for (const [key, units] of Array.from(byUnit.entries())) {
    if (!key.startsWith("__single_") && units.length <= 1) {
      // Collapse invalid doppio group into standalone
      const u = units[0];
      byUnit.delete(key);
      byUnit.set(`__single_${u.id}`, [u]);
    }
  }

  // Stable ordering: by numeric group_id if possible
  const unitKeys = Array.from(byUnit.keys()).sort((a, b) => {
    const groupA = byUnit.get(a) || [];
    const groupB = byUnit.get(b) || [];

    const firstA = groupA[0];
    const firstB = groupB[0];

    const internoA = String(firstA?.Interno ?? "");
    const internoB = String(firstB?.Interno ?? "");

    const numA = Number(internoA);
    const numB = Number(internoB);

    if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
      return numA - numB;
    }

    return internoA.localeCompare(internoB);
  });

  const rows = [];
  let totaleOneri = 0;

  for (const key of unitKeys) {
    const group = byUnit.get(key);

    // Choose primary: the "pure numeric" interno (e.g., "5") before "5A"
    group.sort((a, b) => {
      const ai = String(a.Interno ?? "");
      const bi = String(b.Interno ?? "");
      const ap = isPureNumericInterno(ai);
      const bp = isPureNumericInterno(bi);
      if (ap !== bp) return ap ? -1 : 1;
      return ai.localeCompare(bi);
    });

    const first = group[0];
    const isMulti = group.length > 1;

    // Sum readings across group
    let sumAtt = 0;
    let sumPrec = 0;
    let haveAny = false;

    // keep "state" from primary meter (legacy behavior)
    const ra0 = mapAtt.get(first.id);
    const rp0 = mapPrec.get(first.id);
    const statoAtt = ra0?.stato_lettura ?? null;
    const statoPrec = rp0?.stato_lettura ?? null;

    for (const gx of group) {
      const ra = mapAtt.get(gx.id);
      const rp = mapPrec.get(gx.id);
      const a = ra?.valore_lettura ?? null;
      const p = rp?.valore_lettura ?? null;

      if (a !== null && p !== null) {
        haveAny = true;
        sumAtt += n2(a);
        sumPrec += n2(p);
      }
    }

    const lettAtt = haveAny ? sumAtt : (ra0?.valore_lettura ?? null);
    const lettPrec = haveAny ? sumPrec : (rp0?.valore_lettura ?? null);

    let consumoNorm = null;
    if (lettAtt !== null && lettPrec !== null) {
      const d = n2(lettAtt) - n2(lettPrec);
      if (d < 0) throw new Error(`Negative consumption for unit ${key} (interno ${first.Interno})`);
      consumoNorm = d;
    }

    const consumoAcc =
      consumoNorm === null || giorniCons === 0 || giorniAcc === 0
        ? 0
        : (consumoNorm / giorniCons) * giorniAcc;

    const consumoTot = consumoNorm === null ? null : consumoNorm + consumoAcc;

    const categoriaCodice = upper(first.categoria_tariffa, "RESIDENTE");
    const tariff = await loadTariffeABC(conn, { anno, categoriaCodice, tfCode });

    const nucleo = Math.max(1, n2(first.nucleo));
    const nuaeU = Math.max(1, n2(first.nuae));

    let impAcq = 0;
    if (consumoNorm !== null) {
      const impNorm = allocateAcquedotto({
        consumo: consumoNorm,
        scaglioni: tariff.scaglioni,
        nucleo,
        nuae: nuaeU,
        giorniRef: giorniCons,
        yearDays,
      });

      const impAcc =
        giorniAcc > 0
          ? allocateAcquedotto({
              consumo: consumoAcc,
              scaglioni: tariff.scaglioni,
              nucleo,
              nuae: nuaeU,
              giorniRef: giorniAcc,
              yearDays,
            })
          : 0;

      impAcq = round2(impNorm + impAcc);
    }

    const impFog = consumoTot === null ? 0 : round2(consumoTot * n2(tariff.prezzoFognatura));
    const impDep = consumoTot === null ? 0 : round2(consumoTot * n2(tariff.prezzoDepurazione));
    const impQf = round2(qfPerNuae * nuaeU);

    // ONERI: if unit has multiple meters -> doppio contatore snapshot, else normal snapshot
    console.log(session);
    const impOneri = isMulti
      ? round2(n2(session.oneri_doppio_snapshot))
      : round2(n2(session.oneri_snapshot));

    totaleOneri += impOneri;

    // IVA 10% only on (Acq + Fog + Dep + QF) like your original
    const baseIva = round2(impAcq + impFog + impDep + impQf);
    const impIva = round2(baseIva * 0.10);

    const baseTot = round2(impAcq + impFog + impDep + impQf + impOneri + impIva);

    rows.push({
      id_utenza: first.id,
      id_user: first.id_user,
      lettura_precedente: rp0?.valore_lettura,
      stato_precedente: statoPrec,
      lettura_attuale: ra0?.valore_lettura,
      stato_attuale: statoAtt,
      consumo_normale: consumoNorm,
      consumo_acconto: consumoNorm === null ? null : consumoAcc,
      consumo_totale: consumoNorm === null ? null : consumoTot,
      imp_acquedotto: impAcq,
      imp_fognatura: impFog,
      imp_depurazione: impDep,
      imp_qf: impQf,
      imp_oneri: impOneri,
      imp_iva: impIva,
      base_totale: baseTot,
      conguaglio: 0,
      imp_arr: 0,
      totale: baseTot,
      tfEligible: !isSpecial(first) && consumoTot !== null && n2(consumoTot) > 0,
      _unitKey: key,
      _isPrimary: true,
    });

    // Secondary meters show as zero rows (legacy “all zero” line)
    if (isMulti) {
      for (let k = 1; k < group.length; k++) {
        const gk = group[k];
        const rak = mapAtt.get(gk.id);
        const rpk = mapPrec.get(gk.id);

        rows.push({
          id_utenza: gk.id,
          id_user: gk.id_user,
          lettura_precedente: rpk?.valore_lettura ?? null,
          stato_precedente: rpk?.stato_lettura ?? null,
          lettura_attuale: rak?.valore_lettura ?? null,
          stato_attuale: rak?.stato_lettura ?? null,
          consumo_normale: 0,
          consumo_acconto: 0,
          consumo_totale: 0,
          imp_acquedotto: 0,
          imp_fognatura: 0,
          imp_depurazione: 0,
          imp_qf: 0,
          imp_oneri: 0,
          imp_iva: 0,
          base_totale: 0,
          conguaglio: 0,
          imp_arr: 0,
          totale: 0,
          tfEligible: false,
          _unitKey: key,
          _isPrimary: false,
        });
      }
    }
  }

  generale.totaleOneri = round2(totaleOneri);

  // TF base (TF applied on TF1 base, not stacked)
  const baseSum = round2(rows.reduce((s, r) => s + n2(r.base_totale), 0));
  const diff = round2(n2(generale.totale + totaleOneri) - baseSum);

  applyTfToRows({ tfCode, diff, rows });

  // Apply conguaglio + rounding adjustment (arr)
  for (const r of rows) {
    const beforeRound = round2(n2(r.base_totale) + n2(r.conguaglio));
    const rounded = roundToNearestTenth(beforeRound);
    const arr = round2(rounded - beforeRound);
    r.imp_arr = arr;
    r.totale = round2(beforeRound + arr);
  }

  // Persist
  for (const r of rows) {
    await conn.query(
      `
      INSERT INTO fatture_righe
      (id, id_fattura, id_utenza,
       lettura_precedente, stato_precedente,
       lettura_attuale, stato_attuale,
       consumo_normale, consumo_acconto, consumo_totale,
       imp_acquedotto, imp_fognatura, imp_depurazione,
       imp_qf, imp_oneri, imp_iva,
       conguaglio, imp_arr,
       totale)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        uuid(),
        session.id,
        r.id_utenza,
        r.lettura_precedente,
        r.stato_precedente,
        r.lettura_attuale,
        r.stato_attuale,
        r.consumo_normale,
        r.consumo_acconto,
        r.consumo_totale,
        r.imp_acquedotto,
        r.imp_fognatura,
        r.imp_depurazione,
        r.imp_qf,
        r.imp_oneri,
        r.imp_iva,
        r.conguaglio,
        r.imp_arr,
        r.totale,
      ]
    );
  }

  // Totals
  const totAcq = round2(rows.reduce((s, r) => s + n2(r.imp_acquedotto), 0));
  const totFog = round2(rows.reduce((s, r) => s + n2(r.imp_fognatura), 0));
  const totDep = round2(rows.reduce((s, r) => s + n2(r.imp_depurazione), 0));
  const totQf = round2(rows.reduce((s, r) => s + n2(r.imp_qf), 0));
  const totOneri = round2(rows.reduce((s, r) => s + n2(r.imp_oneri), 0));
  const totIva = round2(rows.reduce((s, r) => s + n2(r.imp_iva), 0));
  const sumUtenti = round2(rows.reduce((s, r) => s + n2(r.totale), 0));
  const totConguaglio = round2(rows.reduce((s, r) => s + n2(r.conguaglio), 0));
  const totArr = round2(rows.reduce((s, r) => s + n2(r.imp_arr), 0));

  return {
    totAcq,
    totFog,
    totDep,
    totQf,
    totOneri,
    totIva,
    sumUtenti,
    totConguaglio,
    totArr,
    baseSum,
    diffApplied: diff,
    tfCode: upper(tfCode, "TF1"),
  };
}



exports.calculateSession = async function ({ sessionId, tfCode }) {

  assertUUID(sessionId, "sessionId");

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [sRows] = await conn.query(
      `SELECT * FROM fatture_sessioni WHERE id = ? FOR UPDATE`,
      [sessionId]
    );
    if (!sRows.length) throw new Error("Session not found");
    const session = sRows[0];

    if (session.stato === "CONFERMATA") {
      throw new Error("Session is confirmed and cannot be recalculated");
    }

    const generaleResult = await calculateGenerale(conn, sessionId);
    /*
      caps: {
        con_agev: round2(con_agev),
        co_fbase: round2(co_fbase),
        fascia: round2(fascia),
      },
      impCons: round2(impCons),
      depFog: round2(depFog),
      qfTot: round2(qfTot),
      qfPerUtenza: round2(qfPerUtenza),
      varie: round2(varieTot),
      iva: round2(iva),
      totale: round2(totale),
    
    */ 
    const g = generaleResult.generale;
    const interniTotals = await calculateInterni(conn, session, g, tfCode);

    console.log("Generale:", g);
    // console.log("Interni Totals:", interniTotals);  
    await conn.query(
      `
      UPDATE fatture_sessioni
      SET
        stato = 'CALCOLATA',
        tot_acquedotto = ?,
        tot_fognatura = ?,
        tot_depurazione = ?,
        tot_qf = ?,
        tot_iva = ?,
        tot_oneri = ?,
        grand_total = ?
      WHERE id = ?
      `,
      [
        g.impCons,
        g.depFog,
        0,
        g.qfTot,
        g.iva,
        0,
        g.totale,
        sessionId,
      ]
    );

    await conn.commit();

    return await loadFullSession(conn, sessionId, interniTotals);

  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) conn.release();
  }
};


exports.getByCondominio = async function ({ condominioId }) {
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query(
      `
      SELECT *
      FROM fatture_sessioni
      WHERE id_condominio = ?
      ORDER BY created_at DESC
      `,
      [condominioId]
    );

    return rows;
  } finally {
    conn.release();
  }
};
exports.getAvailablePeriods = async function ({ condominioId }) {
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query(
      `
      SELECT id, period_year, period_month
      FROM letture_sessioni
      WHERE id_condominio = ?
      ORDER BY period_year DESC, period_month DESC
      `,
      [condominioId]
    );

    return rows;
  } finally {
    conn.release();
  }
};
exports.getProviders = async function () {
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT id, nome, codice FROM casa_idrica ORDER BY nome`
    );
    return rows;
  } finally {
    conn.release();
  }
};
exports.updateContatoreGenerale = async function ({
  sessionId,
  precedente,
  attuale,
}) {
  assertUUID(sessionId, "sessionId");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [sRows] = await conn.query(
      `SELECT * FROM fatture_sessioni WHERE id = ? FOR UPDATE`,
      [sessionId]
    );

    if (sRows.length === 0) throw new Error("Session not found");

    const session = sRows[0];

    if (session.stato === "CONFERMATA") {
      throw new Error("Session confirmed, cannot modify readings");
    }

    if (precedente != null) {
      await conn.query(
        `UPDATE letture_sessioni
         SET contatore_generale_valore = ?
         WHERE id = ?`,
        [Number(precedente), session.id_periodo_precedente]
      );
    }

    if (attuale != null) {
      await conn.query(
        `UPDATE letture_sessioni
         SET contatore_generale_valore = ?
         WHERE id = ?`,
        [Number(attuale), session.id_periodo_attuale]
      );
    }

    await conn.commit();

    return { success: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};
exports.deleteSession = async function ({ sessionId }) {
  assertUUID(sessionId, "sessionId");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT stato FROM fatture_sessioni WHERE id = ? FOR UPDATE`,
      [sessionId]
    );

    if (rows.length === 0) throw new Error("Session not found");

    if (rows[0].stato !== "BOZZA") {
      throw new Error("Only BOZZA sessions can be deleted");
    }

    await conn.query(
      `DELETE FROM fatture_righe WHERE id_fattura = ?`,
      [sessionId]
    );

    await conn.query(
      `DELETE FROM fatture_sessioni WHERE id = ?`,
      [sessionId]
    );

    await conn.commit();

    return { success: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

function applyTfToRows({ tfCode, diff, rows }) {
  const code = String(tfCode || "TF1").toUpperCase();
  const delta = round2(n2(diff));
  if (!delta) return;

  const eligible = rows.filter(r =>
    r.tfEligible && n2(r.consumo_totale) > 0
  );

  if (!eligible.length) return;

  // TF1 = no redistribution
  if (code === "TF1" || code === "NONE") return;

  // ============================
  // TF2N = EQUAL DISTRIBUTION
  // ============================
  if (code === "TF2" || code === "TF2N" || code === "EQUAL") {
    const each = delta / eligible.length;
    let applied = 0;

    for (let i = 0; i < eligible.length; i++) {
      const share =
        i === eligible.length - 1
          ? round2(delta - applied)
          : round2(each);

      eligible[i].conguaglio = share;
      applied = round2(applied + share);
    }

    return;
  }

  // ============================
  // TF3N = PROPORTIONAL
  // ============================
  if (code === "TF3" || code === "TF3N" || code === "PROP") {
    const sumCons = eligible.reduce(
      (s, r) => s + n2(r.consumo_totale),
      0
    );

    if (sumCons <= 0) return;

    let applied = 0;

    for (let i = 0; i < eligible.length; i++) {
      const raw = (delta * n2(eligible[i].consumo_totale)) / sumCons;

      const share =
        i === eligible.length - 1
          ? round2(delta - applied)
          : round2(raw);

      eligible[i].conguaglio = share;
      applied = round2(applied + share);
    }

    return;
  }
}

function roundToNearestTenth(amount) {
  // Legacy behavior: round to nearest 0.10 (keep 2 decimals, second cent digit becomes 0)
  return Math.round(n2(amount) * 10) / 10;
}