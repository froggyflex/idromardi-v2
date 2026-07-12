const db = require("../../config/db");
const { v4: uuid } = require("uuid");
const axios = require("axios");
const FormData = require("form-data");
/* ---------------- Helpers ---------------- */
const path = require("path");
const e = require("express");
const fs = require("fs").promises;
const fs1 = require("fs");
const { launchBrowser } = require("../../utils/puppeteer");
const { buildRipartizionePdfHtml } = require("./fatture.pdf");
const { error } = require("console");
const pLimit = require("p-limit").default;
const { PDFDocument } = require("pdf-lib");
const {
  getGeneratedDocumentById,
  getLatestGeneratedDocument,
  getPdfFromR2,
  listGeneratedDocuments,
  saveGeneratedDocument,
} = require("../../utils/generatedDocuments");
// const db = require(... your existing db helper ...)

const DEFAULT_AI_PARSER_BASE_URL =
  "https://idromardi-ai-693191024735.europe-west1.run.app";
let ripartizionePdfColumns = null;
let fattureSessionColumns = null;
let fattureRigheColumns = null;

async function getRipartizionePdfColumns() {
  if (ripartizionePdfColumns) return ripartizionePdfColumns;

  const [columns] = await db.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ripartizione_pdfs'
    `
  );

  ripartizionePdfColumns = new Set(columns.map((row) => row.COLUMN_NAME));
  return ripartizionePdfColumns;
}

async function getFattureSessionColumns() {
  if (fattureSessionColumns) return fattureSessionColumns;

  const [columns] = await db.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fatture_sessioni'
    `
  );

  fattureSessionColumns = new Set(columns.map((row) => row.COLUMN_NAME));
  return fattureSessionColumns;
}

async function ensureFattureSessionContextColumns() {
  const columns = await getFattureSessionColumns();
  const alters = [];

  if (!columns.has("imported_document_id")) {
    alters.push("ADD COLUMN imported_document_id BIGINT UNSIGNED NULL AFTER tf_code");
  }

  if (!columns.has("calculation_context_json")) {
    alters.push("ADD COLUMN calculation_context_json LONGTEXT NULL AFTER imported_document_id");
  }

  if (!columns.has("calculation_context_updated_at")) {
    alters.push("ADD COLUMN calculation_context_updated_at DATETIME NULL AFTER calculation_context_json");
  }

  if (!columns.has("manual_consumptions_json")) {
    alters.push("ADD COLUMN manual_consumptions_json LONGTEXT NULL AFTER calculation_context_updated_at");
  }

  if (!alters.length) return columns;

  await db.query(`ALTER TABLE fatture_sessioni ${alters.join(", ")}`);
  fattureSessionColumns = null;
  return getFattureSessionColumns();
}

