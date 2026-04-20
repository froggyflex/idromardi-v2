const db = require("../../config/db");
const { v4: uuid } = require("uuid");
const axios = require("axios");
const FormData = require("form-data");
/* ---------------- Helpers ---------------- */
const path = require("path");
const e = require("express");
const fs = require("fs").promises;
const fs1 = require("fs");
const puppeteer = require("puppeteer");
const { buildRipartizionePdfHtml } = require("./fatture.pdf");
 
// const db = require(... your existing db helper ...)


async function buildParsedInvoiceFromFile({ fileBuffer, input, mimeType }) {
 return {
    anagrafica: {
      codice_cliente: fileBuffer?.anagrafica?.codice_cliente ?? null,
      indirizzo_fornitura: fileBuffer?.anagrafica?.indirizzo_fornitura ?? null,
      intestatario: fileBuffer?.anagrafica?.intestatario ?? null,
      matricola_contatore: fileBuffer?.anagrafica?.matricola_contatore ?? null,
    },
    bill_type: fileBuffer?.bill_type ?? "unknown",
    codice_fornitura: fileBuffer?.codice_fornitura ?? null,
    componente_tariffa_acquedotto: Array.isArray(fileBuffer?.componente_tariffa_acquedotto)
      ? fileBuffer.componente_tariffa_acquedotto
      : [],
    consumo_globale_mc:
      fileBuffer?.consumo_globale_mc != null ? Number(fileBuffer.consumo_globale_mc) : null,
    fornitore_servizi: fileBuffer?.fornitore_servizi ?? null,
    importo_totale_da_pagare:
      fileBuffer?.importo_totale_da_pagare != null ? Number(fileBuffer.importo_totale_da_pagare) : null,
    letture: Array.isArray(fileBuffer?.letture) ? fileBuffer.letture : [],
    numero_bolletta: fileBuffer?.numero_bolletta ?? null,
    periodi_fatturazione: Array.isArray(fileBuffer?.periodi_fatturazione)
      ? fileBuffer.periodi_fatturazione
      : [],
    punto_erogazione: fileBuffer?.punto_erogazione ?? null,
    componente_quota_tariffa_acqua: Array.isArray(fileBuffer?.componente_quota_tariffa_acqua)? 
    fileBuffer.componente_quota_tariffa_acqua : [],
  };
}

function buildParsedInvoiceValidation(parsedPayload) {
  const warnings = [];
  const errors = [];

  if (!parsedPayload?.numero_bolletta) {
    warnings.push("Numero bolletta non trovato");
  }

  if (!parsedPayload?.codice_fornitura) {
    warnings.push("Codice fornitura non trovato");
  }

  if (parsedPayload?.importo_totale_da_pagare == null) {
    warnings.push("Importo totale da pagare non trovato");
  }

  if (!parsedPayload?.periodi_fatturazione?.length) {
    warnings.push("Nessun periodo di fatturazione trovato");
  }

  return {
    is_valid: errors.length === 0,
    warnings,
    errors,
  };
}

