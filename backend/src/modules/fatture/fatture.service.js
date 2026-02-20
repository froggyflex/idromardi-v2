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
async function loadTariffeABC(conn, { anno, categoriaCodice }) {
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
    const doppioSnap = n2(condRows[0].doppio_contatore);

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
 
  //console.log(`giorniAcconto=${giorniAcconto}, varie=${varie}, dataFattura=${dataFattura}, dataCasaIdrica=${dataCasaIdrica}, giorniCasaIdrica=${giorniCasa}`);
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
 
async function calculateInterni(conn, session, generale) {

  // --- Load periods ---
  const [[periodoAttuale]] = await conn.query(
    `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
    [session.id_periodo_attuale]
  );

  const [[periodoPrecedente]] = await conn.query(
    `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
    [session.id_periodo_precedente]
  );

  if (!periodoAttuale || !periodoPrecedente) {
    throw new Error("Periods not found");
  }

  const anno = Number(periodoAttuale.period_year);
  const yearDays = yearDaysCount(anno);

  // --- Active utenze ---
  const y = Number(periodoAttuale.period_year);
  const m = Number(periodoAttuale.period_month);

  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const end   = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

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



  if (!utenze.length) {
    throw new Error("No active utenze");
  }

  // --- Load readings ---
  const ids = utenze.map(u => u.id);
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

  
  const [nuae] = await conn.query(
    `
    SELECT nuae
    FROM condomini_v2
    WHERE id = ?
       
    `,
    [session.id_condominio]
  );

  const mapAtt  = new Map(righeAtt.map(r => [r.id_utenza, r]));
  const mapPrec = new Map(righePrec.map(r => [r.id_utenza, r]));

  // --- Clear snapshot ---
  await conn.query(
    `DELETE FROM fatture_righe WHERE id_fattura = ?`,
    [session.id]
  );

  // --- QF distribution ---
  const totNuae = nuae[0] && nuae[0].nuae != null ? Math.max(1, n2(nuae[0].nuae)) : 1;
  const qfPerNuae = totNuae > 0 ? generale.qfTot / totNuae : 0;

  let totAcq = 0;
  let totFog = 0;
  let totDep = 0;
  let totOneri = 0;
  let totIva = 0;
  let sumUtenti = 0;

  const processed = new Set();

  for (let i = 0; i < utenze.length; i++) {

    const u = utenze[i];
    if (processed.has(u.id)) continue;

    const ra = mapAtt.get(u.id);
    const rp = mapPrec.get(u.id);

    const lettAtt = ra?.valore_lettura ?? 0;
    const lettPrec = rp?.valore_lettura ?? 0;

    let totAtt = n2(lettAtt);
    let totPrec = n2(lettPrec);

    const isDouble = String(u.doppio_contatore || "NO").toUpperCase() === "SI";

    let mergedCount = 1;

    // ------------------------------------------------
    // DOUBLE CONTATORE LOGIC
    // ------------------------------------------------
    if (isDouble) {

      for (let j = i + 1; j < utenze.length; j++) {

        const u2 = utenze[j];

        if (
          String(u2.doppio_contatore || "NO").toUpperCase() === "SI" &&
          u2.nome === u.nome &&
          u2.cognome === u.cognome
        ) {

          const ra2 = mapAtt.get(u2.id);
          const rp2 = mapPrec.get(u2.id);

          totAtt += n2(ra2?.valore_lettura ?? 0);
          totPrec += n2(rp2?.valore_lettura ?? 0);

          processed.add(u2.id);
          mergedCount++;
        }
      }
    }

    const consumoNorm = Math.max(0, totAtt - totPrec);

    const giorniCons = Math.max(0, n2(session.giorni_consumi));
    const giorniAcc  = Math.max(0, n2(session.giorni_acconto || 0));

    const consumoAcc =
      consumoNorm && giorniCons && giorniAcc
        ? (consumoNorm / giorniCons) * giorniAcc
        : 0;

    const consumoTot = consumoNorm + consumoAcc;

    const tariff = await loadTariffeABC(conn, {
      anno,
      categoriaCodice: String(u.categoria_tariffa || "RESIDENTE").toUpperCase()
    });

    const nucleo = Math.max(1, n2(u.nucleo));
    const nuae   = Math.max(1, n2(u.nuae));

    const impAcq = round2(
      allocateAcquedotto({
        consumo: consumoNorm,
        scaglioni: tariff.scaglioni,
        nucleo,
        nuae,
        giorniRef: session.giorni_interni,
        yearDays
      })
    );

    const impFog = round2(consumoTot * n2(tariff.prezzoFognatura));
    const impDep = round2(consumoTot * n2(tariff.prezzoDepurazione));
    const impQf  = round2(qfPerNuae * nuae);

    const impOneri =
      isDouble
        ? round2(n2(session.doppio_contatore_snapshot))
        : round2(n2(session.oneri_snapshot));

    const baseIva = impAcq + impFog + impDep + impQf;
    const impIva  = round2(baseIva * 0.10);    

    const totale = round2(
      impAcq + impFog + impDep + impQf + impOneri + impIva
    );

    totAcq += impAcq;
    totFog += impFog;
    totDep += impDep;
    totOneri += impOneri;
    totIva += impIva;
    sumUtenti += totale;

    await conn.query(
      `
      INSERT INTO fatture_righe
      (id, id_fattura, id_utenza,
       lettura_precedente, lettura_attuale,
       consumo_normale, consumo_acconto, consumo_totale,
       imp_acquedotto, imp_fognatura, imp_depurazione,
       imp_qf, imp_iva, imp_oneri, totale)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        uuid(),
        session.id,
        u.id,
        totPrec,
        totAtt,
        consumoNorm,
        consumoAcc,
        consumoTot,
        impAcq,
        impFog,
        impDep,
        impQf,
        impIva,
        impOneri,
        totale
      ]
    );

    processed.add(u.id);
  }

  return {
    totAcq,
    totFog,
    totDep,
    totOneri,
    totIva,
    sumUtenti
  };
}




exports.calculateSession = async function ({ sessionId }) {

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
    const interniTotals = await calculateInterni(conn, session, g);

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