async function getFattureRigheColumns() {
  if (fattureRigheColumns) return fattureRigheColumns;

  const [columns] = await db.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fatture_righe'
    `
  );

  fattureRigheColumns = new Set(columns.map((row) => row.COLUMN_NAME));
  return fattureRigheColumns;
}

async function ensureFattureRigheRecuperoColumns() {
  const columns = await getFattureRigheColumns();
  const alters = [];

  if (!columns.has("recupero_lettura")) {
    alters.push("ADD COLUMN recupero_lettura TINYINT(1) NOT NULL DEFAULT 0 AFTER storno_acconto");
  }

  if (!columns.has("recupero_note")) {
    alters.push("ADD COLUMN recupero_note VARCHAR(255) NULL AFTER recupero_lettura");
  }

  if (!alters.length) return columns;

  await db.query(`ALTER TABLE fatture_righe ${alters.join(", ")}`);
  fattureRigheColumns = null;
  return getFattureRigheColumns();
}

async function getImportedDocumentLinkedToSession(conn, session) {
  await ensureFattureSessionContextColumns();

  if (session?.imported_document_id) {
    const [rows] = await conn.query(
      `
      SELECT
        id,
        original_filename,
        numero_bolletta,
        data_inizio_periodo,
        data_fine_periodo,
        importo_totale_da_pagare,
        linked_session_id
      FROM imported_invoice_documents
      WHERE id = ?
      LIMIT 1
      `,
      [session.imported_document_id]
    );
    if (rows[0]) return rows[0];
  }

  const [rows] = await conn.query(
    `
    SELECT
      id,
      original_filename,
      numero_bolletta,
      data_inizio_periodo,
      data_fine_periodo,
      importo_totale_da_pagare,
      linked_session_id
    FROM imported_invoice_documents
    WHERE CONVERT(linked_session_id USING utf8mb4) COLLATE utf8mb4_general_ci =
      CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_general_ci
    ORDER BY imported_at DESC, updated_at DESC
    LIMIT 1
    `,
    [session.id]
  );

  return rows[0] || null;
}

function joinUrl(baseUrl, pathname) {
  return `${String(baseUrl).replace(/\/+$/, "")}${pathname}`;
}

function normalizeTfCode(value, fallback = "TF1") {
  const code = String(value || fallback || "TF1").trim().toUpperCase();
  if (code === "NONE") return "TF1";
  if (code === "EQUAL" || code === "TF2N") return "TF2";
  if (code === "PROP" || code === "TF3N") return "TF3";
  return ["TF1", "TF2", "TF3"].includes(code) ? code : "TF1";
}

function getAiParserUrl(documentType) {
  const explicitUrl =
    documentType === "txt"
      ? process.env.FATTURE_AI_TXT_PARSER_URL
      : process.env.FATTURE_AI_PDF_PARSER_URL;

  if (explicitUrl) {
    return explicitUrl;
  }

  const baseUrl = process.env.FATTURE_AI_PARSER_BASE_URL || DEFAULT_AI_PARSER_BASE_URL;
  const pathname = documentType === "txt" ? "/extract/abc/txt" : "/extract/pdf";

  return joinUrl(baseUrl, pathname);
}

function buildAiParserError(error, documentType, targetUrl) {
  const status = error.response?.status;
  const detail = error.response?.data?.detail || error.response?.data?.error;
  const requestUrl = error.config?.url || targetUrl;

  const parts = [`Errore durante il parsing del file ${documentType.toUpperCase()}`];

  if (status) {
    parts.push(`HTTP ${status}`);
  }

  if (detail) {
    parts.push(String(detail));
  }

  if (requestUrl) {
    parts.push(`endpoint: ${requestUrl}`);
  }

  const err = new Error(parts.join(" - "));
  err.statusCode = status === 404 ? 502 : 500;
  return err;
}

function formatExtractionErrors(errors) {
  if (!Array.isArray(errors)) {
    return [];
  }

  return errors
    .map((item) => {
      if (!item) {
        return null;
      }

      if (typeof item === "string") {
        return item;
      }

      return item.message || item.error || item.field || JSON.stringify(item);
    })
    .filter(Boolean);
}

function getOverallConfidence(confidence) {
  const value = confidence?.overall;
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : null;
}


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

function isMainAcquedottoTariffRow(row) {
  const code = String(row?.codice_componente || row?.component_code || "").toUpperCase();
  const text = `${code} ${row?.descrizione || ""} ${row?.quota_descrizione || ""}`.toUpperCase();
  const isOneri =
    /\bONERI\b/.test(text) ||
    /\bPEREQUAZIONE\b/.test(text) ||
    /^C_(UI[1-4]|MTI3)/.test(code) ||
    code.includes("_UI") ||
    code.includes("_MTI3");

  if (isOneri) return false;

  return (
    code.startsWith("C_TARI") ||
    text.includes("TARIFFA ACQUEDOTTO") ||
    text.includes("TARIFFA ACQUA") ||
    text.includes("QUOTA VARIABILE ACQUEDOTTO")
  );
}

function summarizeTariffeAcquedotto(rows) {
  const summary = {
    importoPos: 0,
    importoNeg: 0,
    quantitaPos: 0,
    quantitaNeg: 0,
    importoStorno: 0,
    quantitaStorno: 0
  };
  let importoNegMainTariff = 0;
  let quantitaNegMainTariff = 0;

  for (const r of rows) {
    const importo = n2(r.importo);
    const quantita = n2(r.quantita);
    const isMainTariff = isMainAcquedottoTariffRow(r);

    if (r.is_storno_acconto && isMainTariff) {
      summary.importoStorno += importo;
      summary.quantitaStorno += quantita;
    }

    if (importo >= 0) {
      summary.importoPos += importo;
      summary.quantitaPos += quantita;
    } else {
      summary.importoNeg += importo;
      summary.quantitaNeg += quantita;
      if (isMainTariff) {
        importoNegMainTariff += importo;
        quantitaNegMainTariff += quantita;
      }
    }
  }

  if (summary.importoStorno !== 0 || summary.quantitaStorno !== 0) {
    summary.importoNeg = summary.importoStorno;
    summary.quantitaNeg = summary.quantitaStorno;
  } else if (importoNegMainTariff !== 0 || quantitaNegMainTariff !== 0) {
    summary.importoNeg = importoNegMainTariff;
    summary.quantitaNeg = quantitaNegMainTariff;
  }

  for (const key of Object.keys(summary)) {
    summary[key] = round2(summary[key]);
  }

  return summary;
}

function getStornoValuesFromParsedPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { euro: 0, mc: 0, source: "none" };
  }

  const rows = Array.isArray(payload?.componente_tariffa_acquedotto)
    ? payload.componente_tariffa_acquedotto
    : [];
  const explicitRows = rows.filter(
    (row) => row?.is_storno_acconto && isMainAcquedottoTariffRow(row)
  );
  const fallbackRows = rows.filter(
    (row) => n2(row?.importo) < 0 && isMainAcquedottoTariffRow(row)
  );
  const targetRows = explicitRows.length ? explicitRows : fallbackRows;

  if (targetRows.length) {
    return {
      euro: round2(targetRows.reduce((sum, row) => sum + n2(row?.importo), 0)),
      mc: round3(targetRows.reduce((sum, row) => sum + n2(row?.quantita), 0)),
      source: explicitRows.length ? "tariff_rows_explicit" : "tariff_rows_negative",
    };
  }

  const summary = payload?.summaryTariffeAcquedotto || {};
  const euro = n2(summary.importoStorno) || n2(summary.importoNeg);
  const mc = n2(summary.quantitaStorno) || n2(summary.quantitaNeg);

  return {
    euro: round2(euro),
    mc: round3(mc),
    source: euro || mc ? "summary" : "none",
  };
}
 
function summarizeImporto(rows) {
   
  let summary = 0;
  rows.map((r) => (

    summary = summary + r.importo

  ));

   
  return summary;
}

function parseItalianAmount(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const negative = raw.endsWith("-");
  const normalized = raw
    .replace(/-/g, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function deriveAbcTxtFornitureSummary(rawText) {
  if (!rawText || typeof rawText !== "string") return [];

  const text = rawText.replace(/\r\n/g, "\n");
  const markers = [...text.matchAll(/(\d{3}\)-Dati fornitura)/g)].map((match) => ({
    index: match.index,
    numero: match[1].slice(0, 3),
  }));

  if (!markers.length) return [];

  return markers
    .map((marker, idx) => {
      const next = markers[idx + 1]?.index ?? text.length;
      const section = text.slice(marker.index, next);
      const totalMatch = section.match(new RegExp(`${marker.numero}\\)-Totale fornitura\\s+([\\d.,-]+)`));

      const tipoLettura = /MEDIA\s*\/\s*ACCONTO/i.test(section)
        ? "media"
        : /LETTURA\s+A\s+GIRO/i.test(section)
        ? "a_giro"
        : null;

      const consumoMatch = section.match(/TOTALE CONSUMI CALCOLATI:\s*([\d.,-]+)/i);
      const ivaMatch = section.match(/ALIQUOTA\s+10\s+%\s+su imp\.\s+([\d.,-]+)\s*=\s*([\d.,-]+)/i);
      const readings = [];
      const readingRegex =
        /(LETTURA\s+A\s+GIRO|MEDIA\s*\/\s*ACCONTO)\s+(\d{2}\/\d{2}\/\d{4})\s+([\d.,-]+)(?:\s+([\d.,-]+))?/gi;
      let readingMatch;

      while ((readingMatch = readingRegex.exec(section)) !== null) {
        readings.push({
          tipo_lettura: /MEDIA/i.test(readingMatch[1]) ? "media" : "a_giro",
          data_lettura: readingMatch[2],
          lettura_mc: parseItalianAmount(readingMatch[3]),
          consumo_mc: parseItalianAmount(readingMatch[4]),
        });
      }

      const riepilogoVoci = [];
      const riepilogoRegex = /^\|([^|\n]+)\|([^|\n]+)\|([^|\n]+)\|\s*([\d.,-]+)\s*\|/gm;
      let riepilogoMatch;

      while ((riepilogoMatch = riepilogoRegex.exec(section)) !== null) {
        const codice = riepilogoMatch[1].trim();
        if (!codice || codice.toLowerCase() === "tipo voce") continue;

        riepilogoVoci.push({
          codice,
          descrizione: riepilogoMatch[2].trim(),
          aliquota: riepilogoMatch[3].trim(),
          imponibile: parseItalianAmount(riepilogoMatch[4]),
        });
      }

      return {
        numero_fornitura: marker.numero,
        tipo_lettura: tipoLettura,
        totale_fornitura: parseItalianAmount(totalMatch?.[1]),
        consumo_mc: parseItalianAmount(consumoMatch?.[1]),
        imponibile_iva_10: parseItalianAmount(ivaMatch?.[1]),
        iva_10: parseItalianAmount(ivaMatch?.[2]),
        letture: readings,
        riepilogo_voci: riepilogoVoci,
      };
    })
    .filter((item) => item.totale_fornitura !== null || item.tipo_lettura || item.consumo_mc !== null);
}

function parseAbcTxtPeriodLine(line) {
  const match = String(line || "").match(
    /Periodo\s*:?\s+Dal\s+(\d{2}\/\d{2}\/\d{4})\s+al\s+(\d{2}\/\d{2}\/\d{4})/i
  );

  if (!match) return null;

  return {
    from_date: match[1],
    to_date: match[2],
  };
}

function parseAbcTxtComponentLine(line) {
  const match = String(line || "").match(/^Componente:\s*([A-Z0-9_]+)\s*-\s*(.+)$/i);
  if (!match) return null;

  return {
    code: match[1].trim(),
    description: match[2].trim(),
  };
}

function parseAbcTxtQuotaLine(line) {
  const match = String(line || "").match(/^Quota\s*:\s*([A-Z0-9_]+)\s*-\s*(.+)$/i);
  if (!match) return null;

  return {
    code: match[1].trim(),
    description: match[2].trim(),
  };
}

function parseAbcTxtAmountLine(line) {
  const match = String(line || "").match(
    /^\s*(MC|GG|CAD|EURO)\s+([\d.,-]+)\s+E\.\s+([\d.,-]+)\s+=\s+([\d.,-]+)\s+([A-Z0-9]+)\s*$/i
  );

  if (!match) return null;

  return {
    unit: match[1].toUpperCase(),
    quantita: parseItalianAmount(match[2]),
    tariffa: parseItalianAmount(match[3]),
    importo: parseItalianAmount(match[4]),
    iva_code: match[5],
  };
}

function classifyAbcTxtComponent(component, quota, amount) {
  const componentCode = String(component?.code || "").toUpperCase();
  const quotaCode = String(quota?.code || "").toUpperCase();
  const text = `${componentCode} ${component?.description || ""} ${quotaCode} ${quota?.description || ""}`.toUpperCase();

  const isOneri =
    /\bONERI\b/.test(text) ||
    /\bPEREQUAZIONE\b/.test(text) ||
    /^C_(UI[1-4]|MTI3)/.test(componentCode) ||
    componentCode.includes("_UI") ||
    componentCode.includes("_MTI3");

  if (isOneri) return "oneri_perequazione";

  const isQf =
    componentCode.startsWith("C_QF") ||
    quotaCode.startsWith("Q_QF") ||
    text.includes("QUOTA FISSA TARIFFA ACQUA") ||
    text.includes("QUOTA FISSA ACQUEDOTTO");

  if (isQf) return "componente_quota_tariffa_acqua";

  const isDep =
    componentCode.startsWith("C_DEPUR") ||
    quotaCode.startsWith("Q_DEPUR") ||
    text.includes("TARIFFA DEPURAZIONE") ||
    text.includes("QUOTA DEPURAZIONE");

  if (isDep) return "componente_tariffa_depurazione";

  const isFog =
    componentCode.startsWith("C_FOGNA") ||
    quotaCode.startsWith("Q_FOGNA") ||
    text.includes("TARIFFA FOGNATURA") ||
    text.includes("FOGNATURA QUOTA");

  if (isFog) return "componente_tariffa_fognatura";

  const isAcquedotto =
    componentCode.startsWith("C_TARI") ||
    text.includes("TARIFFA ACQUEDOTTO") ||
    text.includes("TARIFFA ACQUA") ||
    text.includes("QUOTA VARIABILE ACQUEDOTTO");

  if (isAcquedotto && amount?.unit === "MC") {
    return "componente_tariffa_acquedotto";
  }

  return null;
}

function deriveAbcTxtComponentRows(rawText) {
  const empty = {
    componente_tariffa_acquedotto: [],
    componente_quota_tariffa_acqua: [],
    componente_tariffa_fognatura: [],
    componente_tariffa_depurazione: [],
    oneri_perequazione: [],
  };

  if (!rawText || typeof rawText !== "string") return empty;

  const text = rawText.replace(/\r\n/g, "\n");
  const markers = [...text.matchAll(/(\d{3}\)-Dati fornitura)/g)].map((match) => ({
    index: match.index,
    numero: match[1].slice(0, 3),
  }));

  if (!markers.length) return empty;

  const out = { ...empty };

  for (let idx = 0; idx < markers.length; idx++) {
    const marker = markers[idx];
    const next = markers[idx + 1]?.index ?? text.length;
    const section = text.slice(marker.index, next);
    const tipoLettura = /MEDIA\s*\/\s*ACCONTO/i.test(section)
      ? "media"
      : /LETTURA\s+A\s+GIRO/i.test(section)
      ? "a_giro"
      : null;

    const lines = section.split("\n");
    let currentPeriod = null;
    let currentComponent = null;
    let currentQuota = null;
    let isStorno = false;

    for (const line of lines) {
      const period = parseAbcTxtPeriodLine(line);
      if (period) {
        currentPeriod = period;
        isStorno = false;
        continue;
      }

      const component = parseAbcTxtComponentLine(line);
      if (component) {
        currentComponent = component;
        currentQuota = null;
        isStorno = false;
        continue;
      }

      const quota = parseAbcTxtQuotaLine(line);
      if (quota) {
        currentQuota = quota;
        continue;
      }

      if (/RIGA\s+DI\s+STORNO\s+ACCONTO/i.test(line)) {
        isStorno = true;
        continue;
      }

      const amount = parseAbcTxtAmountLine(line);
      if (!amount || !currentPeriod || !currentComponent) continue;

      const target = classifyAbcTxtComponent(currentComponent, currentQuota, amount);
      if (!target) continue;

      const importo = isStorno && amount.importo > 0 ? -amount.importo : amount.importo;
      const quantita = isStorno && amount.quantita > 0 ? -amount.quantita : amount.quantita;

      out[target].push({
        confidence: 1,
        descrizione: currentComponent.description,
        codice_componente: currentComponent.code,
        codice_quota: currentQuota?.code || null,
        quota_descrizione: currentQuota?.description || null,
        fornitura: marker.numero,
        tipo_lettura: tipoLettura,
        from_date: currentPeriod.from_date,
        to_date: currentPeriod.to_date,
        quantita,
        tariffa: amount.tariffa,
        importo,
        is_storno_acconto: isStorno,
      });

      isStorno = false;
    }
  }

  return out;
}

function enrichParsedPayloadWithTxtSummary(parsedPayload, rawText) {
  if (!parsedPayload || typeof parsedPayload !== "object" || !rawText) return parsedPayload;

  const fornitureSummary = deriveAbcTxtFornitureSummary(rawText);
  if (fornitureSummary.length) {
    parsedPayload.forniture_summary = fornitureSummary;
  }

  const componentRows = deriveAbcTxtComponentRows(rawText);
  for (const [key, rows] of Object.entries(componentRows)) {
    if (Array.isArray(rows) && rows.length) {
      parsedPayload[key] = rows;
    }
  }

  parsedPayload.summaryTariffeAcquedotto = summarizeTariffeAcquedotto(
    parsedPayload.componente_tariffa_acquedotto || []
  );
  parsedPayload.totale_dep_fog =
    summarizeImporto(parsedPayload.componente_tariffa_depurazione || []) +
    summarizeImporto(parsedPayload.componente_tariffa_fognatura || []);

  return parsedPayload;
}

function enrichImportedDocumentWithStoredTxtSummary(doc) {
  if (!doc?.stored_filename || !doc?.parsed_payload_json) return doc;

  const originalName = doc.original_filename || doc.stored_filename;
  if (path.extname(originalName).toLowerCase() !== ".txt") return doc;

  const filePath = path.join(
    process.cwd(),
    "..",
    "runtime_uploads",
    "fatture-import",
    doc.stored_filename
  );

  if (!fs1.existsSync(filePath)) return doc;

  try {
    const parsedPayload =
      typeof doc.parsed_payload_json === "string"
        ? JSON.parse(doc.parsed_payload_json)
        : doc.parsed_payload_json;

    const rawText = fs1.readFileSync(filePath, "utf8");
    const enrichedPayload = enrichParsedPayloadWithTxtSummary(parsedPayload, rawText);

    return {
      ...doc,
      parsed_payload_json: JSON.stringify(enrichedPayload),
    };
  } catch (err) {
    console.error("Errore arricchimento riepilogo TXT:", err);
    return doc;
  }
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
  const raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }

  const parts = raw.split("/");
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

exports.saveRipartizionePdfRecord = async ({
  idUtenza,
  condominioId,
  fatturaId,
  periodKey,
  filename,
  filepath,
  trimestreLabel,
  dataLettura,
}) => {
  const columns = await getRipartizionePdfColumns();
  const insertColumns = [
    "id_utenza",
    "condominio_id",
    "period_key",
    "filename",
    "filepath",
    "trimestre_label",
    "data_lettura",
  ];
  const values = [
    idUtenza,
    condominioId || null,
    periodKey,
    filename,
    filepath,
    trimestreLabel || null,
    dataLettura || null,
  ];
  const updateColumns = [
    "condominio_id",
    "filename",
    "filepath",
    "trimestre_label",
    "data_lettura",
  ];

  if (columns.has("id_fattura")) {
    insertColumns.splice(2, 0, "id_fattura");
    values.splice(2, 0, fatturaId || null);
    updateColumns.splice(1, 0, "id_fattura");
  }

  await db.query(
    `
    INSERT INTO ripartizione_pdfs
      (${insertColumns.join(", ")})
    VALUES (${values.map(() => "?").join(", ")})
    ON DUPLICATE KEY UPDATE
      ${updateColumns.map((column) => `${column} = VALUES(${column})`).join(",\n      ")},
      created_at = CURRENT_TIMESTAMP
    `,
    values
  );
};

function makeSafeDateFolder(dataLettura) {
  if (!dataLettura) return "senza-data";

  // handles "12/01/2026"
  const parts = String(dataLettura).split("/");
  if (parts.length === 3) {
    const [dd, mm, yyyy] = parts;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  return String(dataLettura)
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-");
}

function getLogoColoratoDataUrl() {
  const candidateDirs = [
    path.join(__dirname, "..", "..", "..", "public", "images"),
    path.join(process.cwd(), "backend", "public", "images"),
    path.join(process.cwd(), "public", "images"),
  ];

  for (const imagesDir of candidateDirs) {
    if (!fs1.existsSync(imagesDir)) {
      continue;
    }

    const filename = fs1
      .readdirSync(imagesDir)
      .find((name) => /^logo_colorato\.(png|jpe?g|webp)$/i.test(name));

    if (!filename) {
      continue;
    }

    const ext = path.extname(filename).slice(1).toLowerCase();
    const mimeType = ext === "jpg" ? "jpeg" : ext;
    const filePath = path.join(imagesDir, filename);
    const base64 = fs1.readFileSync(filePath).toString("base64");

    return `data:image/${mimeType};base64,${base64}`;
  }

  return "";
}

function getRipartizioneLogoUrl(logoUrl) {
  return getLogoColoratoDataUrl() || logoUrl || "";
}

function compareRipartizionePdfRows(a, b) {
  const rowA = Number(a?.id_user ?? a?.id_utenza ?? 0);
  const rowB = Number(b?.id_user ?? b?.id_utenza ?? 0);

  if (rowA !== rowB) {
    return rowA - rowB;
  }

  return String(a?.id_utenza ?? "").localeCompare(String(b?.id_utenza ?? ""), "it", {
    numeric: true,
    sensitivity: "base",
  });
}

exports.getRipartizionePdfsByPeriod = async (periodKey, condominioId = null, fatturaId = null) => {
  const columns = await getRipartizionePdfColumns();
  if (fatturaId && !columns.has("id_fattura")) {
    return [];
  }

  const params = [periodKey];
  const condominioFilter = condominioId ? "AND condominio_id = ?" : "";
  const fatturaFilter = fatturaId ? "AND r.id_fattura = ?" : "";

  if (condominioId) {
    params.push(condominioId);
  }
  if (fatturaId) {
    params.push(fatturaId);
  }

  const [rows] = await db.query(
    `
    SELECT
      r.*,
      u.Interno,
      u.id_user
    FROM ripartizione_pdfs r
    LEFT JOIN utenze_v2 u
      ON u.id = r.id_utenza
    WHERE r.period_key = ?
      ${condominioFilter ? "AND r.condominio_id = ?" : ""}
      ${fatturaFilter}
    ORDER BY u.id_user ASC, r.id_utenza ASC
    `,
    params
  );

  return rows.sort(compareRipartizionePdfRows);
};

exports.listRipartizionePdfs = async ({ condominioId, fatturaId } = {}) => {
  const columns = await getRipartizionePdfColumns();
  if (fatturaId && !columns.has("id_fattura")) {
    return [];
  }

  const params = [];
  const where = [];

  if (condominioId) {
    where.push("r.condominio_id = ?");
    params.push(condominioId);
  }

  if (fatturaId) {
    where.push("r.id_fattura = ?");
    params.push(fatturaId);
  }

  const [rows] = await db.query(
    `
    SELECT
      r.id,
      r.id_utenza,
      r.condominio_id,
      ${columns.has("id_fattura") ? "r.id_fattura," : ""}
      r.period_key,
      r.filename,
      r.filepath,
      r.trimestre_label,
      r.data_lettura,
      r.created_at,


      u.Nome,
      u.Cognome,
      u.Interno,
      u.Scala,
      u.Isolato,
      u.id_user

    FROM ripartizione_pdfs r
    LEFT JOIN utenze_v2 u
      ON u.id = r.id_utenza

    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY r.period_key DESC, u.id_user ASC, r.id_utenza ASC
    `,
    params
  );

  return rows.sort((a, b) => {
    const periodCompare = String(b?.period_key ?? "").localeCompare(String(a?.period_key ?? ""));
    return periodCompare || compareRipartizionePdfRows(a, b);
  });
};

exports.getRipartizionePdfById = async (id, condominioId = null, fatturaId = null) => {
  const columns = await getRipartizionePdfColumns();
  if (fatturaId && !columns.has("id_fattura")) {
    return null;
  }

  const params = [id];
  const condominioFilter = condominioId ? "AND condominio_id = ?" : "";
  const fatturaFilter = fatturaId ? "AND id_fattura = ?" : "";

  if (condominioId) {
    params.push(condominioId);
  }
  if (fatturaId) {
    params.push(fatturaId);
  }

  const [rows] = await db.query(
    `
    SELECT
      id,
      id_utenza,
      condominio_id,
      ${columns.has("id_fattura") ? "id_fattura," : ""}
      period_key,
      filename,
      filepath,
      trimestre_label,
      data_lettura,
      created_at
    FROM ripartizione_pdfs
    WHERE id = ?
      ${condominioFilter}
      ${fatturaFilter}
    LIMIT 1
    `,
    params
  );

  return rows[0] || null;
};



async function processRipartizionePdfJob({
  jobId,
  rowsByUtenza,
  dettaglioByUtenza,
  trimestreLabel,
  dataLettura,
  logoUrl,
  condominioId,
  fatturaId,
  periodKey,
}) {
  await db.query(
    `
    UPDATE ripartizione_pdf_jobs
    SET status = 'processing'
    WHERE id = ?
    `,
    [jobId]
  );

  const uploadDir = path.join(
    process.cwd(),
    "storage",
    "ripartizioni",
    periodKey
  );

  await fs.mkdir(uploadDir, { recursive: true });

  const entries = Object.entries(rowsByUtenza);

  let processed = 0;
  let saved = 0;
  let failed = 0;
  const savedPdfParts = [];

  let browser;

  try {
    browser = await launchBrowser();

    for (const [idUtenza, utenzaRighe] of entries) {
      try {
        const dettaglio =
          dettaglioByUtenza?.[idUtenza] ||
          dettaglioByUtenza?.[String(idUtenza)] ||
          {};

        const pdfBufferRaw = await generateRipartizionePdfBuffer({
          browser,
          righe: utenzaRighe,
          dettaglioByUtenza: { [idUtenza]: dettaglio },
          trimestreLabel,
          dataLettura,
          logoUrl,
        });

        const pdfBuffer = Buffer.from(pdfBufferRaw);

        if (pdfBuffer.slice(0, 4).toString() !== "%PDF") {
          throw new Error(`PDF non valido per utenza ${idUtenza}`);
        }

        const filename = `ripartizione_utenza_${idUtenza}.pdf`;
        const relativePath = `/storage/ripartizioni/${periodKey}/${filename}`;
        const absolutePath = path.join(uploadDir, filename);

        await fs.writeFile(absolutePath, pdfBuffer);

        await exports.saveRipartizionePdfRecord({
          idUtenza,
          condominioId,
          fatturaId,
          periodKey,
          filename,
          filepath: relativePath,
          trimestreLabel,
          dataLettura,
        });

        await saveGeneratedDocument({
          condominioId,
          fatturaId,
          utenzaId: idUtenza,
          documentType: "bolletta_utente",
          filename,
          periodLabel: trimestreLabel || periodKey,
          buffer: pdfBuffer,
          replace: Boolean(fatturaId),
          metadata: {
            periodKey,
            periodLabel: trimestreLabel || periodKey,
            trimestreLabel,
            dataLettura,
            idUtenza,
          },
        });

        savedPdfParts.push({
          idUtenza,
          buffer: pdfBuffer,
        });

        saved += 1;
      } catch (error) {
        failed += 1;
        console.error(`Errore PDF utenza ${idUtenza}:`, error);
      } finally {
        processed += 1;

        await db.query(
          `
          UPDATE ripartizione_pdf_jobs
          SET processed = ?,
              saved = ?,
              failed = ?
          WHERE id = ?
          `,
          [processed, saved, failed, jobId]
        );
      }
    }

    if (savedPdfParts.length > 0) {
      const orderedParts = savedPdfParts.sort((a, b) => {
        const aRow = rowsByUtenza[a.idUtenza]?.[0];
        const bRow = rowsByUtenza[b.idUtenza]?.[0];
        const aOrder = Number(aRow?.utenza?.id_user ?? a.idUtenza ?? 0);
        const bOrder = Number(bRow?.utenza?.id_user ?? b.idUtenza ?? 0);
        return aOrder - bOrder;
      });
      const completeBuffer = await mergePdfBuffers(orderedParts.map((item) => item.buffer));

      await saveGeneratedDocument({
        condominioId,
        fatturaId,
        documentType: "bollette_complete",
        filename: `bollette_ripartizione_${periodKey}.pdf`,
        periodLabel: trimestreLabel || periodKey,
        buffer: completeBuffer,
        replace: Boolean(fatturaId),
        metadata: { periodKey, periodLabel: trimestreLabel || periodKey, trimestreLabel, dataLettura },
      });
    }

    await db.query(
      `
      UPDATE ripartizione_pdf_jobs
      SET status = 'done',
          processed = ?,
          saved = ?,
          failed = ?
      WHERE id = ?
      `,
      [processed, saved, failed, jobId]
    );
  } catch (error) {
    await db.query(
      `
      UPDATE ripartizione_pdf_jobs
      SET status = 'error',
          error_message = ?
      WHERE id = ?
      `,
      [error?.message || "Errore generazione PDF", jobId]
    );

    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
exports.getRipartizionePdfJob = async (jobId) => {
  const [rows] = await db.query(
    `
    SELECT
      id,
      condominio_id,
      period_key,
      status,
      total,
      processed,
      saved,
      failed,
      error_message,
      created_at,
      updated_at
    FROM ripartizione_pdf_jobs
    WHERE id = ?
    LIMIT 1
    `,
    [jobId]
  );

  return rows[0] || null;
};

function groupRowsByUtenza(righe) {
  return righe.reduce((acc, row) => {
    const idUtenza =
      row?.utenza?.id ||
      row?.id_utenza ||
      row?.idUtenza ||
      row?.utenza_id;

    if (!idUtenza) {
      console.warn("Riga senza id utenza:", row);
      return acc;
    }

    if (!acc[idUtenza]) acc[idUtenza] = [];
    acc[idUtenza].push(row);

    return acc;
  }, {});
}

function parseCalculationContextJson(value) {
  if (!value) return {};

  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return {};
  }
}

function allocateRoundedForDisplay(total, items, decimals = 2, weightGetter = null) {
  if (!items.length) return [];

  const factor = Math.pow(10, decimals);
  const totalUnits = Math.round(Math.abs(n2(total)) * factor);
  const sign = n2(total) < 0 ? -1 : 1;
  const weights = weightGetter
    ? items.map((item) => Math.max(0, n2(weightGetter(item))))
    : items.map(() => 1);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const safeWeights = weightTotal > 0 ? weights : items.map(() => 1);
  const safeWeightTotal = weightTotal > 0 ? weightTotal : items.length;
  const raw = safeWeights.map((weight) => (totalUnits * weight) / safeWeightTotal);
  const floored = raw.map(Math.floor);
  const assigned = floored.reduce((sum, value) => sum + value, 0);
  const remainder = totalUnits - assigned;
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);

  for (let i = 0; i < remainder; i += 1) {
    floored[order[i % order.length].index] += 1;
  }

  return floored.map((units) => sign * (units / factor));
}

async function enrichRipartizioneRowsWithSeparatedOneri(righe, fatturaId) {
  if (!fatturaId || !Array.isArray(righe) || !righe.length) {
    return righe;
  }

  const [[sessionRow]] = await db.query(
    `SELECT calculation_context_json FROM fatture_sessioni WHERE id = ? LIMIT 1`,
    [fatturaId]
  );
  const context = parseCalculationContextJson(sessionRow?.calculation_context_json);
  const parsedOneriNormale = round2(context.parsedOneriPerequazione);
  const parsedOneriAcconto = round2(context.parsedOneriPerequazioneAcconto);
  const clonedRows = righe.map((row) => ({ ...row, riga: { ...(row.riga || {}) } }));

  if (!parsedOneriNormale && !parsedOneriAcconto) {
    return clonedRows.map((row) => {
      row.riga.imp_oneri_base_display = n2(row?.riga?.imp_oneri ?? row?.imp_oneri);
      row.riga.imp_oneri_perequazione_display = 0;
      return row;
    });
  }

  const chargeableRows = clonedRows.filter((row) => n2(row?.riga?.imp_oneri ?? row?.imp_oneri) !== 0);
  const normaleShares = allocateRoundedForDisplay(parsedOneriNormale, chargeableRows);
  const accontoShares = allocateRoundedForDisplay(
    parsedOneriAcconto,
    chargeableRows,
    2,
    (row) => row?.riga?.consumo_normale ?? row?.consumo_normale
  );
  const shareByIndex = new Map();

  chargeableRows.forEach((row, index) => {
    shareByIndex.set(
      clonedRows.indexOf(row),
      round2(n2(normaleShares[index]) + n2(accontoShares[index]))
    );
  });

  return clonedRows.map((row, index) => {
    const originalOneri = n2(row?.riga?.imp_oneri ?? row?.imp_oneri);
    const perequazione = round2(shareByIndex.get(index) || 0);

    row.riga.imp_oneri_base_display = Math.max(0, round2(originalOneri - perequazione));
    row.riga.imp_oneri_perequazione_display = perequazione;
    return row;
  });
}

exports.startRipartizionePdfJob = async ({
  righe,
  dettaglioByUtenza,
  trimestreLabel,
  dataLettura,
  logoUrl,
  condominioId,
  fatturaId,
}) => {
  if (!Array.isArray(righe) || righe.length === 0) {
    const err = new Error("Nessuna riga disponibile per generare i PDF");
    err.statusCode = 400;
    throw err;
  }

  const enrichedRighe = await enrichRipartizioneRowsWithSeparatedOneri(righe, fatturaId);
  const rowsByUtenza = groupRowsByUtenza(enrichedRighe);
  const total = Object.keys(rowsByUtenza).length;
  const periodKey = makeSafeDateFolder(dataLettura);

  const [result] = await db.query(
    `
    INSERT INTO ripartizione_pdf_jobs
      (condominio_id, period_key, status, total, processed, saved, failed)
    VALUES (?, ?, 'pending', ?, 0, 0, 0)
    `,
    [condominioId || null, periodKey, total]
  );

  const jobId = result.insertId;

  processRipartizionePdfJob({
    jobId,
    rowsByUtenza,
    dettaglioByUtenza,
    trimestreLabel,
    dataLettura,
    logoUrl,
    condominioId,
    fatturaId,
    periodKey,
  }).catch(async (error) => {
    console.error("Errore job ripartizione PDF:", error);

    await db.query(
      `
      UPDATE ripartizione_pdf_jobs
      SET status = 'error',
          error_message = ?
      WHERE id = ?
      `,
      [error?.message || "Errore generazione PDF", jobId]
    );
  });

  return {
    id: jobId,
    status: "pending",
    total,
  };
};

exports.exportRipartizioniPerUtenza = async ({
  righe,
  dettaglioByUtenza,
  trimestreLabel,
  dataLettura,
  logoUrl,
  condominioId,
  fatturaId,
}) => {
  if (!Array.isArray(righe) || righe.length === 0) {
    const err = new Error("Nessuna riga disponibile per generare i PDF");
    err.statusCode = 400;
    throw err;
  }

  const enrichedRighe = await enrichRipartizioneRowsWithSeparatedOneri(righe, fatturaId);
  const rowsByUtenza = enrichedRighe.reduce((acc, row) => {
    const idUtenza =
      row?.utenza?.id ||
      row?.id_utenza ||
      row?.idUtenza ||
      row?.utenza_id;

    if (!idUtenza) {
      console.warn("Riga senza id utenza:", row);
      return acc;
    }

    if (!acc[idUtenza]) acc[idUtenza] = [];
    acc[idUtenza].push(row);

    return acc;
  }, {});

  const periodFolder = makeSafeDateFolder(dataLettura);

  const uploadDir = path.join(
    process.cwd(),
    "storage",
    "ripartizioni",
    periodFolder
  );

  await fs.mkdir(uploadDir, { recursive: true });

  const entries = Object.entries(rowsByUtenza);

  // Keep this low. Puppeteer is heavy.
  const limit = pLimit(3);

  const results = await Promise.all(
    entries.map(([idUtenza, utenzaRighe]) =>
      limit(async () => {
        try {
          const dettaglio =
            dettaglioByUtenza?.[idUtenza] ||
            dettaglioByUtenza?.[String(idUtenza)] ||
            {};

          const pdfBufferRaw = await generateRipartizionePdfBuffer({
            righe: utenzaRighe,
            dettaglioByUtenza: { [idUtenza]: dettaglio },
            trimestreLabel,
            dataLettura,
            logoUrl,
          });

          const pdfBuffer = Buffer.from(pdfBufferRaw);

          if (pdfBuffer.slice(0, 4).toString() !== "%PDF") {
            console.error(
              `PDF non valido per utenza ${idUtenza}:`,
              pdfBuffer.slice(0, 80).toString()
            );

            return {
              success: false,
              idUtenza,
              error: "PDF non valido",
            };
          }

          const filename = `ripartizione_utenza_${idUtenza}.pdf`;
          const relativePath = `/storage/ripartizioni/${periodFolder}/${filename}`;
          const absolutePath = path.join(uploadDir, filename);

          await fs.writeFile(absolutePath, pdfBuffer);

          await exports.saveRipartizionePdfRecord({
            idUtenza,
            condominioId,
            fatturaId,
            periodKey: periodFolder,
            filename,
            filepath: relativePath,
            trimestreLabel,
            dataLettura,
          });

          return {
            success: true,
            idUtenza,
            filename,
            filepath: relativePath,
            periodKey: periodFolder,
          };
        } catch (error) {
          console.error(`Errore PDF utenza ${idUtenza}:`, error);

          return {
            success: false,
            idUtenza,
            error: error?.message || "Errore generazione PDF",
          };
        }
      })
    )
  );

  const savedFiles = results.filter((r) => r.success);
  const failedFiles = results.filter((r) => !r.success);

  return {
    savedFiles,
    failedFiles,
    total: entries.length,
    saved: savedFiles.length,
    failed: failedFiles.length,
  };
};
async function generateRipartizionePdfBuffer({
  browser,
  righe,
  dettaglioByUtenza,
  trimestreLabel,
  dataLettura,
  logoUrl,
}) {
  const html = buildRipartizionePdfHtml({
    righe,
    dettaglioByUtenza,
    trimestreLabel: trimestreLabel || "",
    dataLettura: dataLettura || "",
    logoUrl: getRipartizioneLogoUrl(logoUrl),
  });

  let page;

  try {
    page = await browser.newPage();

    page.setDefaultNavigationTimeout(120000);
    page.setDefaultTimeout(120000);

    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      landscape: false,
      preferCSSPageSize: true,
      printBackground: true,
      margin: {
        top: "6mm",
        right: "6mm",
        bottom: "6mm",
        left: "6mm",
      },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    if (page) await page.close();
  }
}

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

  const originalName = doc.original_filename || doc.stored_filename;
  const extension = path.extname(originalName).toLowerCase();

  const allowedExtensions = [".pdf", ".txt"];

  if (!allowedExtensions.includes(extension)) {
    const err = new Error("Formato file non supportato. Sono accettati solo PDF o TXT.");
    err.statusCode = 400;
    throw err;
  }

  const contentType =
    extension === ".txt"
      ? "text/plain"
      : "application/pdf";

  const documentType =
    extension === ".txt"
      ? "txt"
      : "pdf";

  let parserResponse;
  let parsedPayload;
  let rawTxtContent = null;

  try {
    const form = new FormData();

    if (documentType === "txt") {
      rawTxtContent = fs1.readFileSync(filePath, "utf8");
    }

    form.append("file", fs1.createReadStream(filePath), {
      filename: originalName,
      contentType,
    });

    const parserUrl = getAiParserUrl(documentType);

    if (documentType === "pdf") {
      form.append("hydric_provider", process.env.FATTURE_AI_HYDRIC_PROVIDER || "abc");
    }

    const aiResponse = await axios.post(
      parserUrl,
      form,
      {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 400000,
      }
    );

    parserResponse = aiResponse?.data;
    parsedPayload =
      parserResponse && Object.prototype.hasOwnProperty.call(parserResponse, "data")
        ? parserResponse.data
        : parserResponse;

    if (!parsedPayload || typeof parsedPayload !== "object") {
      const err = new Error("Risposta parser non valida");
      err.statusCode = 500;
      throw err;
    }
  } catch (e) {
    console.error("parseImportedDocument AI error:", {
      status: e.response?.status,
      data: e.response?.data,
      url: e.config?.url,
      message: e.message,
    });

    throw buildAiParserError(e, documentType, getAiParserUrl(documentType));
  }

  enrichParsedPayloadWithTxtSummary(parsedPayload, rawTxtContent);

  const extractionErrors = formatExtractionErrors(parserResponse?.errors);
  const lettureSummary = deriveLettureSummary(parsedPayload.letture || []);
  const groupedLetture = groupLettureByTipo(parsedPayload.letture || []);
  const tariffeSummary = summarizeTariffeAcquedotto(
    parsedPayload.componente_tariffa_acquedotto || []
  );
  const depurazioneSum = summarizeImporto(
    parsedPayload.componente_tariffa_depurazione
  );
  const fognaturaSum = summarizeImporto(
    parsedPayload.componente_tariffa_fognatura
  );

  parsedPayload.letture_summary = lettureSummary || null;
  parsedPayload.grouped_letture = groupedLetture || null;
  parsedPayload.summaryTariffeAcquedotto = tariffeSummary || null;
  parsedPayload.totale_dep_fog = depurazioneSum + fognaturaSum;

  const validation = buildParsedInvoiceValidation(parsedPayload);

  if (parserResponse?.success === false) {
    validation.errors.push(
      ...(extractionErrors.length
        ? extractionErrors
        : ["Il parser non ha completato l'estrazione correttamente"])
    );
  } else if (extractionErrors.length) {
    validation.warnings.push(...extractionErrors);
  }

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
      parsedPayload?.fornitore_servizi || parsedPayload?.hydric_provider || null,
      parsedPayload?.bill_type || "unknown",
      toMysqlDate(firstPeriodo?.data_inizio) || null,
      toMysqlDate(lastPeriodo?.data_fine) || null,
      parsedPayload?.consumo_globale_mc ?? null,
      parsedPayload?.importo_totale_da_pagare ?? null,
      parserResponse?.extraction_method || "v1.0.0",
      getOverallConfidence(parserResponse?.confidence),
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
    document: updatedRows[0]?.[0] || null,
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

function n2(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function round2(x) {
  return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
}

function getMinimumPayableForRow(r) {
  const qf = n2(r.imp_qf);
  return round2(n2(r.imp_oneri) + qf + round2(qf * 0.10));
}

function getAvailableStornoReductionEuro(r) {
  return Math.max(0, round2(n2(r.base_totale) - getMinimumPayableForRow(r)));
}

function annotateMinimumPayableRow(row) {
  if (!row) return row;

  const minimum = getMinimumPayableForRow(row);
  const total = round2(n2(row.totale));
  const storno = round2(n2(row.storno_acconto ?? row.storno_totale));
  const explicitCredit = round2(n2(row._storno_credit_euro));
  const isCapped =
    explicitCredit > 0 ||
    (storno < 0 && total > 0 && Math.abs(total - minimum) <= 0.05);

  row.minimum_payable = minimum;
  row.minimum_payable_applied = isCapped ? 1 : 0;
  row.minimum_payable_credit_euro = explicitCredit;
  row.minimum_payable_credit_mc = round3(n2(row._storno_credit_mc));

  return row;
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

  let remainingEuroCap = round2(getAvailableStornoReductionEuro(row));
  let remainingMcCap = round3(Math.max(0, n2(row.consumo_normale)));

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

  row.storno_pregresso = round2(-usedEuro);
  row._storno_mc = round3(usedMc);
  row._storno_movements = movements;

  row.base_totale = round2(n2(row.base_totale) + n2(row.storno_pregresso));

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
    await ensureFattureSessionContextColumns();

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
    await ensureFattureRigheRecuperoColumns();

    const [sRows] = await conn.query(
      `SELECT * FROM fatture_sessioni WHERE id = ? AND id_condominio = ? LIMIT 1`,
      [sessionId, condominioId  ]
    );
    if (sRows.length === 0) throw new Error("Session not found");
    const session = sRows[0];

    const linkedImportedDocument = await getImportedDocumentLinkedToSession(conn, session);

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
        AND (
          stato = 'ATTIVA'
          OR (data_chiusura IS NOT NULL AND data_chiusura >= ?)
        )
        AND (data_attivazione IS NULL OR data_attivazione <= ?)
        AND (data_chiusura IS NULL OR data_chiusura >= ?)
      ORDER BY id_user ASC
      `,
      [session.id_condominio, start, end, start]
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
          COALESCE((
            SELECT SUM(m.importo_euro)
            FROM fatture_acconti_movimenti m
            WHERE m.id_riga_fattura = fr.id
              AND m.tipo_movimento = 'RETTIFICA_POS'
              AND m.note = 'Credito storno non applicato per minimo fatturabile'
          ), 0) AS minimum_payable_credit_euro,
          COALESCE((
            SELECT SUM(m.importo_mc)
            FROM fatture_acconti_movimenti m
            WHERE m.id_riga_fattura = fr.id
              AND m.tipo_movimento = 'RETTIFICA_POS'
              AND m.note = 'Credito storno non applicato per minimo fatturabile'
          ), 0) AS minimum_payable_credit_mc,
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
    righeRows.forEach(annotateMinimumPayableRow);
    const mapRighe = new Map(righeRows.map((r) => [r.id_utenza, r]));

    let grid = utenze.map((u) => ({
      utenza: u,
      attuale: mapAtt.get(u.id) || null,
      precedente: mapPrec.get(u.id) || null,  
      riga: mapRighe.get(u.id) || null,
      
    }));

    if (grid.length === 0 && righeRows.length > 0) {
      grid = righeRows.map((r) => ({
        utenza: {
          id: r.id_utenza,
          id_user: r.id_user,
          Nome: r.utente,
          Cognome: "",
          doppio_contatore: r.doppio_contatore,
        },
        attuale: {
          valore_lettura: r.lettura_attuale,
          stato_lettura: r.stato_attuale,
        },
        precedente: {
          valore_lettura: r.lettura_precedente,
          stato_lettura: r.stato_precedente,
        },
        riga: r,
      }));
    }

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
      linkedImportedDocument,
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
  giorniCasa,
  tfCode,
  manualConsumptions
 
}) {
  assertUUID(sessionId, "sessionId");
  await ensureFattureSessionContextColumns();
 
  
  const conn = await db.getConnection();
  try {
    await conn.query(
      `
      UPDATE fatture_sessioni
      SET
        giorni_qf = COALESCE(?, giorni_qf),
        giorni_consumi = COALESCE(?, giorni_consumi),
        giorni_acconto = COALESCE(?, giorni_acconto),
        varie = COALESCE(?, varie),
        data_fattura = COALESCE(?, data_fattura),
        data_casa_idrica = COALESCE(?, data_casa_idrica),
        giorni_interni = COALESCE(?, giorni_interni),
        tot_acquedotto = COALESCE(?, tot_acquedotto),
        mcAcconto  = COALESCE(?, mcAcconto),
        mcStorno = COALESCE(?, mcStorno),
        tf_code = COALESCE(?, tf_code),
        manual_consumptions_json = COALESCE(?, manual_consumptions_json)
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
        tfCode !== undefined && tfCode !== null && tfCode !== ""
          ? normalizeTfCode(tfCode)
          : null,
        manualConsumptions !== undefined
          ? JSON.stringify(manualConsumptions || {})
          : null,
        sessionId,
      ]
    );

    const [rows] = await conn.query(`SELECT * FROM fatture_sessioni WHERE id = ? LIMIT 1`, [
      sessionId,
    ]);
    if (!rows.length) {
      throw new Error("Sessione fatturazione non trovata");
    }

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
  await ensureFattureRigheRecuperoColumns();

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
      COALESCE((
        SELECT SUM(m.importo_euro)
        FROM fatture_acconti_movimenti m
        WHERE m.id_riga_fattura = fr.id
          AND m.tipo_movimento = 'RETTIFICA_POS'
          AND m.note = 'Credito storno non applicato per minimo fatturabile'
      ), 0) AS minimum_payable_credit_euro,
      COALESCE((
        SELECT SUM(m.importo_mc)
        FROM fatture_acconti_movimenti m
        WHERE m.id_riga_fattura = fr.id
          AND m.tipo_movimento = 'RETTIFICA_POS'
          AND m.note = 'Credito storno non applicato per minimo fatturabile'
      ), 0) AS minimum_payable_credit_mc,
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
  
  righeRows.forEach(annotateMinimumPayableRow);
  righeRows.dettaglio_consumi = interniTotals?.dettaglio_consumi;
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
    const y = Number(pa.period_year || new Date().getFullYear());
    const m = Number(pa.period_month || 1);
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

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
      `
      SELECT nucleo
      FROM utenze_v2
      WHERE condominio_id = ?
        AND (
          stato = 'ATTIVA'
          OR (data_chiusura IS NOT NULL AND data_chiusura >= ?)
        )
        AND (data_attivazione IS NULL OR data_attivazione <= ?)
        AND (data_chiusura IS NULL OR data_chiusura >= ?)
      `,
      [session.id_condominio, start, end, start]
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
async function calculateInterni(
  conn,
  session,
  generale,
  tfCode,
  annoAtt,
  annoPrec = null,
  eurStorno = 0,
  totaleParsedWithOneri,
  parsedOneriPerequazione = null,
  parsedOneriPerequazioneAcconto = null,
  parsedAccontoImporto = null,
  parsedAccontoDepFog = null,
  parsedAccontoTotale = null
) {
  await ensureFattureRigheRecuperoColumns();

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

  const allocateEqualRounded = (total, items, decimals = 2) => {
    if (!items.length) {
      return [];
    }

    const factor = Math.pow(10, decimals);
    const share = Math.round((n2(total) / items.length) * factor) / factor;

    return items.map(() => share);
  };

  const allocateByWeightWithCapacity = (total, items, getWeight, getCapacity, decimals = 2) => {
    const factor = Math.pow(10, decimals);
    const targetUnits = Math.round(Math.max(0, n2(total)) * factor);
    const allocations = items.map(() => 0);
    const capacityUnits = items.map((item) =>
      Math.max(0, Math.round(n2(getCapacity(item)) * factor))
    );

    if (!items.length || targetUnits <= 0) {
      return items.map(() => 0);
    }

    let remaining = Math.min(
      targetUnits,
      capacityUnits.reduce((sum, value) => sum + value, 0)
    );
    let guard = 0;

    while (remaining > 0 && guard < items.length * 4 + 10) {
      guard += 1;
      const active = items
        .map((item, index) => ({
          item,
          index,
          capLeft: capacityUnits[index] - allocations[index],
          weight: Math.max(0, n2(getWeight(item))),
        }))
        .filter((entry) => entry.capLeft > 0);

      if (!active.length) break;

      const weightTotal = active.reduce((sum, entry) => sum + entry.weight, 0);
      const safeWeight = weightTotal > 0 ? weightTotal : active.length;
      const planned = active.map((entry) => {
        const raw = (remaining * (weightTotal > 0 ? entry.weight : 1)) / safeWeight;
        const units = Math.min(entry.capLeft, Math.floor(raw));
        return {
          ...entry,
          units,
          frac: raw - Math.floor(raw),
        };
      });

      let assigned = 0;
      for (const entry of planned) {
        if (entry.units <= 0) continue;
        allocations[entry.index] += entry.units;
        assigned += entry.units;
      }

      remaining -= assigned;
      if (remaining <= 0) break;

      const remainderOrder = planned
        .filter((entry) => capacityUnits[entry.index] - allocations[entry.index] > 0)
        .sort((a, b) => b.frac - a.frac);

      if (!remainderOrder.length) break;

      for (const entry of remainderOrder) {
        if (remaining <= 0) break;
        if (capacityUnits[entry.index] - allocations[entry.index] <= 0) continue;
        allocations[entry.index] += 1;
        remaining -= 1;
      }
    }

    return allocations.map((units) => units / factor);
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
        AND (
          u.stato = 'ATTIVA'
          OR (u.data_chiusura IS NOT NULL AND u.data_chiusura >= ?)
        )
        AND (u.data_attivazione IS NULL OR u.data_attivazione <= ?)
        AND (u.data_chiusura IS NULL OR u.data_chiusura >= ?)
      ORDER BY u.id ASC
      `,
      [session.id_condominio, start, end, start]
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
    const hasParsedOneri = parsedOneriPerequazione !== null || parsedOneriPerequazioneAcconto !== null;
    const parsedOneriNormale = hasParsedOneri ? round2(n2(parsedOneriPerequazione)) : null;
    const parsedOneriAcconto = hasParsedOneri ? round2(n2(parsedOneriPerequazioneAcconto)) : null;
    let parsedOneriRemainder = 0;

    // -------------------------------------------------------------------
    // PASS 1: build base rows
    // -------------------------------------------------------------------

    const dettaglio_consumi = [];
    let dettaglioConsumiAcquedotto = [];
    let manualConsumptions = {};
    try {
      manualConsumptions =
        typeof session.manual_consumptions_json === "string"
          ? JSON.parse(session.manual_consumptions_json || "{}")
          : session.manual_consumptions_json || {};
    } catch {
      manualConsumptions = {};
    }

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

      let consumoSomma = 0;
      let haveAny = false;
      let recuperoLettura = false;
      let sostituzioneContatore = false;
      const recuperoNotes = [];
      const adjustedCurrentReadings = new Map();
      const recuperoByUtenza = new Map();
      const recuperoNoteByUtenza = new Map();

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
          const currentValue = n2(a);
          const previousValue = n2(p);
          const stato = upper(ra?.stato_lettura, "");

          if (currentValue < previousValue) {
            if (stato === "S") {
              consumoSomma += currentValue;
              sostituzioneContatore = true;
              adjustedCurrentReadings.set(gx.id, currentValue);
            } else {
              recuperoLettura = true;
              adjustedCurrentReadings.set(gx.id, previousValue);
              recuperoByUtenza.set(gx.id, true);
              consumoSomma += 0;
              const note = `Lettura attuale inferiore alla precedente su interno ${gx.Interno || gx.id}: recupero applicato`;
              recuperoNotes.push(note);
              recuperoNoteByUtenza.set(gx.id, note);
            }
          } else {
            consumoSomma += currentValue - previousValue;
            adjustedCurrentReadings.set(gx.id, currentValue);
          }
        }
      }

      const adjustedFirstAtt = adjustedCurrentReadings.has(first.id)
        ? adjustedCurrentReadings.get(first.id)
        : (ra0?.valore_lettura ?? null);

      let consumoNorm = null;
      if (haveAny) {
        consumoNorm = round3(consumoSomma);
      } else if (ra0?.valore_lettura != null && rp0?.valore_lettura != null) {
        const currentValue = n2(ra0?.valore_lettura);
        const previousValue = n2(rp0?.valore_lettura);
        const stato = upper(statoAtt, "");

        if (currentValue < previousValue) {
          if (stato === "S") {
            consumoNorm = round3(currentValue);
            sostituzioneContatore = true;
          } else {
            consumoNorm = 0;
            recuperoLettura = true;
            recuperoNotes.push("Lettura attuale inferiore alla precedente: recupero applicato");
            recuperoByUtenza.set(first.id, true);
            recuperoNoteByUtenza.set(first.id, "Lettura attuale inferiore alla precedente: recupero applicato");
          }
        } else {
          consumoNorm = round3(currentValue - previousValue);
        }
      }

      let flatTipo = "NORMAL";
      if (upper(group[0].Tipo, "") === "SPECIAL") {
        consumoNorm = 0;
        flatTipo = "SPECIAL";
      }

      const manualConsumptionValue = manualConsumptions?.[first.id];
      const hasManualConsumption =
        upper(statoAtt, "") === "Y" &&
        manualConsumptionValue !== undefined &&
        manualConsumptionValue !== null &&
        manualConsumptionValue !== "" &&
        Number.isFinite(Number(manualConsumptionValue)) &&
        Number(manualConsumptionValue) >= 0;

      if (hasManualConsumption) {
        consumoNorm = round3(Number(manualConsumptionValue));
      }

      const consumoTot = consumoNorm;

      const categoriaCodice = upper(first.categoria_tariffa, "RESIDENTE");
      const tariff = await loadTariffeABC(conn, { anno, categoriaCodice, tfCode });

      const nucleo = Math.max(1, n2(first.nucleo));
      const nuaeU = Math.max(1, n2(first.nuae));

      //qui potremmo aggiornare consumoNorm e assegnare una percentuale (60 con tariffe 2024, 40 con tariffe 2025) da addebitare a cavallo di due periodi.

      let impAcq = 0;
      
      let user_id = ra0?.id_utenza ?? first.id;

       
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
        lettura_attuale: adjustedFirstAtt,
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
        recupero_lettura: recuperoLettura ? 1 : 0,
        recupero_note: recuperoLettura
          ? recuperoNotes.join("; ")
          : sostituzioneContatore
          ? "Contatore sostituito: consumo calcolato dalla lettura attuale"
          : null,

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
            lettura_attuale: adjustedCurrentReadings.has(gk.id)
              ? adjustedCurrentReadings.get(gk.id)
              : (rak?.valore_lettura ?? null),
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
            recupero_lettura: recuperoByUtenza.get(gk.id) ? 1 : 0,
            recupero_note: recuperoNoteByUtenza.get(gk.id) || null,

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

    const hasParsedAccontoImporto =
      parsedAccontoImporto !== null &&
      parsedAccontoImporto !== undefined &&
      Number.isFinite(Number(parsedAccontoImporto)) &&
      n2(parsedAccontoImporto) > 0;
    const hasParsedAccontoDepFog =
      parsedAccontoDepFog !== null &&
      parsedAccontoDepFog !== undefined &&
      Number.isFinite(Number(parsedAccontoDepFog));
    const hasParsedAccontoTotale =
      parsedAccontoTotale !== null &&
      parsedAccontoTotale !== undefined &&
      Number.isFinite(Number(parsedAccontoTotale)) &&
      n2(parsedAccontoTotale) > 0;

    const totAccEuro = round2(
      hasParsedAccontoTotale ? n2(parsedAccontoTotale) : n2(generale.totAcc ?? 0)
    );
    const totConsAccMc = round3(n2(generale.consumoAcconto ?? 0));
    const totImpConsAcc = round2(
      hasParsedAccontoImporto ? n2(parsedAccontoImporto) : n2(generale.impConsAcc ?? 0)
    );
    const totDepFogAcc = round2(
      hasParsedAccontoDepFog ? n2(parsedAccontoDepFog) : n2(generale.depFogAcc ?? 0)
    );

    // invoice-facing storno should be NEGATIVE
    const totStornoCalcolato = round2(n2(eurStorno ?? 0));

    const moneyWeightFn = (r) => Math.max(0, round2(n2(r.base_totale) - n2(r.imp_oneri)));
    const mcWeightFn = (r) => Math.max(0, n2(r.consumo_normale));

    if (hasParsedOneri) {
      const oneriNormaleShares = allocateEqualRounded(
        parsedOneriNormale,
        primaries,
        2
      );

      for (let i = 0; i < primaries.length; i++) {
        const r = primaries[i];
        const share = round2(oneriNormaleShares[i] || 0);

        r.imp_oneri = round2(n2(r.imp_oneri) + share);
        r.base_totale = round2(n2(r.base_totale) + share);
      }
    }

    const accEuroShares = allocateByWeight(totAccEuro, primaries, mcWeightFn, 2);
    const impConsAccShares = allocateByWeight(
      totImpConsAcc > 0 ? totImpConsAcc : totAccEuro,
      primaries,
      mcWeightFn,
      2
    );
    const depFogAccShares = allocateByWeight(totDepFogAcc, primaries, mcWeightFn, 2);
    const totIvaAcc = round2(
      Math.max(
        0,
        n2(totAccEuro) -
          n2(totImpConsAcc) -
          n2(totDepFogAcc) -
          (hasParsedOneri ? n2(parsedOneriAcconto) : 0)
      )
    );
    const ivaAccShares = allocateByWeight(totIvaAcc, primaries, mcWeightFn, 2);
    const accMcShares = allocateByWeight(totConsAccMc, primaries, mcWeightFn, 3);
    const oneriAccShares = hasParsedOneri
      ? allocateByWeight(parsedOneriAcconto, primaries, mcWeightFn, 2)
      : primaries.map(() => 0);
    const accontoTotaleIncludesParsedOneri = hasParsedAccontoTotale && hasParsedOneri;

    for (let i = 0; i < primaries.length; i++) {
      const r = primaries[i];
      const oneriAccShare = round2(oneriAccShares[i] || 0);

      r.acconto = round2(
        n2(accEuroShares[i] || 0) +
          (accontoTotaleIncludesParsedOneri ? 0 : oneriAccShare)
      );
      r.imp_acconto = round2(impConsAccShares[i] || 0);
      r.depfog_acconto = round2(depFogAccShares[i] || 0);
      r.consumo_acconto = round3(accMcShares[i] || 0);
      r.imp_oneri = round2(n2(r.imp_oneri) + oneriAccShare);
      r.imp_iva = round2(n2(r.imp_iva) + n2(ivaAccShares[i] || 0));

      const basePrimaStorno = round2(
        n2(r.base_totale) +
        n2(r.imp_acconto) +
        n2(r.depfog_acconto) +
        oneriAccShare +
        n2(ivaAccShares[i] || 0)
      );

      r._base_prima_storno = basePrimaStorno;
      r.storno_calcolato = 0;
      r._storno_calcolato_mc = 0;
      r._storno_credit_euro = 0;
      r._storno_credit_mc = 0;
      r.base_totale = basePrimaStorno;
    }

    if (totStornoCalcolato < 0) {
      const requestedReduction = round2(Math.abs(totStornoCalcolato));
      const totalCapacity = round2(
        primaries.reduce((sum, r) => sum + getAvailableStornoReductionEuro(r), 0)
      );
      const appliedReductionTotal = Math.min(requestedReduction, totalCapacity);
      const totalStornoMc = Math.abs(n2(session.mcStorno ?? 0));
      const appliedMcTotal =
        requestedReduction > 0
          ? round3((totalStornoMc * appliedReductionTotal) / requestedReduction)
          : 0;
      const appliedReductionShares = allocateByWeightWithCapacity(
        appliedReductionTotal,
        primaries,
        moneyWeightFn,
        getAvailableStornoReductionEuro,
        2
      );
      const appliedMcShares = allocateByWeight(
        appliedMcTotal,
        appliedReductionShares.map((share) => ({ share })),
        (item) => n2(item.share),
        3
      );
      const unappliedReductionTotal = round2(requestedReduction - appliedReductionTotal);
      const unappliedReductionShares =
        unappliedReductionTotal > 0
          ? allocateByWeight(unappliedReductionTotal, primaries, moneyWeightFn, 2)
          : primaries.map(() => 0);
      const unappliedMcShares =
        unappliedReductionTotal > 0
          ? allocateByWeight(
              round3(
                totalStornoMc - appliedMcShares.reduce((sum, value) => sum + n2(value), 0)
              ),
              primaries,
              moneyWeightFn,
              3
            )
          : primaries.map(() => 0);

      for (let i = 0; i < primaries.length; i++) {
        const r = primaries[i];
        const appliedReduction = round2(appliedReductionShares[i] || 0);

        r.storno_calcolato = round2(-appliedReduction);
        r._storno_calcolato_mc = round3(appliedMcShares[i] || 0);
        r._storno_credit_euro = round2(unappliedReductionShares[i] || 0);
        r._storno_credit_mc = round3(unappliedMcShares[i] || 0);
        r.base_totale = round2(n2(r._base_prima_storno) + n2(r.storno_calcolato));
      }
    } else {
      const positiveStornoShares = allocateByWeight(totStornoCalcolato, primaries, moneyWeightFn, 2);
      for (let i = 0; i < primaries.length; i++) {
        const r = primaries[i];
        r.storno_calcolato = round2(positiveStornoShares[i] || 0);
        r.base_totale = round2(n2(r._base_prima_storno) + n2(r.storno_calcolato));
      }
    }

    totaleOneri = round2(rows.reduce((s, r) => s + n2(r.imp_oneri), 0));
    parsedOneriRemainder = hasParsedOneri
      ? round2(n2(parsedOneriNormale) + n2(parsedOneriAcconto) - totaleOneri)
      : 0;
    generale.totaleOneri = totaleOneri;

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

    if (
      hasParsedOneri &&
      parsedOneriRemainder !== 0 &&
      ["TF2", "TF3"].includes(upper(tfCode, "TF1"))
    ) {
      const tfCodeUpper = upper(tfCode, "TF1");
      const tfEligibleRows = primaries.filter(
        (r) => r.tfEligible && n2(r.consumo_totale) > 0
      );
      const remainderShares =
        tfCodeUpper === "TF2"
          ? allocateByWeight(parsedOneriRemainder, tfEligibleRows, () => 1, 2)
          : allocateByWeight(parsedOneriRemainder, tfEligibleRows, mcWeightFn, 2);

      for (let i = 0; i < tfEligibleRows.length; i++) {
        tfEligibleRows[i].conguaglio = round2(
          n2(tfEligibleRows[i].conguaglio) + n2(remainderShares[i] || 0)
        );
      }
    }

    for (const r of rows) {
      const minimumPayable = getMinimumPayableForRow(r);
      const beforeRound = round2(n2(r.base_totale) + n2(r.conguaglio));

      if (beforeRound < minimumPayable) {
        r._minimum_payable_adjustment = round2(minimumPayable - beforeRound);
        r.conguaglio = round2(n2(r.conguaglio) + n2(r._minimum_payable_adjustment));
      } else {
        r._minimum_payable_adjustment = 0;
      }
    }

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
         imp_acconto, depfog_acconto, acconto, storno_acconto,
         recupero_lettura, recupero_note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          r.recupero_lettura ? 1 : 0,
          r.recupero_note || null,
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

      if (n2(r._storno_credit_euro) > 0 || n2(r._storno_credit_mc) > 0) {
        await conn.query(
          `
          INSERT INTO fatture_acconti_movimenti
          (id, id_utenza, id_fattura, id_riga_fattura,
           tipo_movimento, importo_euro, importo_mc, source_movimento_id, note)
          VALUES (?, ?, ?, ?, 'RETTIFICA_POS', ?, ?, NULL, ?)
          `,
          [
            uuid(),
            r.id_utenza,
            session.id,
            r.id_riga_fattura,
            round2(n2(r._storno_credit_euro)),
            round3(n2(r._storno_credit_mc)),
            'Credito storno non applicato per minimo fatturabile',
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
    rows.forEach(annotateMinimumPayableRow);
 
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
      tfCode: normalizeTfCode(tfCode),
    };
  } catch (err) {
    throw err;
  }
}
exports.calculateSession = async function ({
  sessionId,
  tfCode,
  annoAtt,
  annoPrec = null,
  eurStorno = 0,
  parsedQF = null,
  parsedAccontoImporto = null,
  parsedAccontoDepFog = null,
  parsedAccontoTotale = null,
  parsedOneriPerequazione = null,
  parsedOneriPerequazioneAcconto = null,
  totaleParsedWithOneri = 0,
  importedDocumentId = null,
  calculationContext = null,
}) {

  assertUUID(sessionId, "sessionId");

  let conn;
  try {
    await ensureFattureSessionContextColumns();
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
    const effectiveTfCode = normalizeTfCode(
      tfCode || calculationContext?.tfCode,
      session.tf_code || "TF1"
    );
    console.log("calculateSession TF", {
      sessionId,
      requestTfCode: tfCode,
      previousTfCode: session.tf_code,
      effectiveTfCode,
    });
    const resolvedImportedDocumentId =
      importedDocumentId ?? calculationContext?.importedDocumentId ?? null;
    let resolvedEurStorno = eurStorno;
    let resolvedMcStorno = calculationContext?.mcStorno ?? session.mcStorno;
    let resolvedStornoSource = "request";

    if (resolvedImportedDocumentId) {
      const [docRows] = await conn.query(
        `SELECT * FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
        [resolvedImportedDocumentId]
      );
      const importedDoc = docRows[0] ? enrichImportedDocumentWithStoredTxtSummary(docRows[0]) : null;
      let importedPayload = null;

      try {
        importedPayload =
          typeof importedDoc?.parsed_payload_json === "string"
            ? JSON.parse(importedDoc.parsed_payload_json)
            : importedDoc?.parsed_payload_json || null;
      } catch {
        importedPayload = null;
      }

      const stornoFromDoc = getStornoValuesFromParsedPayload(importedPayload);
      if (stornoFromDoc.euro !== 0 || stornoFromDoc.mc !== 0) {
        resolvedEurStorno = stornoFromDoc.euro;
        resolvedMcStorno = stornoFromDoc.mc;
        resolvedStornoSource = stornoFromDoc.source;
      }
    }

    console.log("calculateSession storno resolved", {
      sessionId,
      requestEurStorno: eurStorno,
      resolvedEurStorno,
      resolvedMcStorno,
      resolvedStornoSource,
      importedDocumentId: resolvedImportedDocumentId,
    });

    const calculationContextJson = calculationContext
      ? JSON.stringify({
          ...calculationContext,
          tfCode: effectiveTfCode,
          importedDocumentId: resolvedImportedDocumentId,
          eurStorno: resolvedEurStorno,
          mcStorno: resolvedMcStorno,
          stornoSource: resolvedStornoSource,
          savedAt: new Date().toISOString(),
        })
      : null;

    session.mcStorno = resolvedMcStorno;
    const generaleResult = await calculateGenerale(conn, sessionId, annoAtt, annoPrec, resolvedEurStorno, parsedQF);
 
    const g = generaleResult.generale;
 
    session.consumoNorm = generaleResult.meta.consumoNorm;

    const interniTotals = await calculateInterni(
      conn,
      session,
      g,
      effectiveTfCode,
      annoAtt,
      annoPrec,
      resolvedEurStorno,
      totaleParsedWithOneri,
      parsedOneriPerequazione,
      parsedOneriPerequazioneAcconto,
      parsedAccontoImporto,
      parsedAccontoDepFog,
      parsedAccontoTotale
    );
    
    
    await conn.query(
      `
      UPDATE fatture_sessioni
      SET
        stato = 'CALCOLATA',
        tf_code = ?,
        imported_document_id = COALESCE(?, imported_document_id),
        calculation_context_json = COALESCE(?, calculation_context_json),
        calculation_context_updated_at = CASE WHEN ? IS NULL THEN calculation_context_updated_at ELSE NOW() END,
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
        effectiveTfCode,
        resolvedImportedDocumentId === undefined || resolvedImportedDocumentId === null || resolvedImportedDocumentId === ""
          ? null
          : Number(resolvedImportedDocumentId),
        calculationContextJson,
        calculationContextJson,
        g.impAcquedotto,
        g.depFog,
        0,
        g.qfTot,
        g.iva,
        interniTotals.totOneri,
        round2(n2(g.totale) + n2(interniTotals.totOneri)),
        sessionId,
      ]
    );

    const [tfRows] = await conn.query(
      `
      SELECT
        tf_code,
        imported_document_id,
        calculation_context_json IS NOT NULL AS has_calculation_context
      FROM fatture_sessioni
      WHERE id = ?
      LIMIT 1
      `,
      [sessionId]
    );
    console.log("calculateSession TF persisted", {
      sessionId,
      persistedTfCode: tfRows[0]?.tf_code,
      importedDocumentId: tfRows[0]?.imported_document_id,
      hasCalculationContext: !!tfRows[0]?.has_calculation_context,
    });

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
    await ensureFattureSessionContextColumns();

    const [rows] = await conn.query(
      `
      SELECT
        fs.*,
        pa.period_year AS periodo_attuale_anno,
        pa.period_month AS periodo_attuale_mese,
        pp.period_year AS periodo_precedente_anno,
        pp.period_month AS periodo_precedente_mese,
        COALESCE(iid.id, iid_legacy.id) AS linked_imported_document_id,
        COALESCE(iid.original_filename, iid_legacy.original_filename) AS linked_imported_original_filename,
        COALESCE(iid.numero_bolletta, iid_legacy.numero_bolletta) AS linked_imported_numero_bolletta,
        COALESCE(iid.data_inizio_periodo, iid_legacy.data_inizio_periodo) AS linked_imported_data_inizio_periodo,
        COALESCE(iid.data_fine_periodo, iid_legacy.data_fine_periodo) AS linked_imported_data_fine_periodo,
        COALESCE(iid.importo_totale_da_pagare, iid_legacy.importo_totale_da_pagare) AS linked_imported_importo_totale_da_pagare
      FROM fatture_sessioni fs
      LEFT JOIN letture_sessioni pa ON pa.id = fs.id_periodo_attuale
      LEFT JOIN letture_sessioni pp ON pp.id = fs.id_periodo_precedente
      LEFT JOIN imported_invoice_documents iid ON iid.id = fs.imported_document_id
      LEFT JOIN (
        SELECT
          CONVERT(linked_session_id USING utf8mb4) COLLATE utf8mb4_general_ci AS linked_session_id,
          MAX(id) AS imported_document_id
        FROM imported_invoice_documents
        WHERE linked_session_id IS NOT NULL
        GROUP BY CONVERT(linked_session_id USING utf8mb4) COLLATE utf8mb4_general_ci
      ) legacy_link ON legacy_link.linked_session_id =
        CONVERT(fs.id USING utf8mb4) COLLATE utf8mb4_general_ci
      LEFT JOIN imported_invoice_documents iid_legacy ON iid_legacy.id = legacy_link.imported_document_id
      WHERE fs.id_condominio = ?
      ORDER BY pa.period_year DESC, pa.period_month DESC, fs.created_at DESC
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

  const parseOptionalReading = (value, name) => {
    if (value === undefined || value === null || value === "") {
      return { shouldUpdate: false, value: null };
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`${name} non valido`);
    }

    return { shouldUpdate: true, value: parsed };
  };

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const precedenteParsed = parseOptionalReading(precedente, "Lettura precedente");
    const attualeParsed = parseOptionalReading(attuale, "Lettura attuale");

    const [sRows] = await conn.query(
      `SELECT * FROM fatture_sessioni WHERE id = ? FOR UPDATE`,
      [sessionId]
    );

    if (sRows.length === 0) throw new Error("Session not found");

    const session = sRows[0];

    if (session.stato === "CONFERMATA") {
      throw new Error("Session confirmed, cannot modify readings");
    }

    if (precedenteParsed.shouldUpdate) {
      await conn.query(
        `UPDATE letture_sessioni
         SET contatore_generale_valore = ?
         WHERE id = ?`,
        [precedenteParsed.value, session.id_periodo_precedente]
      );
    }

    if (attualeParsed.shouldUpdate) {
      await conn.query(
        `UPDATE letture_sessioni
         SET contatore_generale_valore = ?
         WHERE id = ?`,
        [attualeParsed.value, session.id_periodo_attuale]
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
  // TF2 = equal distribution across eligible users
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
  // TF3 = proportional distribution by each eligible user's consumption
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

  const docRows = rows[0] || [];
  const doc = docRows[0] || null;
  if (!doc) {
    const err = new Error("Documento importato non trovato");
    err.statusCode = 404;
    throw err;
  }

  return { ok: true, document: [enrichImportedDocumentWithStoredTxtSummary(doc)] };
}

async function mergePdfBuffers(buffers) {
  const mergedPdf = await PDFDocument.create();

  for (const buffer of buffers) {
    const sourcePdf = await PDFDocument.load(buffer);
    const copiedPages = await mergedPdf.copyPages(
      sourcePdf,
      sourcePdf.getPageIndices()
    );
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  return Buffer.from(await mergedPdf.save());
}

exports.getLatestGeneratedDocument = getLatestGeneratedDocument;
exports.getGeneratedDocumentById = getGeneratedDocumentById;
exports.getGeneratedDocumentBuffer = async (document) => getPdfFromR2(document.r2_key);
exports.listGeneratedDocuments = listGeneratedDocuments;

exports.deleteImportedDocument = async function (id) {
  const conn = await db.getConnection();
  let doc = null;

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `
      SELECT id, stored_filename, original_filename
      FROM imported_invoice_documents
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [id]
    );

    doc = rows[0] || null;

    if (!doc) {
      const err = new Error("Documento importato non trovato");
      err.statusCode = 404;
      throw err;
    }

    await conn.query(
      `DELETE FROM imported_invoice_documents WHERE id = ?`,
      [id]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  let deletedFile = false;

  if (doc?.stored_filename) {
    const uploadDir = path.resolve(process.cwd(), "..", "runtime_uploads", "fatture-import");
    const filePath = path.resolve(uploadDir, doc.stored_filename);
    const isInsideUploadDir =
      filePath.toLowerCase().startsWith(`${uploadDir.toLowerCase()}${path.sep}`);

    if (isInsideUploadDir && fs1.existsSync(filePath)) {
      try {
        fs1.unlinkSync(filePath);
        deletedFile = true;
      } catch (fileErr) {
        console.error("Errore eliminazione file importato:", fileErr);
      }
    }
  }

  return {
    ok: true,
    deletedId: id,
    deletedFile,
    originalFilename: doc?.original_filename || null,
  };
}

exports.updateImportedDocumentParsedResult = async function (id, payload) {
  const existingRows = await db.query(
    `SELECT id FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
    [id]
  );
  const existingDocRows = existingRows[0] || [];

  if (!existingDocRows.length) {
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

  const docRows = rows[0] || [];
  return { ok: true, document: docRows[0] || null };
}

exports.linkImportedDocumentToSession = async function (id, sessionId) {
  if (!sessionId) {
    throw new Error("sessionId mancante");
  }
  await ensureFattureSessionContextColumns();

  const [existingRows] = await db.query(
    `SELECT id FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
    [id]
  );

  if (!existingRows.length) {
    const err = new Error("Documento importato non trovato");
    err.statusCode = 404;
    throw err;
  }

  await db.query(
    `
    UPDATE imported_invoice_documents
    SET linked_session_id = NULL
    WHERE CONVERT(linked_session_id USING utf8mb4) COLLATE utf8mb4_general_ci =
      CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_general_ci
      AND id <> ?
    `,
    [sessionId, id]
  );

  const [sessionUpdate] = await db.query(
    `
    UPDATE fatture_sessioni
    SET imported_document_id = ?
    WHERE id = ?
    `,
    [id, sessionId]
  );

  if (!sessionUpdate.affectedRows) {
    throw new Error("Sessione fatturazione non trovata per associazione documento");
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

  const [rows] = await db.query(
    `SELECT * FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
    [id]
  );

  return { ok: true, document: rows[0] || null };
}