function toMysqlDate(value) {
  if (!value) return null;

  const parts = String(value).split("/");
  if (parts.length !== 3) return null;

  const [dd, mm, yyyy] = parts;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function summarizeTariffeAcquedotto(rows) {
  const summary = {
    importoPos: 0,
    importoNeg: 0,
    quantitaPos: 0,
    quantitaNeg: 0
  };

  for (const r of rows) {
    if (r.importo >= 0) {
      summary.importoPos += r.importo;
      summary.quantitaPos += r.quantita;
    } else {
      summary.importoNeg += r.importo;
      summary.quantitaNeg += r.quantita;
    }
  }

  return summary;
}
 
function summarizeImporto(rows) {
   
  let summary = 0;
  rows.map((r) => (

    summary = summary + r.importo

  ));

   
  return summary;
}

function deriveLettureSummary(letture = []) {
  const items = Array.isArray(letture) ? letture : [];

  if (!items.length) {
    return {
      valore_precedente: null,
      data_precedente: null,
      valore_attuale: null,
      data_attuale: null,
      tipo_lettura_attuale: null,
      ha_acconto: false,
      valore_acconto: null,
      data_acconto: null,
      consumo_acconto: null,
      tipo_lettura_acconto: null,
    };
  }

  // sort by date ascending just in case
  const sorted = [...items].sort((a, b) => {
    const da = toSortableDate(a?.data_lettura);
    const db = toSortableDate(b?.data_lettura);
    return da.localeCompare(db);
  });

  const previous = sorted[0] || null;

  // real/non-estimated readings
  const realReadings = sorted.filter(
    (r) => (r?.tipo_lettura || "").toLowerCase() !== "media"
  );

  // estimated/acconto readings
  const estimatedReadings = sorted.filter(
    (r) => (r?.tipo_lettura || "").toLowerCase() === "media"
  );

  // previous = first reading
  // current actual = last non-media reading, if there is one after previous
  const actualCurrent =
    realReadings.length > 1
      ? realReadings[realReadings.length - 1]
      : realReadings.length === 1
      ? realReadings[0]
      : null;

  const acconto =
    estimatedReadings.length > 0
      ? estimatedReadings[estimatedReadings.length - 1]
      : null;

  return {
    valore_precedente: previous?.lettura_mc ?? null,
    data_precedente: previous?.data_lettura ?? null,

    valore_attuale: actualCurrent?.lettura_mc ?? null,
    data_attuale: actualCurrent?.data_lettura ?? null,
    tipo_lettura_attuale: actualCurrent?.tipo_lettura ?? null,

    ha_acconto: !!acconto,
    valore_acconto: acconto?.lettura_mc ?? null,
    data_acconto: acconto?.data_lettura ?? null,
    consumo_acconto: acconto?.consumo_mc ?? null,
    tipo_lettura_acconto: acconto?.tipo_lettura ?? null,
  };
}

function toSortableDate(value) {
  if (!value) return "0000-00-00";
  const parts = String(value).split("/");
  if (parts.length !== 3) return "0000-00-00";
  const [dd, mm, yyyy] = parts;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function groupLettureByTipo(letture = []) {
  const items = Array.isArray(letture) ? letture : [];

  const grouped = items.reduce((acc, item) => {
    const tipo = String(item?.tipo_lettura || "unknown").toLowerCase();
    if (!acc[tipo]) acc[tipo] = [];
    acc[tipo].push(item);
    return acc;
  }, {});

  const result = {};

  for (const [tipo, rows] of Object.entries(grouped)) {
    const sorted = [...rows].sort((a, b) =>
      toSortableDate(a?.data_lettura).localeCompare(toSortableDate(b?.data_lettura))
    );

    result[tipo] = {
      tipo_lettura: tipo,
      count: sorted.length,
      oldest: sorted[0] || null,
      newest: sorted[sorted.length - 1] || null,
      items: sorted,
    };
  }

  return result;
}

function deriveValoriFromLetture(letture = []) {
  const grouped = groupLettureByTipo(letture);

  const aGiro = grouped["a_giro"] || null;
  const media = grouped["media"] || null;

  return {
    per_tipo: grouped,

    valore_precedente: aGiro?.oldest?.lettura_mc ?? null,
    data_precedente: aGiro?.oldest?.data_lettura ?? null,

    valore_attuale: aGiro?.newest?.lettura_mc ?? null,
    data_attuale: aGiro?.newest?.data_lettura ?? null,

    ha_acconto: !!media,
    valore_acconto: media?.newest?.lettura_mc ?? null,
    data_acconto: media?.newest?.data_lettura ?? null,
    consumo_acconto: media?.newest?.consumo_mc ?? null,
  };
}


exports.exportRipartizionePdf = async ({
  righe,
  dettaglioByUtenza,
  trimestreLabel,
  dataLettura,
  logoUrl,
}) => {

  if (!Array.isArray(righe) || righe.length === 0) {
    const err = new Error("Nessuna riga disponibile per generare il PDF");
    err.statusCode = 400;
    throw err;
  }


  const html = buildRipartizionePdfHtml({
    righe,
    dettaglioByUtenza,
    trimestreLabel: trimestreLabel || "",
    dataLettura: dataLettura || "",
    logoUrl: logoUrl || "",
  });

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: "networkidle0",
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: {
        top: "8mm",
        right: "8mm",
        bottom: "8mm",
        left: "8mm",
      },
    });

    return pdfBuffer;
  } catch (error) {
    console.error("exportRipartizionePdf error:", error);
    const err = new Error("Errore durante la generazione del PDF");
    err.statusCode = 500;
    throw err;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

exports.parseImportedDocument = async (id) => {
  const rows = await db.query(
    `SELECT * FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
    [id]
  );

  const doc = rows[0][0];
   

  if (!doc) {
    const err = new Error("Documento importato non trovato");
    err.statusCode = 404;
    throw err;
  }

  if (!doc.stored_filename) {
    const err = new Error("Nessun file associato al documento");
    err.statusCode = 400;
    throw err;
  }

  const filePath = path.join(
    process.cwd(),
    "..",
    "runtime_uploads",
    "fatture-import",
    doc.stored_filename
  );

  if (!fs1.existsSync(filePath)) {
    const err = new Error("File non trovato sul server");
    err.statusCode = 500;
    throw err;
  }

  let parsedPayload;

  try {
    const form = new FormData();
    form.append("file", fs1.createReadStream(filePath), doc.original_filename || doc.stored_filename);

    const aiResponse = await axios.post(
      "https://idromardi-ai-17229082190.europe-west1.run.app/extract/pdf",
      form,
      {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    parsedPayload = aiResponse?.data?.data || aiResponse?.data;

    if (!parsedPayload || typeof parsedPayload !== "object") {
      const err = new Error("Risposta parser non valida");
      err.statusCode = 500;
      throw err;
    }
  } catch (e) {
    console.error("parseImportedDocument AI error:", e.response?.data || e.message);
    const err = new Error("Errore durante il parsing del PDF");
    err.statusCode = 500;
    throw err;
  }

  const lettureSummary = deriveLettureSummary(parsedPayload.letture || []);
  const groupedLetture = groupLettureByTipo(parsedPayload.letture || []);
  const tariffeSummary = summarizeTariffeAcquedotto(parsedPayload.componente_tariffa_acquedotto || []);
  const depurazioneSum = summarizeImporto(parsedPayload.componente_tariffa_depurazione);
  const fognaturaSum   = summarizeImporto(parsedPayload.componente_tariffa_fognatura);



  parsedPayload.letture_summary = lettureSummary || null;
  parsedPayload.grouped_letture = groupedLetture || null;
  parsedPayload.summaryTariffeAcquedotto = tariffeSummary || null;
  parsedPayload.totale_dep_fog = depurazioneSum + fognaturaSum;
 


  const validation = buildParsedInvoiceValidation(parsedPayload);

  const validationStatus =
    validation.errors?.length > 0
      ? "Errore"
      : validation.warnings?.length > 0
      ? "Attenzione"
      : "Valido";

  const periodi = Array.isArray(parsedPayload?.periodi_fatturazione)
    ? parsedPayload.periodi_fatturazione
    : [];

  const firstPeriodo = periodi[0] || null;
  const lastPeriodo = periodi.length ? periodi[periodi.length - 1] : null;

  await db.query(
    `
    UPDATE imported_invoice_documents
    SET
      numero_bolletta = ?,
      codice_fornitura = ?,
      codice_cliente = ?,
      punto_erogazione = ?,
      matricola_contatore = ?,
      intestatario = ?,
      indirizzo_fornitura = ?,
      fornitore_servizi = ?,
      bill_type = ?,
      data_inizio_periodo = ?,
      data_fine_periodo = ?,
      consumo_globale_mc = ?,
      importo_totale_da_pagare = ?,
      parser_version = ?,
      parser_confidence = ?,
      parse_status = 'parsed',
      validation_status = ?,
      parsed_payload_json = ?,
      validation_json = ?,
      parsed_at = NOW()
    WHERE id = ?
    `,
    [
      parsedPayload?.numero_bolletta || null,
      parsedPayload?.codice_fornitura || null,
      parsedPayload?.anagrafica?.codice_cliente || null,
      parsedPayload?.punto_erogazione || null,
      parsedPayload?.anagrafica?.matricola_contatore || null,
      parsedPayload?.anagrafica?.intestatario || null,
      parsedPayload?.anagrafica?.indirizzo_fornitura || null,
      parsedPayload?.fornitore_servizi || null,
      parsedPayload?.bill_type || "unknown",
      toMysqlDate(firstPeriodo?.data_inizio) || null,
      toMysqlDate(lastPeriodo?.data_fine) || null,
      parsedPayload?.consumo_globale_mc ?? null,
      parsedPayload?.importo_totale_da_pagare ?? null,
      "v1.0.0",
      0.75,
      validationStatus,
      JSON.stringify(parsedPayload),
      JSON.stringify(validation),
      id,
    ]
  );

  const updatedRows = await db.query(
    `SELECT * FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
    [id]
  );

  return {
    ok: true,
    document: updatedRows[0] || null,
  };
};

exports.uploadImportedDocument = async ({ file, body }) => {
  if (!file) {
    const err = new Error("File mancante");
    err.statusCode = 400;
    throw err;
  }

  if (!body?.condominioId) {
    const err = new Error("condominioId mancante");
    err.statusCode = 400;
    throw err;
  }

  const form = new FormData();
  form.append("file", fs1.createReadStream(file.path), file.originalname);
  
  const sql = `
    INSERT INTO imported_invoice_documents (
      condominio_id,
      provider_id,
      original_filename,
      stored_filename,
      mime_type,
      file_size_bytes,
      parse_status,
      validation_status
    ) VALUES (?, ?, ?, ?, ?, ?, 'uploaded', 'pending')
  `;

  const params = [
    body.condominioId,
    body.providerId || null,
    file.originalname || null,
    file.filename || file.stored_filename || null,
    file.mimetype || null,
    file.size || null,
  ];

  const result = await db.query(sql, params);

  const rows = await db.query(
    `SELECT * FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
    [result.insertId]
  );

  return {
    ok: true,
    document: rows[0] || null,
    // parsedData: aiData,
  };
};


function assertUUID(value, name) {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!value || !uuidRegex.test(value)) {
    throw new Error(`${name} must be a valid UUID`);
  }
}


const round3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

function getStornoCapienza(r) {
  return {
    euro: round2(
      n2(r.imp_acquedotto) +
      n2(r.imp_fognatura) +
      n2(r.imp_depurazione)+
      n2(r.imp_oneri)
    ),
    mc: round3(n2(r.consumo_normale)),
  };
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
async function loadOpenAccontoCredits(conn, idUtenza) {
  const [rows] = await conn.query(
    `
    SELECT
      m.id,
      m.id_utenza,
      m.id_fattura,
      m.id_riga_fattura,
      m.created_at,
      m.importo_euro AS euro_orig,
      m.importo_mc AS mc_orig,
      COALESCE(SUM(s.importo_euro), 0) AS euro_usato,
      COALESCE(SUM(s.importo_mc), 0) AS mc_usato
    FROM fatture_acconti_movimenti m
    LEFT JOIN fatture_acconti_movimenti s
      ON s.source_movimento_id = m.id
     AND s.tipo_movimento = 'STORNO_APPLICATO'
    WHERE m.id_utenza = ?
      AND m.tipo_movimento IN ('ACCONTO_CARICATO', 'RETTIFICA_POS')
    GROUP BY
      m.id, m.id_utenza, m.id_fattura, m.id_riga_fattura,
      m.created_at, m.importo_euro, m.importo_mc
    HAVING
      ROUND(m.importo_euro - COALESCE(SUM(s.importo_euro), 0), 2) > 0
      OR ROUND(m.importo_mc - COALESCE(SUM(s.importo_mc), 0), 3) > 0
    ORDER BY m.created_at ASC, m.id ASC
    `,
    [idUtenza]
  );

  return rows.map((r) => ({
    id: r.id,
    id_utenza: r.id_utenza,
    id_fattura: r.id_fattura,
    id_riga_fattura: r.id_riga_fattura,
    created_at: r.created_at,
    open_euro: round2(n2(r.euro_orig) - n2(r.euro_usato)),
    open_mc: round3(n2(r.mc_orig) - n2(r.mc_usato)),
  }));
}

async function applyOpenAccontoToRow(conn, row) {
  const credits = await loadOpenAccontoCredits(conn, row.id_utenza);
  
  const cap = getStornoCapienza(row);

  let remainingEuroCap = round2(cap.euro);
  let remainingMcCap = round3(cap.mc);

  let usedEuro = 0;
  let usedMc = 0;
  const movements = [];

  for (const c of credits) {
    if (remainingEuroCap <= 0 && remainingMcCap <= 0) break;

    const euroFactor =
      c.open_euro > 0 ? remainingEuroCap / c.open_euro : Number.POSITIVE_INFINITY;

    const mcFactor =
      c.open_mc > 0 ? remainingMcCap / c.open_mc : Number.POSITIVE_INFINITY;

    const factor = Math.max(0, Math.min(1, euroFactor, mcFactor));

    if (factor <= 0) continue;

    let takeEuro = c.open_euro > 0 ? round2(c.open_euro * factor) : 0;
    let takeMc = c.open_mc > 0 ? round3(c.open_mc * factor) : 0;

    // rounding guard
    if (takeEuro > remainingEuroCap) takeEuro = round2(remainingEuroCap);
    if (takeMc > remainingMcCap) takeMc = round3(remainingMcCap);

    if (takeEuro <= 0 && takeMc <= 0) continue;

    usedEuro = round2(usedEuro + takeEuro);
    usedMc = round3(usedMc + takeMc);

    remainingEuroCap = round2(remainingEuroCap - takeEuro);
    remainingMcCap = round3(remainingMcCap - takeMc);

    movements.push({
      source_movimento_id: c.id,
      importo_euro: takeEuro,
      importo_mc: takeMc,
    });

   
  }

  row.storno_pregresso = round2(usedEuro);
  row._storno_mc = round3(usedMc);
  row._storno_movements = movements;

  
  // keep existing distributed storno_acconto intact
  row.base_totale = round2(n2(row.base_totale) - n2(row.storno_pregresso));

  return row;
}
 
function allocateAcquedotto({ consumo, scaglioni, nucleo, nuae, giorniRef, yearDays, key}) {
  let remaining = Math.max(0, n2(consumo));
  let total = 0;

  const N = Math.max(1, n2(nucleo));
  const A = Math.max(1, n2(nuae));
  const days = Math.max(0, n2(giorniRef));

  // Sort by ordine or mc_da_base ascending (defensive)
  const ordered = [...scaglioni].sort((a, b) => n2(a.ordine) - n2(b.ordine));
  
  const tiers = [];
  for (const s of ordered) {
    if (remaining <= 0) break;

    const baseFrom = n2(s.mc_da_base);
    const baseTo = s.mc_a_base === null ? null : n2(s.mc_a_base);
  
    // annual span for this tier in base mc/year
    const spanBase = (baseTo === null) ? Infinity : Math.max(0, baseTo - baseFrom);
     
    // multiplier rule
    const multN = 3; 
 
    // prorated tier capacity
    const capacity =
      spanBase === Infinity
        ? Infinity
        : (spanBase * multN  / yearDays) * days;

    const take = capacity === Infinity ? remaining: Math.min(remaining, capacity);
    
    const mcAllocati = round2(take);
    const price = n2(s.prezzo_acquedotto);
    const importo = round2(mcAllocati * price);

      
    total += take * price;
    remaining -= take;

      tiers.push({
        ordine: n2(s.ordine),
        label:
          s.label ??
          s.nome ??
          s.descrizione ??
          `Scaglione ${s.ordine ?? tiers.length + 1}`,
        mc_allocati: mcAllocati,
        price,
        importo,
        mc_da_base: baseFrom,
        mc_a_base: baseTo,
        key,
        capacity: capacity === Infinity ? null : round2(capacity),
      });
     
      
  }
  
 
  return {
    total: round2(total),
    tiers,
    
  };
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
        AND id_periodo_precedente = ?
      LIMIT 1
      `,
      [idCondominio, idPeriodoAttuale, idPeriodoPrecedente]
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
  mcAcconto,
  mcStorno,
  totImpo,
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
        giorni_interni = ?,
        tot_acquedotto = ?,
        mcAcconto  = ?,
        mcStorno = ?
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
        totImpo !== undefined ? (totImpo === null ? null : Number(totImpo)) : null,
        mcAcconto !== undefined ? (mcAcconto === null ? null : Number(mcAcconto)) : null,
        mcStorno !== undefined ? (mcStorno === null ? null : Number(mcStorno)) : null,
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

 
async function loadFullSession(conn, sessionId, interniTotals = null, generaleResult = null) {

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
  
  righeRows.dettaglio_consumi = interniTotals.dettaglio_consumi;
  return {
    session: sessionRows[0],
    righe: righeRows, 
    generale: generaleResult?.generale || null
     
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
  parsedQF = null,
  
}) {
 
  let remaining = Math.max(0, n2(consumo));
  let total = 0;
 
  const A = Math.max(1, n2(numNuae));
  const days = Math.max(0, n2(giorniInterni));
 
  for (const s of imposteG) {
     
    
    if (remaining <= 0) break;

    const baseFrom = n2(s.mc_da_base);
    const baseTo = s.mc_a_base === null ? null : n2(s.mc_a_base);
   
    // annual span for this tier in base mc/year
    const spanBase = (baseTo === null) ? Infinity : Math.max(0, baseTo - baseFrom);

    // multiplier rule
    const multN = 3; //n2(s.moltiplica_per_nucleo) ? N : 1;
 
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
  const daysQFv = Math.max(0, n2(giorniQF));
  const yd = Math.max(365, n2(yearDays));
 
  const impAcquedotto = round2(total);
  const impFognatura = consumo * n2(prezzoFognatura);
  const impDepurazione = consumo * n2(prezzoDepurazione);
  const depFog = impFognatura + impDepurazione;

  const qfTot = Number(parsedQF) || (n2(qfAnnua) / yd) * A * daysQFv;

   
 
  
  const baseIva = impAcquedotto + depFog + qfTot;
  const iva = baseIva * n2(aliquotaIva);

  const totale = baseIva + iva + n2(varie);

  return {
    impAcquedotto: round2(impAcquedotto),
    impFognatura: round2(impFognatura),
    impDepurazione: round2(impDepurazione),
    depFog: round2(depFog),
    qfTot: round2(qfTot),
    iva: round2(iva),
    totale: round2(totale),
  };
  
}

function calcolaStornoSoloAcquedotto({
  consumo,
  numNuae,
  giorniInterni,
  yearDays,
  imposteG,
}) {
  let remaining = Math.abs(n2(consumo));
                    
  let total = 0;

  const A =   n2(numNuae);
  const days = n2(giorniInterni);

  const righe = [];

  for (const s of imposteG) {

    if (remaining <= 0) break;

    const baseFrom = n2(s.mc_da_base);
    const baseTo = s.mc_a_base === null ? null : n2(s.mc_a_base);

    const spanBase =
      baseTo === null ? Infinity : Math.max(0, baseTo - baseFrom);

    // Must match legacy exactly
    const multN = 3;

    const capacity =
      spanBase === Infinity
        ? Infinity
        : (spanBase * multN * A / yearDays) * days;

    const take =
      capacity === Infinity ? remaining : Math.min(remaining, capacity);

    const price = n2(s.prezzo_acquedotto);
    const importo = round2(take * price);

    total += take * price;
    remaining -= take;

    righe.push({
      ordine: s.ordine,
      quantita: (take),
      tariffa: (price),
      importo,
    });
  }

  return {
    impAcquedottoStorno: round2(total),
    righe,
  };
}

async function calculateGenerale(conn, sessionId, annoAtt = null, annoPrec = null, eurStorno = 0, parsedQF = null) {
  assertUUID(sessionId, "sessionId");

  const n2 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  try {
    const [[session]] = await conn.query(
      `SELECT * FROM fatture_sessioni WHERE id = ? LIMIT 1`,
      [sessionId]
    );
    if (!session) throw new Error("Session not found");

    const [[pa]] = await conn.query(
      `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
      [session.id_periodo_attuale]
    );
    const [[pp]] = await conn.query(
      `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
      [session.id_periodo_precedente]
    );

    if (!pa || !pp) throw new Error("Periodi non trovati");

    const anno = Number(annoAtt) || Number(pa.period_year);
    const yd = yearDaysCount(anno);

    // -----------------------------
    // GENERAL CONSUMPTION
    // -----------------------------
    const consumoNorm = Math.max(
      0,
      n2(pa.contatore_generale_valore) - n2(pp.contatore_generale_valore)
    );

    // -----------------------------
    // TOTAL NUCLEI
    // -----------------------------
    const [utenze] = await conn.query(
      `SELECT nucleo FROM utenze_v2 WHERE condominio_id = ? AND stato='ATTIVA'`,
      [session.id_condominio]
    );

    const totNuc = utenze.reduce(
      (s, u) => s + Math.max(1, n2(u.nucleo)),
      0
    );

    const [[condo]] = await conn.query(
      `SELECT nuae FROM condomini_v2 WHERE id = ? LIMIT 1`,
      [session.id_condominio]
    );

    const numNuae = condo?.nuae ? Math.max(1, n2(condo.nuae)) : 1;

    // -----------------------------
    // LOAD TARIFFE
    // -----------------------------
    const tariff = await loadTariffeABC(conn, {
      anno,
      categoriaCodice: "RESIDENTE",
    });

    const imposteG = [...(tariff.scaglioni || [])].sort(
      (a, b) => n2(a.ordine) - n2(b.ordine)
    );

    // -----------------------------
    // MC ACCONTO CALCULATION
    // -----------------------------
    let consumoAcconto = 0;

    if (n2(session.mcAcconto) > 0) {
      consumoAcconto = n2(session.mcAcconto);
    } else if (
      n2(session.giorni_acconto) > 0 &&
      consumoNorm > 0 &&
      n2(session.giorni_consumi) > 0
    ) {
      consumoAcconto =
        (consumoNorm / n2(session.giorni_consumi)) *
        n2(session.giorni_acconto);
    }

    consumoAcconto = round2(consumoAcconto);
    const consumoTot = round2(consumoNorm + consumoAcconto);

    // -----------------------------
    // BASE CALCULATION (NO ACCONTO)
    // -----------------------------
    const base = calcolaGeneraleLegacy({
      consumo: consumoNorm,
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
      parsedQF: parsedQF,

    });

    // -----------------------------
    // WITH ACCONTO
    // -----------------------------
    const withAcc = calcolaGeneraleLegacy({
      consumo: consumoTot,
      totNuc,
      numNuae,
      giorniInterni: n2(session.giorni_consumi) + n2(session.giorni_acconto),
      yearDays: yd,
      imposteG,
      prezzoFognatura: tariff.prezzoFognatura,
      prezzoDepurazione: tariff.prezzoDepurazione,
      qfAnnua: tariff.qfAnnua,
      giorniQF: session.giorni_qf,
      varie: session.varie,
      parsedQF: parsedQF,
    });

    // -----------------------------
    // ACCONTO BREAKDOWN (DELTA)
    // -----------------------------
    const impConsAcc = round2(withAcc.impAcquedotto - base.impAcquedotto);
    const depFogAcc = round2(withAcc.depFog - base.depFog);
    const ivaAcc = round2(withAcc.iva - base.iva);

    const totAcc = round2(impConsAcc + depFogAcc + ivaAcc);

    // -----------------------------
    // STORNO = ACQUEDOTTO ONLY ON mcStorno
    // -----------------------------
    const mcStorno =  n2(session.mcStorno) !== 0 ? n2(session.mcStorno) : 0;

   
    const stornoCalc = calcolaStornoSoloAcquedotto({
      consumo: mcStorno,
      numNuae,
      giorniInterni: session.giorni_consumi,
      yearDays: yd,
      imposteG,
    });

   
    const stornoEuro = eurStorno || round2(stornoCalc.impAcquedottoStorno);

    // final total after storno deduction
    const totalePrimaStorno = round2(n2(withAcc.totale));
    const totaleFinale = round2(Math.max(0, totalePrimaStorno + stornoEuro));
    
    console.log("Generale calculation", totalePrimaStorno, stornoEuro, totaleFinale);
    
    return {
      meta: {
        anno,
        consumoNorm,
        consumoAcconto,
        consumoTot,
        mcStorno,
        stornoEuro,
      },
      generale: {
        ...withAcc,
        consumoAcconto,
        impConsAcc,
        depFogAcc,
        ivaAcc,
        totAcc,
      
        mcStorno,
        stornoEuro,
        stornoDettaglio: stornoCalc.righe,

        totalePrimaStorno,
        totale: totaleFinale,
        totDaPagare: totaleFinale,
      },
    };
  } finally {
    conn.release();
  }
}
async function calculateInterni(conn, session, generale, tfCode, annoAtt, annoPrec = null, eurStorno = 0, totaleParsedWithOneri) {

  console.log(generale);
  // ---------- helpers ----------
  const pick = (obj, ...keys) => {
    for (const k of keys) {
      if (obj?.[k] !== undefined && obj?.[k] !== null) return obj[k];
    }
    return undefined;
  };

  const upper = (v, fallback = "") => String(v ?? fallback).toUpperCase();
  const isSpecial = (u) => upper(pick(u, "tipo", "Tipo"), "") === "SPECIAL";
  const isPureNumericInterno = (x) => /^\d+$/.test(String(x ?? "").trim());

  /**
   * Proportional allocator that preserves the exact total.
   * Supports positive or negative totals.
   * decimals=2 for money, decimals=3 for mc.
   */
  const allocateByWeight = (total, items, getWeight, decimals = 2) => {
    const factor = Math.pow(10, decimals);
    const signedTotalUnits = Math.round(n2(total) * factor);

    if (!items.length || signedTotalUnits === 0) {
      return items.map(() => 0);
    }

    const sign = signedTotalUnits < 0 ? -1 : 1;
    const absTotalUnits = Math.abs(signedTotalUnits);

    const weights = items.map((item) => Math.max(0, n2(getWeight(item))));
    const totalWeight = weights.reduce((s, w) => s + w, 0);

    if (totalWeight <= 0) {
      const base = Math.floor(absTotalUnits / items.length);
      let remainder = absTotalUnits - base * items.length;
      return items.map((_, i) => sign * ((base + (i < remainder ? 1 : 0)) / factor));
    }

    const raw = weights.map((w) => (w / totalWeight) * absTotalUnits);
    const floored = raw.map((v) => Math.floor(v));
    let assigned = floored.reduce((s, v) => s + v, 0);
    let remainder = absTotalUnits - assigned;

    const order = raw
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac);

    for (let k = 0; k < remainder; k++) {
      floored[order[k].i] += 1;
    }

    return floored.map((u) => sign * (u / factor));
  };

  try {
    // ---------- Load periods ----------
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

    const anno = Number(annoAtt) || Number(periodoAttuale.period_year);
    const yearDays = yearDaysCount(anno);

    const y = Number(periodoAttuale.period_year);
    const m = Number(periodoAttuale.period_month);
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

    // ---------- Active utenze ----------
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

    if (!utenzeRaw.length) {
      throw new Error("No active utenze");
    }

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
    await conn.query(`DELETE FROM fatture_acconti_movimenti WHERE id_fattura = ?`, [session.id]);
    await conn.query(`DELETE FROM fatture_righe WHERE id_fattura = ?`, [session.id]);

    // ---------- Group by UNIT (billing_group_id for doppio) ----------
    const byUnit = new Map();

    for (const u of utenze) {
      const isDoppio = String(u.Doppio_Contatore).toUpperCase() === "SI";

      if (!isDoppio) {
        byUnit.set(`__single_${u.id}`, [u]);
        continue;
      }

      const groupKey = u.billing_group_id;

      if (!groupKey) {
        byUnit.set(`__single_${u.id}`, [u]);
        continue;
      }

      if (!byUnit.has(groupKey)) byUnit.set(groupKey, []);
      byUnit.get(groupKey).push(u);
    }

    for (const [key, units] of Array.from(byUnit.entries())) {
      if (!key.startsWith("__single_") && units.length <= 1) {
        const u = units[0];
        byUnit.delete(key);
        byUnit.set(`__single_${u.id}`, [u]);
      }
    }

    const unitKeys = Array.from(byUnit.keys()).sort((a, b) => {
      const groupA = byUnit.get(a) || [];
      const groupB = byUnit.get(b) || [];
      const firstA = groupA[0];
      const firstB = groupB[0];

      const internoA = String(firstA?.Interno ?? "");
      const internoB = String(firstB?.Interno ?? "");

      const numA = Number(internoA);
      const numB = Number(internoB);

      if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
      return internoA.localeCompare(internoB);
    });

    const rows = [];
    let totaleOneri = 0;

    // -------------------------------------------------------------------
    // PASS 1: build base rows
    // -------------------------------------------------------------------

    const dettaglio_consumi = [];
    let dettaglioConsumiAcquedotto = [];
    for (const key of unitKeys) {
      const group = byUnit.get(key);

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

      let sumAtt = 0;
      let sumPrec = 0;
      let haveAny = false;

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
        if (d < 0) {
          throw new Error(`Negative consumption for unit ${key} (interno ${first.Interno})`);
        }
        consumoNorm = d;
      }

      let flatTipo = "NORMAL";
      if (upper(group[0].Tipo, "") === "SPECIAL") {
        consumoNorm = 0;
        flatTipo = "SPECIAL";
      }

      const consumoTot = consumoNorm;

      const categoriaCodice = upper(first.categoria_tariffa, "RESIDENTE");
      const tariff = await loadTariffeABC(conn, { anno, categoriaCodice, tfCode });

      const nucleo = Math.max(1, n2(first.nucleo));
      const nuaeU = Math.max(1, n2(first.nuae));

      //qui potremmo aggiornare consumoNorm e assegnare una percentuale (60 con tariffe 2024, 40 con tariffe 2025) da addebitare a cavallo di due periodi.

      let impAcq = 0;
      
      let user_id = ra0.id_utenza;

       
      if (consumoNorm !== null) {
        const impNorm = allocateAcquedotto({
          consumo: consumoNorm,
          scaglioni: tariff.scaglioni,
          nucleo,
          nuae: nuaeU,
          giorniRef: Math.max(1, n2(session.giorni_interni)),
          yearDays,
          key:user_id

        });
  
        impAcq = round2(impNorm.total);
        dettaglioConsumiAcquedotto.push(impNorm.tiers);
      }
 
       
      const impFog = consumoTot === null ? 0 : round2(consumoTot * n2(tariff.prezzoFognatura));
      const impDep = consumoTot === null ? 0 : round2(consumoTot * n2(tariff.prezzoDepurazione));
      const impQf = flatTipo === "SPECIAL" ? 0 : round2(qfPerNuae * nuaeU);

      const impOneri = isMulti
        ? round2(n2(session.oneri_doppio_snapshot))
        : round2(n2(session.oneri_snapshot));

      totaleOneri += impOneri;

      const baseIva = round2(impAcq + impFog + impDep + impQf);
      const impIva = round2(baseIva * 0.10);
      const baseTot = round2(impAcq + impFog + impDep + impQf + impOneri + impIva);

      rows.push({
        id_utenza: first.id,
        id_user: first.id_user,
        id_riga_fattura: null,

        lettura_precedente: rp0?.valore_lettura ?? null,
        stato_precedente: statoPrec,
        lettura_attuale: ra0?.valore_lettura ?? null,
        stato_attuale: statoAtt,

        consumo_normale: consumoNorm,
        consumo_acconto: 0,
        consumo_totale: consumoNorm,

        imp_acquedotto: impAcq,
        imp_fognatura: impFog,
        imp_depurazione: impDep,
        imp_qf: impQf,
        imp_oneri: impOneri,
        imp_iva: impIva,
        

        imp_acconto: 0,
        depfog_acconto: 0,
        acconto: 0,

        storno_calcolato: 0,   // current invoice storno from mcStorno
        storno_pregresso: 0,   // old ledger credit consumed
        storno_totale: 0,      // persisted printable storno

        base_totale: baseTot,
        conguaglio: 0,
        imp_arr: 0,
        totale: baseTot,

        tfEligible: !isSpecial(first) && consumoTot !== null && n2(consumoTot) > 0,
        _unitKey: key,
        _isPrimary: true,
      });

      if (isMulti) {
        for (let k = 1; k < group.length; k++) {
          const gk = group[k];
          const rak = mapAtt.get(gk.id);
          const rpk = mapPrec.get(gk.id);

          rows.push({
            id_utenza: gk.id,
            id_user: gk.id_user,
            id_riga_fattura: null,

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

            imp_acconto: 0,
            depfog_acconto: 0,
            acconto: 0,

            storno_calcolato: 0,
            storno_pregresso: 0,
            storno_totale: 0,

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
    generale.dettaglio = dettaglioConsumiAcquedotto
    // -------------------------------------------------------------------
    // PASS 2: distribute current invoice acconto + current invoice storno
    // -------------------------------------------------------------------
    const primaries = rows.filter((r) => r._isPrimary);

    const totAccEuro = round2(n2(generale.totAcc ?? 0));
    const totConsAccMc = round3(n2(generale.consumoAcconto ?? 0));
    const totImpConsAcc = round2(n2(generale.impConsAcc ?? 0));
    const totDepFogAcc = round2(n2(generale.depFogAcc ?? 0));

    // invoice-facing storno should be NEGATIVE
    const totStornoCalcolato = round2(n2(eurStorno ?? 0));

    const moneyWeightFn = (r) => Math.max(0, round2(n2(r.base_totale) - n2(r.imp_oneri)));
    const mcWeightFn = (r) => Math.max(0, n2(r.consumo_normale));

    const accEuroShares = allocateByWeight(totAccEuro, primaries, moneyWeightFn, 2);
    const impConsAccShares = allocateByWeight(
      totImpConsAcc > 0 ? totImpConsAcc : totAccEuro,
      primaries,
      moneyWeightFn,
      2
    );
    const depFogAccShares = allocateByWeight(totDepFogAcc, primaries, moneyWeightFn, 2);
    const accMcShares = allocateByWeight(totConsAccMc, primaries, mcWeightFn, 3);
    const stornoCalcShares = allocateByWeight(totStornoCalcolato, primaries, moneyWeightFn, 2);

    for (let i = 0; i < primaries.length; i++) {
      const r = primaries[i];

      r.acconto = round2(accEuroShares[i] || 0);
      r.imp_acconto = round2(impConsAccShares[i] || 0);
      r.depfog_acconto = round2(depFogAccShares[i] || 0);
      r.consumo_acconto = round3(accMcShares[i] || 0);

      // must be negative if it reduces the invoice
      r.storno_calcolato = round2(stornoCalcShares[i] || 0);

      // acconto increases total, storno_calcolato already has sign
      r.base_totale = round2(
        n2(r.base_totale) +
        n2(r.imp_acconto) +
        n2(r.depfog_acconto) +
        n2(r.storno_calcolato)
      );
    }

    // -------------------------------------------------------------------
    // PASS 2B: apply old open acconto credits from ledger (FIFO)
    // IMPORTANT:
    // applyOpenAccontoToRow(conn, row) MUST:
    //   - set row.storno_pregresso as NEGATIVE invoice-facing value
    //   - set row._storno_movements = [...]
    //   - add row.storno_pregresso to row.base_totale
    // -------------------------------------------------------------------
    for (const r of primaries) {
      await applyOpenAccontoToRow(conn, r);
    }

    // finalize printable storno field
    for (const r of rows) {
      r.storno_totale = round2(n2(r.storno_calcolato) + n2(r.storno_pregresso));
    }

    // -------------------------------------------------------------------
    // TF base (TF applied on TF1 base, not stacked)
    // -------------------------------------------------------------------
    const baseSum = round2(rows.reduce((s, r) => s + n2(r.base_totale), 0));

    const diff = totaleParsedWithOneri!=0? round2(n2(totaleParsedWithOneri) - baseSum) : round2(n2(generale.totale + totaleOneri) - baseSum);

    console.log(diff )
    applyTfToRows({ tfCode, diff, rows });

    // Apply conguaglio + rounding adjustment
    for (const r of rows) {
      const beforeRound = round2(n2(r.base_totale) + n2(r.conguaglio));
      const rounded = roundToNearestTenth(beforeRound);
      const arr = round2(rounded - beforeRound);

      r.imp_arr = arr;
      r.totale = round2(beforeRound + arr);
    }

    // ------------------------------------------------------------
    // Persist fatture_righe
    // ------------------------------------------------------------
    for (const r of rows) {
      const rowId = uuid();
      r.id_riga_fattura = rowId;

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
         totale,
         imp_acconto, depfog_acconto, acconto, storno_acconto)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          rowId,
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

          r.imp_acconto,
          r.depfog_acconto,
          r.acconto,
          r.storno_totale,
        ]
      );
    }

    // ------------------------------------------------------------
    // Persist fatture_acconti_movimenti
    // ------------------------------------------------------------
    for (const r of rows) {
      // A) current invoice generates new acconto credit
      if (n2(r.acconto) > 0 || n2(r.consumo_acconto) > 0) {
        await conn.query(
          `
          INSERT INTO fatture_acconti_movimenti
          (id, id_utenza, id_fattura, id_riga_fattura,
           tipo_movimento, importo_euro, importo_mc, source_movimento_id, note)
          VALUES (?, ?, ?, ?, 'ACCONTO_CARICATO', ?, ?, NULL, ?)
          `,
          [
            uuid(),
            r.id_utenza,
            session.id,
            r.id_riga_fattura,
            round2(n2(r.acconto)),
            round3(n2(r.consumo_acconto)),
            'Acconto generato dalla fattura corrente',
          ]
        );
      }

      // B) current invoice consumes old open acconto credit
      if (Array.isArray(r._storno_movements)) {
        for (const sm of r._storno_movements) {
          if (n2(sm.importo_euro) <= 0 && n2(sm.importo_mc) <= 0) continue;

          await conn.query(
            `
            INSERT INTO fatture_acconti_movimenti
            (id, id_utenza, id_fattura, id_riga_fattura,
             tipo_movimento, importo_euro, importo_mc, source_movimento_id, note)
            VALUES (?, ?, ?, ?, 'STORNO_APPLICATO', ?, ?, ?, ?)
            `,
            [
              uuid(),
              r.id_utenza,
              session.id,
              r.id_riga_fattura,
              round2(n2(sm.importo_euro)),
              round3(n2(sm.importo_mc)),
              sm.source_movimento_id,
              'Storno applicato dalla fattura corrente',
            ]
          );
        }
      }
    }

    // Totals
    const totAcq = round2(rows.reduce((s, r) => s + n2(r.imp_acquedotto), 0));
    const totConsAcc = round3(rows.reduce((s, r) => s + n2(r.consumo_acconto), 0));
    const totStorno = round2(rows.reduce((s, r) => s + n2(r.storno_totale), 0));
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
      totConsAcc,
      totStorno,
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
      rows,
      tfCode: upper(tfCode, "TF1"),
    };
  } catch (err) {
    throw err;
  }
}
exports.calculateSession = async function ({ sessionId, tfCode, annoAtt, annoPrec = null, eurStorno = 0, parsedQF = 0, totaleParsedWithOneri = 0 }) {

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
    const generaleResult = await calculateGenerale(conn, sessionId, annoAtt, annoPrec, eurStorno, parsedQF);
 
    const g = generaleResult.generale;
 
    session.consumoNorm = generaleResult.meta.consumoNorm;

    const interniTotals = await calculateInterni(conn, session, g, tfCode, annoAtt, annoPrec, eurStorno, totaleParsedWithOneri);
    
    
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
        g.impAcquedotto,
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

    

    return await loadFullSession(conn, sessionId, interniTotals, generaleResult);


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
v
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

exports.createImportedDocument = async function (payload) {
  if (!payload?.condominioId) {
    throw new Error("condominioId mancante");
  }
  if (!payload?.originalFilename) {
    throw new Error("originalFilename mancante");
  }

  const sql = `
    INSERT INTO imported_invoice_documents (
      condominio_id,
      provider_id,
      original_filename,
      stored_filename,
      mime_type,
      file_size_bytes,
      file_hash,
      parse_status,
      validation_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded', 'pending')
  `;

  const params = [
    payload.condominioId,
    payload.providerId ?? null,
    payload.originalFilename,
    payload.storedFilename ?? null,
    payload.mimeType ?? null,
    payload.fileSizeBytes ?? null,
    payload.fileHash ?? null,
  ];

  const result = await db.query(sql, params);
  const rows = await db.query(
    `SELECT * FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
    [result.insertId]
  );

  return { ok: true, document: rows[0] || null };
}

exports.listImportedDocumentsByCondominio = async function (condominioId) {
  const sql = `
    SELECT
      id,
      condominio_id,
      provider_id,
      original_filename,
      numero_bolletta,
      codice_fornitura,
      fornitore_servizi,
      bill_type,
      data_inizio_periodo,
      data_fine_periodo,
      consumo_globale_mc,
      importo_totale_da_pagare,
      parse_status,
      validation_status,
      linked_session_id,
      uploaded_at,
      parsed_at,
      imported_at
    FROM imported_invoice_documents
    WHERE condominio_id = ?
    ORDER BY created_at DESC
  `;

  const rows = await db.query(sql, [condominioId]);
  return { ok: true, items: rows };
}

exports.getImportedDocumentById = async function (id) {
  const rows = await db.query(
    `SELECT * FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
    [id]
  );

  const doc = rows[0];
  if (!doc) {
    const err = new Error("Documento importato non trovato");
    err.statusCode = 404;
    throw err;
  }

  return { ok: true, document: doc };
}

exports.updateImportedDocumentParsedResult = async function (id, payload) {
  const existingRows = await db.query(
    `SELECT id FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
    [id]
  );

  if (!existingRows[0]) {
    const err = new Error("Documento importato non trovato");
    err.statusCode = 404;
    throw err;
  }

  const sql = `
    UPDATE imported_invoice_documents
    SET
      provider_id = ?,
      numero_bolletta = ?,
      codice_fornitura = ?,
      codice_cliente = ?,
      punto_erogazione = ?,
      matricola_contatore = ?,
      intestatario = ?,
      indirizzo_fornitura = ?,
      fornitore_servizi = ?,
      bill_type = ?,
      data_inizio_periodo = ?,
      data_fine_periodo = ?,
      consumo_globale_mc = ?,
      importo_totale_da_pagare = ?,
      parser_version = ?,
      parser_confidence = ?,
      parse_status = ?,
      validation_status = ?,
      parsed_payload_json = ?,
      validation_json = ?,
      parser_error_text = ?,
      parsed_at = CASE
        WHEN parsed_at IS NULL THEN NOW()
        ELSE parsed_at
      END
    WHERE id = ?
  `;

  const params = [
    payload.providerId ?? null,
    payload.numeroBolletta ?? null,
    payload.codiceFornitura ?? null,
    payload.codiceCliente ?? null,
    payload.puntoErogazione ?? null,
    payload.matricolaContatore ?? null,
    payload.intestatario ?? null,
    payload.indirizzoFornitura ?? null,
    payload.fornitoreServizi ?? null,
    payload.billType ?? "unknown",
    payload.dataInizioPeriodo ?? null,
    payload.dataFinePeriodo ?? null,
    payload.consumoGlobaleMc ?? null,
    payload.importoTotaleDaPagare ?? null,
    payload.parserVersion ?? null,
    payload.parserConfidence ?? null,
    payload.parseStatus ?? "parsed",
    payload.validationStatus ?? "pending",
    payload.parsedPayload ? JSON.stringify(payload.parsedPayload) : null,
    payload.validation ? JSON.stringify(payload.validation) : null,
    payload.parserErrorText ?? null,
    id,
  ];

  await db.query(sql, params);

  const rows = await db.query(
    `SELECT * FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
    [id]
  );

  return { ok: true, document: rows[0] || null };
}

exports.linkImportedDocumentToSession = async function (id, sessionId) {
  if (!sessionId) {
    throw new Error("sessionId mancante");
  }

  const existingRows = await db.query(
    `SELECT id FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
    [id]
  );

  if (!existingRows[0]) {
    const err = new Error("Documento importato non trovato");
    err.statusCode = 404;
    throw err;
  }

  await db.query(
    `
    UPDATE imported_invoice_documents
    SET
      linked_session_id = ?,
      parse_status = 'imported',
      imported_at = NOW()
    WHERE id = ?
    `,
    [sessionId, id]
  );

  const rows = await db.query(
    `SELECT * FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
    [id]
  );

  return { ok: true, document: rows[0] || null };
}