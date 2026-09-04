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
const { PDFDocument } = require("pdf-lib");
const { buildRipartizionePdfHtml } = require("./fatture.pdf");
const { error } = require("console");
const { resolveLegacyTxtTransition } = require("./storno-transition");
const { buildAccontoAccountingCheck } = require("./acconto-accounting");
const { roundPayableToTenth } = require("./accounting-rounding");
const {
  addUtcDays,
  allocateTariffConsumption,
  buildTariffDateSegments,
  calculateRowVat,
  effectiveNucleus,
  toIsoDate,
} = require("./tariff-allocation");
const {
  getGeneratedDocumentById,
  getLatestGeneratedDocument,
  getPdfFromR2,
  listGeneratedDocuments,
  saveGeneratedDocument,
} = require("../../utils/generatedDocuments");
const {
  deleteImportedDocumentFile,
  getImportedDocument,
  localImportedDocumentExists,
  parseStoredReference,
  removeUploadTempFile,
  saveImportedDocument,
} = require("../../utils/importedDocuments");
// const db = require(... your existing db helper ...)

const DEFAULT_AI_PARSER_BASE_URL =
  "https://idromardi-ai-693191024735.europe-west1.run.app";
let ripartizionePdfColumns = null;
let fattureSessionColumns = null;
let fattureRigheColumns = null;
let fattureAccontiColumns = null;

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

  if (!columns.has("storno_legacy")) {
    alters.push("ADD COLUMN storno_legacy DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER storno_acconto");
  }

  if (!columns.has("storno_txt_aggiuntivo")) {
    alters.push("ADD COLUMN storno_txt_aggiuntivo DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER storno_legacy");
  }

  if (!columns.has("credito_storno_residuo")) {
    alters.push(
      "ADD COLUMN credito_storno_residuo DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER storno_txt_aggiuntivo"
    );
  }

  if (!columns.has("storno_legacy_periodo")) {
    alters.push(
      "ADD COLUMN storno_legacy_periodo VARCHAR(100) NULL AFTER credito_storno_residuo"
    );
  }

  if (!columns.has("storno_pregresso")) {
    alters.push(
      "ADD COLUMN storno_pregresso DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER storno_legacy"
    );
  }

  if (!columns.has("storno_txt_richiesto")) {
    alters.push(
      "ADD COLUMN storno_txt_richiesto DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER storno_txt_aggiuntivo"
    );
  }

  if (!columns.has("storno_txt_compensato_legacy")) {
    alters.push(
      "ADD COLUMN storno_txt_compensato_legacy DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER storno_txt_richiesto"
    );
  }

  if (!columns.has("storno_carenza_assorbita")) {
    alters.push(
      "ADD COLUMN storno_carenza_assorbita DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER storno_txt_compensato_legacy"
    );
  }

  if (!columns.has("credito_storno_ingresso")) {
    alters.push(
      "ADD COLUMN credito_storno_ingresso DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER credito_storno_residuo"
    );
  }

  if (!columns.has("credito_storno_residuo_mc")) {
    alters.push(
      "ADD COLUMN credito_storno_residuo_mc DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER credito_storno_residuo"
    );
  }

  if (!columns.has("credito_storno_assorbito")) {
    alters.push(
      "ADD COLUMN credito_storno_assorbito DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER credito_storno_ingresso"
    );
  }

  if (!columns.has("credito_storno_differito")) {
    alters.push(
      "ADD COLUMN credito_storno_differito DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER credito_storno_assorbito"
    );
  }

  if (!columns.has("storno_transition_status")) {
    alters.push(
      "ADD COLUMN storno_transition_status VARCHAR(50) NULL AFTER storno_legacy_periodo"
    );
  }

  if (!columns.has("storno_mc_applicato")) {
    alters.push(
      "ADD COLUMN storno_mc_applicato DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER storno_acconto"
    );
  }

  if (!columns.has("configured_oneri")) {
    alters.push(
      "ADD COLUMN configured_oneri DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER imp_oneri"
    );
  }

  if (!columns.has("imp_oneri_perequazione")) {
    alters.push(
      "ADD COLUMN imp_oneri_perequazione DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER configured_oneri"
    );
  }

  if (!alters.length) return columns;

  await db.query(`ALTER TABLE fatture_righe ${alters.join(", ")}`);
  fattureRigheColumns = null;
  return getFattureRigheColumns();
}

async function getFattureAccontiColumns() {
  if (fattureAccontiColumns) return fattureAccontiColumns;

  const [columns] = await db.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fatture_acconti_movimenti'
    `
  );

  fattureAccontiColumns = new Set(columns.map((row) => row.COLUMN_NAME));
  return fattureAccontiColumns;
}

async function ensureFattureAccontiLedgerTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS fatture_acconti_movimenti (
      id CHAR(36) NOT NULL PRIMARY KEY,
      id_utenza CHAR(36) NOT NULL,
      id_fattura CHAR(36) NOT NULL,
      id_riga_fattura CHAR(36) DEFAULT NULL,
      tipo_movimento ENUM('ACCONTO_CARICATO', 'STORNO_APPLICATO', 'RETTIFICA_POS') NOT NULL,
      importo_euro DECIMAL(10,2) NOT NULL DEFAULT 0,
      importo_mc DECIMAL(12,3) NOT NULL DEFAULT 0,
      source_movimento_id CHAR(36) DEFAULT NULL,
      origine_credito VARCHAR(20) DEFAULT NULL,
      periodo_origine VARCHAR(100) DEFAULT NULL,
      note VARCHAR(255) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_acconti_utenza_created (id_utenza, created_at),
      KEY idx_acconti_fattura (id_fattura),
      KEY idx_acconti_source (source_movimento_id),
      KEY idx_acconti_riga (id_riga_fattura)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
  fattureAccontiColumns = null;
}

async function ensureFattureAccontiTransitionColumns() {
  await ensureFattureAccontiLedgerTable();
  const columns = await getFattureAccontiColumns();
  const alters = [];

  if (!columns.has("origine_credito")) {
    alters.push(
      "ADD COLUMN origine_credito VARCHAR(20) NULL AFTER source_movimento_id"
    );
  }

  if (!columns.has("periodo_origine")) {
    alters.push("ADD COLUMN periodo_origine VARCHAR(100) NULL AFTER origine_credito");
  }

  if (!alters.length) return columns;

  await db.query(`ALTER TABLE fatture_acconti_movimenti ${alters.join(", ")}`);
  fattureAccontiColumns = null;
  return getFattureAccontiColumns();
}

async function getImportedDocumentLinkedToSession(conn, session) {
  await ensureFattureSessionContextColumns();

  if (session?.imported_document_id) {
    const [rows] = await conn.query(
      `
      SELECT
        id,
        original_filename,
        provider_id,
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
      provider_id,
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
    return {
      euro: 0,
      mc: 0,
      acquedotto: 0,
      depurazione: 0,
      fognatura: 0,
      depFog: 0,
      quotaFissa: 0,
      oneri: 0,
      iva: 0,
      totale: 0,
      source: "none",
    };
  }

  const manual = payload?.manual_overrides?.storno;
  if (
    manual &&
    Object.values(manual).some(
      (value) => value !== null && value !== undefined && value !== ""
    )
  ) {
    const deduction = (value) => {
      const magnitude = Math.abs(n2(value));
      return magnitude === 0 ? 0 : -round2(magnitude);
    };
    const acquedotto = deduction(manual.acquedotto);
    const depFog = deduction(manual.dep_fog);
    const quotaFissa = deduction(manual.quota_fissa);
    const oneri = deduction(manual.oneri);
    const iva = deduction(manual.iva);
    const explicitTotal =
      manual.totale !== null &&
      manual.totale !== undefined &&
      manual.totale !== "" &&
      Number.isFinite(Number(manual.totale));
    const totale = explicitTotal
      ? deduction(manual.totale)
      : round2(acquedotto + depFog + quotaFissa + oneri + iva);

    return {
      euro: totale,
      mc: n2(manual.mc) === 0 ? 0 : -round3(Math.abs(n2(manual.mc))),
      acquedotto,
      depurazione: 0,
      fognatura: 0,
      depFog,
      quotaFissa,
      oneri,
      iva,
      totale,
      source: "manual_positive_override_deduction",
    };
  }

  const sumNegativeRows = (key, predicate = null) => {
    const rows = Array.isArray(payload?.[key]) ? payload[key] : [];
    const negativeRows = rows.filter(
      (row) => n2(row?.importo) < 0 && (!predicate || predicate(row))
    );
    const explicitRows = negativeRows.filter((row) => row?.is_storno_acconto);
    const targetRows = negativeRows;

    return {
      rows: targetRows,
      importo: targetRows.reduce((sum, row) => sum + n2(row?.importo), 0),
      quantita: targetRows.reduce((sum, row) => sum - Math.abs(n2(row?.quantita)), 0),
      explicit: explicitRows.length > 0,
    };
  };

  const acquedottoRows = sumNegativeRows(
    "componente_tariffa_acquedotto",
    isMainAcquedottoTariffRow
  );
  const depurazioneRows = sumNegativeRows("componente_tariffa_depurazione");
  const fognaturaRows = sumNegativeRows("componente_tariffa_fognatura");
  const oneriRows = sumNegativeRows("oneri_perequazione");
  const quotaFissaRows = sumNegativeRows("componente_quota_tariffa_acqua");

  const summary = payload?.summaryTariffeAcquedotto || {};
  const summaryAcquedotto = n2(summary.importoStorno) || n2(summary.importoNeg);
  const summaryMc = n2(summary.quantitaStorno) || n2(summary.quantitaNeg);
  const acquedotto = round2(
    acquedottoRows.rows.length
      ? acquedottoRows.importo
      : summaryAcquedotto > 0
      ? -summaryAcquedotto
      : summaryAcquedotto
  );
  const mc = round3(
    acquedottoRows.rows.length
      ? acquedottoRows.quantita
      : summaryMc > 0
      ? -summaryMc
      : summaryMc
  );
  const depurazione = round2(depurazioneRows.importo);
  const fognatura = round2(fognaturaRows.importo);
  const depFog = round2(depurazione + fognatura);
  const oneri = round2(oneriRows.importo);
  const quotaFissa = round2(quotaFissaRows.importo);
  const iva = round2((acquedotto + depFog + quotaFissa + oneri) * 0.1);
  const totale = round2(acquedotto + depFog + quotaFissa + oneri + iva);
  const hasComponentRows =
    acquedottoRows.rows.length > 0 ||
    depurazioneRows.rows.length > 0 ||
    fognaturaRows.rows.length > 0 ||
    oneriRows.rows.length > 0 ||
    quotaFissaRows.rows.length > 0;
  const hasExplicitRows =
    acquedottoRows.explicit ||
    depurazioneRows.explicit ||
    fognaturaRows.explicit ||
    oneriRows.explicit ||
    quotaFissaRows.explicit;

  return {
    // euro remains the compatibility field consumed by the allocation engine.
    euro: totale,
    mc,
    acquedotto,
    depurazione,
    fognatura,
    depFog,
    quotaFissa,
    oneri,
    iva,
    totale,
    source: hasComponentRows
      ? hasExplicitRows
        ? "component_rows_explicit"
        : "component_rows_negative"
      : acquedotto || mc
      ? "summary"
      : "none",
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

  const reference = parseStoredReference(doc.stored_filename);
  if (reference.provider === "r2") return doc;

  const filePath = path.join(
    process.cwd(),
    "..",
    "runtime_uploads",
    "fatture-import",
    reference.key
  );

  if (!localImportedDocumentExists(doc.stored_filename)) return doc;

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

  const entries = Object.entries(rowsByUtenza).sort((a, b) => {
    const aRow = a[1]?.[0];
    const bRow = b[1]?.[0];
    const aOrder = Number(aRow?.utenza?.id_user ?? a[0] ?? 0);
    const bOrder = Number(bRow?.utenza?.id_user ?? b[0] ?? 0);
    return aOrder - bOrder;
  });

  let processed = 0;
  let saved = 0;
  let failed = 0;

  let browser;

  try {
    browser = await launchBrowser();
    const allRows = entries.flatMap(([, utenzaRighe]) => utenzaRighe);
    const completeBuffer = await generateRipartizioneCompletePdfBuffer({
      browser,
      righe: allRows,
      dettaglioByUtenza,
      trimestreLabel,
      dataLettura,
      logoUrl,
      onChunkComplete: async () => {
        processed += 1;
        try {
          await db.query(
            `UPDATE ripartizione_pdf_jobs SET processed = GREATEST(processed, ?) WHERE id = ?`,
            [processed, jobId]
          );
        } catch (error) {
          // Progress reporting is best-effort and must never invalidate an
          // otherwise valid PDF. The final job update remains authoritative.
          console.warn("Impossibile aggiornare il progresso PDF:", error?.message);
        }
      },
    });

    if (completeBuffer.slice(0, 4).toString() !== "%PDF") {
      throw new Error("PDF completo non valido");
    }

    await saveGeneratedDocument({
      condominioId,
      fatturaId,
      documentType: "bollette_complete",
      filename: `bollette_ripartizione_${periodKey}.pdf`,
      periodLabel: trimestreLabel || periodKey,
      buffer: completeBuffer,
      replace: Boolean(fatturaId),
      metadata: {
        periodKey,
        periodLabel: trimestreLabel || periodKey,
        trimestreLabel,
        dataLettura,
        mode: "complete_only",
        utenzeCount: entries.length,
      },
    });

    processed = Math.max(processed, 1);
    saved = 1;
    failed = 0;

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

function getPositiveIntegerEnv(name, fallback, max) {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  return Math.min(value, max);
}

function getRipartizionePdfChunkSize() {
  return getPositiveIntegerEnv("RIPARTIZIONE_PDF_CHUNK_SIZE", 8, 100);
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
  const clonedRows = righe.map((row) => ({ ...row, riga: { ...(row.riga || {}) } }));

  if (!parsedOneriNormale) {
    return clonedRows.map((row) => {
      row.riga.imp_oneri_base_display = n2(row?.riga?.imp_oneri ?? row?.imp_oneri);
      row.riga.imp_oneri_perequazione_display = 0;
      return row;
    });
  }

  const chargeableRows = clonedRows.filter(
    (row) => n2(row?.riga?.consumo_totale ?? row?.consumo_totale) > 0
  );
  const normaleShares = allocateRoundedForDisplay(
    parsedOneriNormale,
    chargeableRows,
    2,
    (row) => n2(row?.riga?.consumo_totale ?? row?.consumo_totale)
  );
  const shareByIndex = new Map();

  chargeableRows.forEach((row, index) => {
    shareByIndex.set(clonedRows.indexOf(row), round2(n2(normaleShares[index])));
  });

  return clonedRows.map((row, index) => {
    const originalOneri = n2(row?.riga?.imp_oneri ?? row?.imp_oneri);
    const configuredOneri = row?.riga?.imp_oneri_base_display;
    const perequazione = round2(shareByIndex.get(index) || 0);

    row.riga.imp_oneri_base_display =
      configuredOneri !== undefined && configuredOneri !== null
        ? n2(configuredOneri)
        : Math.max(0, round2(originalOneri - perequazione));
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
  const renderRowCount = Object.values(rowsByUtenza).reduce(
    (count, utenzaRighe) => count + utenzaRighe.length,
    0
  );
  if (renderRowCount === 0) {
    const err = new Error("Nessuna riga valida disponibile per generare i PDF");
    err.statusCode = 400;
    throw err;
  }
  const total = Math.ceil(renderRowCount / getRipartizionePdfChunkSize());
  const periodKey = makeSafeDateFolder(dataLettura);

  const [activeJobs] = await db.query(
    `
    SELECT id, status, total
    FROM ripartizione_pdf_jobs
    WHERE condominio_id <=> ?
      AND period_key = ?
      AND status IN ('pending', 'processing')
      AND updated_at >= DATE_SUB(NOW(), INTERVAL 20 MINUTE)
    ORDER BY id DESC
    LIMIT 1
    `,
    [condominioId || null, periodKey]
  );

  if (activeJobs[0]) {
    return activeJobs[0];
  }

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

    try {
      await db.query(
        `
        UPDATE ripartizione_pdf_jobs
        SET status = 'error',
            error_message = ?
        WHERE id = ?
        `,
        [error?.message || "Errore generazione PDF", jobId]
      );
    } catch (statusError) {
      console.error("Impossibile salvare lo stato di errore del job PDF:", statusError);
    }
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
  const entries = Object.entries(rowsByUtenza).sort((a, b) => {
    const aRow = a[1]?.[0];
    const bRow = b[1]?.[0];
    const aOrder = Number(aRow?.utenza?.id_user ?? a[0] ?? 0);
    const bOrder = Number(bRow?.utenza?.id_user ?? b[0] ?? 0);
    return aOrder - bOrder;
  });
  const allRows = entries.flatMap(([, utenzaRighe]) => utenzaRighe);
  let browser;

  try {
    browser = await launchBrowser();
    const pdfBuffer = await generateRipartizioneCompletePdfBuffer({
      browser,
      righe: allRows,
      dettaglioByUtenza,
      trimestreLabel,
      dataLettura,
      logoUrl,
    });

    if (pdfBuffer.slice(0, 4).toString() !== "%PDF") {
      throw new Error("PDF completo non valido");
    }

    const filename = `bollette_ripartizione_${periodFolder}.pdf`;

    await saveGeneratedDocument({
      condominioId,
      fatturaId,
      documentType: "bollette_complete",
      filename,
      periodLabel: trimestreLabel || periodFolder,
      buffer: pdfBuffer,
      replace: Boolean(fatturaId),
      metadata: {
        periodKey: periodFolder,
        periodLabel: trimestreLabel || periodFolder,
        trimestreLabel,
        dataLettura,
        mode: "complete_only",
        utenzeCount: entries.length,
      },
    });

    return {
      savedFiles: [
        {
          success: true,
          filename,
          periodKey: periodFolder,
          documentType: "bollette_complete",
        },
      ],
      failedFiles: [],
      total: 1,
      saved: 1,
      failed: 0,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
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

async function generateRipartizioneCompletePdfBuffer({
  browser,
  righe,
  dettaglioByUtenza,
  trimestreLabel,
  dataLettura,
  logoUrl,
  onChunkComplete,
}) {
  const rows = Array.isArray(righe) ? righe : [];
  const chunkSize = getRipartizionePdfChunkSize();
  const chunks = [];

  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }

  const mergedPdf = await PDFDocument.create();

  for (let index = 0; index < chunks.length; index += 1) {
    const chunkBuffer = Buffer.from(await generateRipartizionePdfBuffer({
      browser,
      righe: chunks[index],
      dettaglioByUtenza,
      trimestreLabel,
      dataLettura,
      logoUrl,
    }));
    const chunkPdf = await PDFDocument.load(chunkBuffer);
    const copiedPages = await mergedPdf.copyPages(chunkPdf, chunkPdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));

    if (onChunkComplete) await onChunkComplete(index, chunks.length);
  }

  return Buffer.from(await mergedPdf.save({ useObjectStreams: true }));
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
  const storedDocument = await getImportedDocument(doc.stored_filename);

  try {
    const form = new FormData();

    if (documentType === "txt") {
      rawTxtContent = storedDocument.buffer.toString("utf8");
    }

    form.append("file", storedDocument.buffer, {
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

  let storedDocument = null;
  let insertedDocumentId = null;

  try {
    if (path.extname(String(file.originalname || "")).toLowerCase() !== ".txt") {
      const err = new Error("Per il momento e possibile caricare solo file TXT");
      err.statusCode = 415;
      throw err;
    }

    if (body.sessionId) {
      await ensureFattureSessionContextColumns();
      const [sessionRows] = await db.query(
        `
        SELECT id
        FROM fatture_sessioni
        WHERE BINARY id = BINARY ?
          AND BINARY id_condominio = BINARY ?
        LIMIT 1
        `,
        [body.sessionId, body.condominioId]
      );

      if (!sessionRows.length) {
        const err = new Error("Periodo di fatturazione non trovato per il condominio indicato");
        err.statusCode = 404;
        throw err;
      }
    }

    storedDocument = await saveImportedDocument({
      sourcePath: file.path,
      condominioId: body.condominioId,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
    });

    const sql = `
      INSERT INTO imported_invoice_documents (
        condominio_id,
        provider_id,
        original_filename,
        stored_filename,
        mime_type,
        file_size_bytes,
        parse_status,
        validation_status,
        linked_session_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'uploaded', 'pending', ?)
    `;

    const params = [
      body.condominioId,
      body.providerId || null,
      file.originalname || null,
      storedDocument.storedFilename,
      file.mimetype || null,
      file.size || null,
      body.sessionId || null,
    ];

    const result = await db.query(sql, params);
    insertedDocumentId = result.insertId;

    const rows = await db.query(
      `SELECT * FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
      [insertedDocumentId]
    );

    return {
      ok: true,
      document: rows[0] || null,
    };
  } catch (error) {
    if (storedDocument?.storedFilename && !insertedDocumentId) {
      await deleteImportedDocumentFile(storedDocument.storedFilename).catch(() => {});
    }
    throw error;
  } finally {
    if (storedDocument?.provider === "r2" || !insertedDocumentId) {
      await removeUploadTempFile(file.path).catch((error) => {
        console.warn("Pulizia file temporaneo importato non riuscita:", error?.message);
      });
    }
  }
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
  const configuredOneri =
    r.configured_oneri ??
    r.imp_oneri_base_display ??
    r.oneri_base_display ??
    r.imp_oneri;
  return round2(n2(configuredOneri) + qf + round2(qf * 0.10));
}

function getAvailableStornoReductionEuro(r) {
  return Math.max(0, round2(n2(r.base_totale) - getMinimumPayableForRow(r)));
}

function annotateMinimumPayableRow(row) {
  if (!row) return row;

  const minimum = getMinimumPayableForRow(row);
  const total = round2(n2(row.totale));
  const storno = round2(n2(row.storno_acconto ?? row.storno_totale));
  const explicitCredit = round2(
    n2(row._storno_credit_euro) + n2(row.credito_storno_residuo)
  );
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
async function loadOpenAccontoCredits(conn, idUtenza, excludedFatturaId = null) {
  await ensureFattureAccontiTransitionColumns();

  const [rows] = await conn.query(
    `
    SELECT
      m.id,
      m.id_utenza,
      m.id_fattura,
      m.id_riga_fattura,
      m.created_at,
      m.origine_credito,
      m.periodo_origine,
      m.importo_euro AS euro_orig,
      m.importo_mc AS mc_orig,
      COALESCE(SUM(s.importo_euro), 0) AS euro_usato,
      COALESCE(SUM(s.importo_mc), 0) AS mc_usato
    FROM fatture_acconti_movimenti m
    LEFT JOIN fatture_acconti_movimenti s
      ON s.source_movimento_id = m.id
     AND s.tipo_movimento = 'STORNO_APPLICATO'
     AND (? IS NULL OR BINARY s.id_fattura <> BINARY ?)
    WHERE m.id_utenza = ?
      AND m.tipo_movimento IN ('ACCONTO_CARICATO', 'RETTIFICA_POS')
      AND (
        ? IS NULL
        OR BINARY m.id_fattura <> BINARY ?
        OR COALESCE(m.origine_credito, '') = 'LEGACY'
      )
    GROUP BY
      m.id, m.id_utenza, m.id_fattura, m.id_riga_fattura,
      m.created_at, m.origine_credito, m.periodo_origine,
      m.importo_euro, m.importo_mc
    HAVING
      ROUND(m.importo_euro - COALESCE(SUM(s.importo_euro), 0), 2) > 0
      OR ROUND(m.importo_mc - COALESCE(SUM(s.importo_mc), 0), 3) > 0
    ORDER BY m.created_at ASC, m.id ASC
    `,
    [
      excludedFatturaId,
      excludedFatturaId,
      idUtenza,
      excludedFatturaId,
      excludedFatturaId,
    ]
  );

  return rows.map((r) => ({
    id: r.id,
    id_utenza: r.id_utenza,
    id_fattura: r.id_fattura,
    id_riga_fattura: r.id_riga_fattura,
    created_at: r.created_at,
    origine_credito: r.origine_credito || "PIATTAFORMA",
    periodo_origine: r.periodo_origine || null,
    open_euro: round2(n2(r.euro_orig) - n2(r.euro_usato)),
    open_mc: round3(n2(r.mc_orig) - n2(r.mc_usato)),
  }));
}

async function assertNoLaterCalculatedBillingPeriods(conn, session) {
  const [laterPeriods] = await conn.query(
    `
    SELECT
      later.id,
      later.stato,
      p.period_year,
      p.period_month
    FROM fatture_sessioni later
    JOIN letture_sessioni p ON p.id = later.id_periodo_attuale
    JOIN letture_sessioni current_period ON current_period.id = ?
    WHERE later.id_condominio = ?
      AND later.id <> ?
      AND later.stato IN ('CALCOLATA', 'CONFERMATA')
      AND (
        p.period_year > current_period.period_year
        OR (
          p.period_year = current_period.period_year
          AND p.period_month > current_period.period_month
        )
      )
    ORDER BY p.period_year, p.period_month
    LIMIT 20
    `,
    [session.id_periodo_attuale, session.id_condominio, session.id]
  );

  if (!laterPeriods.length) return;

  const error = new Error(
    "Questo periodo non può essere ricalcolato isolatamente perché esistono periodi successivi già calcolati. I saldi storno devono essere ricalcolati in ordine cronologico."
  );
  error.statusCode = 409;
  error.code = "LATER_BILLING_PERIOD_DEPENDENCY";
  error.dependencies = laterPeriods.map((period) => ({
    id: period.id,
    stato: period.stato,
    mese: Number(period.period_month),
    anno: Number(period.period_year),
    periodo: `${Number(period.period_month)}/${Number(period.period_year)}`,
  }));
  throw error;
}

function planCreditConsumption(credits, euroLimit, mcLimit, legacyEuroOnly = false) {
  let remainingEuro = round2(Math.max(0, n2(euroLimit)));
  let remainingMc = round3(Math.max(0, n2(mcLimit)));
  let euroUsed = 0;
  let mcUsed = 0;
  const movements = [];
  const periods = new Set();

  for (const credit of credits || []) {
    if (remainingEuro <= 0) break;

    const openEuro = Math.max(0, n2(credit.open_euro));
    const openMc = Math.max(0, n2(credit.open_mc));
    if (openEuro <= 0 && openMc <= 0) continue;

    let takeEuro = 0;
    let takeMc = 0;
    if (legacyEuroOnly) {
      takeEuro = round2(Math.min(remainingEuro, openEuro));
      takeMc =
        openEuro > 0
          ? round3(Math.min(remainingMc, openMc, (openMc * takeEuro) / openEuro))
          : 0;
    } else {
      const euroFactor = openEuro > 0 ? remainingEuro / openEuro : Number.POSITIVE_INFINITY;
      const mcFactor = openMc > 0 ? remainingMc / openMc : Number.POSITIVE_INFINITY;
      const factor = Math.max(0, Math.min(1, euroFactor, mcFactor));
      takeEuro = openEuro > 0 ? round2(openEuro * factor) : 0;
      takeMc = openMc > 0 ? round3(openMc * factor) : 0;
    }

    takeEuro = round2(Math.min(remainingEuro, takeEuro));
    takeMc = round3(Math.min(remainingMc, takeMc));
    if (takeEuro <= 0 && takeMc <= 0) continue;

    euroUsed = round2(euroUsed + takeEuro);
    mcUsed = round3(mcUsed + takeMc);
    remainingEuro = round2(Math.max(0, remainingEuro - takeEuro));
    remainingMc = round3(Math.max(0, remainingMc - takeMc));
    if (credit.periodo_origine) periods.add(String(credit.periodo_origine));
    movements.push({
      source_movimento_id: credit.id,
      id_utenza: credit.id_utenza,
      importo_euro: takeEuro,
      importo_mc: takeMc,
      origine_credito: credit.origine_credito,
    });
  }

  return {
    euroUsed,
    mcUsed,
    movements,
    periods,
    remainingEuro,
    remainingMc,
  };
}

function allocateAcquedotto({ consumo, scaglioni, nucleo, nuae, giorniRef, yearDays, key}) {
  return allocateTariffConsumption({
    consumption: consumo,
    tiers: scaglioni,
    nucleus: nucleo,
    units: nuae,
    referenceDays: giorniRef,
    yearDays,
    key,
  });
}

function resolveBillingDateRange(periodoPrecedente, periodoAttuale, fallbackDays = 0) {
  const currentYear = Number(periodoAttuale?.period_year || new Date().getFullYear());
  const currentMonth = Number(periodoAttuale?.period_month || 1);
  const monthEnd = new Date(Date.UTC(currentYear, currentMonth, 0))
    .toISOString()
    .slice(0, 10);
  const endDate = toIsoDate(
    periodoAttuale?.data_lettura_operatore ||
      periodoAttuale?.data_lettura_casa_idrica ||
      monthEnd
  );
  let startDate = toIsoDate(
    periodoPrecedente?.data_lettura_operatore ||
      periodoPrecedente?.data_lettura_casa_idrica
  );

  if (!startDate || !endDate || startDate >= endDate) {
    const safeDays = Math.max(1, n2(fallbackDays));
    startDate = addUtcDays(endDate, -safeDays)?.toISOString().slice(0, 10) || null;
  }
  if (!startDate || !endDate || startDate >= endDate) {
    throw new Error("Date lettura non valide per la selezione delle tariffe");
  }

  return { startDate, endDate };
}

/* ---------------- Load tariffs for the session provider ---------------- */
async function loadProviderTariffVersions(conn, providerId) {
  assertUUID(providerId, "providerId tariffa");

  const [verRows] = await conn.query(
    `
    SELECT
      t.*,
      p.codice AS provider_codice,
      p.nome AS provider_nome
    FROM casa_idrica_tariffe t
    JOIN casa_idrica p ON p.id = t.id_casa_idrica
    WHERE t.id_casa_idrica = ?
    ORDER BY t.valid_from DESC
    `,
    [providerId]
  );
  if (!verRows.length) {
    const [[provider]] = await conn.query(
      `SELECT codice, nome FROM casa_idrica WHERE id = ? LIMIT 1`,
      [providerId]
    );
    const providerLabel = provider?.codice || provider?.nome || providerId;
    throw new Error(`Nessuna tariffa configurata per ${providerLabel}`);
  }
  return verRows;
}

async function loadTariffVersionDetails(conn, { version, providerId, categoriaCodice }) {
  const anno = Number(version.anno);

  const [catRows] = await conn.query(
    `
    SELECT *
    FROM casa_idrica_tariff_categorie
    WHERE id_tariffa = ? AND codice = ?
    LIMIT 1
    `,
    [version.id, categoriaCodice]
  );
  if (catRows.length === 0) {
    throw new Error(
      `Categoria ${categoriaCodice} non configurata per ${version.provider_codice || version.provider_nome} ${anno}`
    );
  }
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

  if (!scaglioni.length) {
    throw new Error(
      `Nessuno scaglione acquedotto configurato per ${version.provider_codice || version.provider_nome} ${anno}, categoria ${categoriaCodice}`
    );
  }

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
    WHERE id_categoria = ?
    ORDER BY codice ASC
    `,
    [categoria.id]
  );

  // ABC has one QF row; providers such as ASIS can configure multiple fixed
  // fee components. Their sum is the provider's annual fixed-fee total.
  const qfAnnua = round2(
    qfRows.reduce((sum, row) => sum + n2(row.importo), 0)
  );
  
  return {
    tariffVersion: version,
    provider: {
      id: providerId,
      codice: version.provider_codice,
      nome: version.provider_nome,
    },
    categoria,
    scaglioni,
    quoteFisse: qfRows,
    componentiMc: comp,
    prezzoFognatura,
    prezzoDepurazione,
    qfAnnua,
  };
}

async function loadTariffeProvider(conn, { providerId, anno, categoriaCodice, referenceDate = null }) {
  const versions = await loadProviderTariffVersions(conn, providerId);
  let version = null;
  let fallback = false;

  if (referenceDate) {
    const nextDate = addUtcDays(referenceDate, 1);
    const segment = buildTariffDateSegments({
      startDate: referenceDate,
      endDate: nextDate,
      versions,
    })[0];
    version = segment.version;
    fallback = segment.fallback;
  } else {
    version = versions.find((item) => Number(item.anno) === Number(anno)) || versions[0];
    fallback = Number(version.anno) !== Number(anno);
  }

  const tariff = await loadTariffVersionDetails(conn, {
    version,
    providerId,
    categoriaCodice,
  });
  return {
    ...tariff,
    fallback,
    requestedDate: toIsoDate(referenceDate),
  };
}

async function loadTariffTimeline(conn, {
  providerId,
  categoriaCodice,
  startDate,
  endDate,
}) {
  const versions = await loadProviderTariffVersions(conn, providerId);
  const rawSegments = buildTariffDateSegments({ startDate, endDate, versions });
  const detailsByVersion = new Map();
  const segments = [];

  for (const segment of rawSegments) {
    const cacheKey = `${segment.version.id}:${categoriaCodice}`;
    if (!detailsByVersion.has(cacheKey)) {
      detailsByVersion.set(
        cacheKey,
        await loadTariffVersionDetails(conn, {
          version: segment.version,
          providerId,
          categoriaCodice,
        })
      );
    }
    segments.push({
      ...segment,
      tariff: detailsByVersion.get(cacheKey),
    });
  }

  return segments;
}

function calculateTariffPeriodAmounts({
  consumption,
  segments,
  nucleus,
  units = 1,
  qfUnits = units,
  qfDays = null,
  parsedQF = null,
  varie = 0,
  aliquotaIva = 0.10,
  key = null,
}) {
  const totalDays = segments.reduce((sum, segment) => sum + n2(segment.days), 0);
  if (!segments.length || totalDays <= 0) {
    throw new Error("Periodo tariffario non disponibile per il calcolo");
  }

  const totalConsumption = Math.max(0, n2(consumption));
  const details = [];
  let assignedMc = 0;
  let impAcquedotto = 0;
  let impFognatura = 0;
  let impDepurazione = 0;
  let calculatedQf = 0;

  segments.forEach((segment, index) => {
    const segmentMc = index === segments.length - 1
      ? round3(Math.max(0, totalConsumption - assignedMc))
      : round3((totalConsumption * n2(segment.days)) / totalDays);
    assignedMc = round3(assignedMc + segmentMc);
    const allocation = allocateTariffConsumption({
      consumption: segmentMc,
      tiers: segment.tariff.scaglioni,
      nucleus,
      units,
      referenceDays: segment.days,
      yearDays: yearDaysCount(segment.year),
      key,
    });
    const fog = round2(segmentMc * n2(segment.tariff.prezzoFognatura));
    const dep = round2(segmentMc * n2(segment.tariff.prezzoDepurazione));
    const qfScale = qfDays === null ? 1 : Math.max(0, n2(qfDays)) / totalDays;
    const qf = round2(
      (n2(segment.tariff.qfAnnua) / yearDaysCount(segment.year)) *
        Math.max(1, n2(qfUnits)) *
        n2(segment.days) *
        qfScale
    );

    impAcquedotto = round2(impAcquedotto + allocation.total);
    impFognatura = round2(impFognatura + fog);
    impDepurazione = round2(impDepurazione + dep);
    calculatedQf = round2(calculatedQf + qf);
    details.push({
      start: segment.start,
      end_exclusive: segment.end_exclusive,
      days: segment.days,
      year: segment.year,
      fallback: segment.fallback,
      consumption_mc: segmentMc,
      provider: segment.tariff.provider,
      version: segment.tariff.tariffVersion,
      category: segment.tariff.categoria,
      acquedotto: allocation,
      fognatura: fog,
      depurazione: dep,
      quota_fissa: qf,
    });
  });

  const hasParsedQF =
    parsedQF !== null &&
    parsedQF !== undefined &&
    parsedQF !== "" &&
    Number.isFinite(Number(parsedQF));
  const qfTot = hasParsedQF ? round2(parsedQF) : calculatedQf;
  const depFog = round2(impFognatura + impDepurazione);
  const iva = round2((impAcquedotto + depFog + qfTot) * n2(aliquotaIva));

  return {
    impAcquedotto,
    impFognatura,
    impDepurazione,
    depFog,
    qfTot,
    iva,
    totale: round2(impAcquedotto + depFog + qfTot + iva + n2(varie)),
    dettaglioAcquedotto: details.flatMap((item) => item.acquedotto.tiers),
    tariffPeriods: details,
    fallbackUsed: details.some((item) => item.fallback),
  };
}

function buildAppliedTariffSnapshot(segments, periodStart, periodEnd) {
  const lastSegment = segments[segments.length - 1];
  const primaryTariff = lastSegment?.tariff;
  if (!primaryTariff) return null;

  return {
    provider: primaryTariff.provider,
    version: {
      id: primaryTariff.tariffVersion.id,
      anno: primaryTariff.tariffVersion.anno,
      valid_from: primaryTariff.tariffVersion.valid_from,
      valid_to: primaryTariff.tariffVersion.valid_to,
    },
    reference_date: periodEnd,
    period_start: periodStart,
    period_end: periodEnd,
    fallback_used: segments.some((segment) => segment.fallback),
    category: {
      id: primaryTariff.categoria.id,
      codice: primaryTariff.categoria.codice,
      nome: primaryTariff.categoria.nome,
    },
    scaglioni: primaryTariff.scaglioni,
    quote_fisse: primaryTariff.quoteFisse,
    componenti_mc: primaryTariff.componentiMc,
    qf_annua: primaryTariff.qfAnnua,
    periods: segments.map((segment) => ({
      start: segment.start,
      end_exclusive: segment.end_exclusive,
      days: segment.days,
      year: segment.year,
      fallback: segment.fallback,
      provider: segment.tariff.provider,
      version: {
        id: segment.tariff.tariffVersion.id,
        anno: segment.tariff.tariffVersion.anno,
        valid_from: segment.tariff.tariffVersion.valid_from,
        valid_to: segment.tariff.tariffVersion.valid_to,
      },
      category: {
        id: segment.tariff.categoria.id,
        codice: segment.tariff.categoria.codice,
        nome: segment.tariff.categoria.nome,
      },
      scaglioni: segment.tariff.scaglioni,
      quote_fisse: segment.tariff.quoteFisse,
      componenti_mc: segment.tariff.componentiMc,
      qf_annua: segment.tariff.qfAnnua,
    })),
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
      const existingSession = existing[0];
      if (String(existingSession.id_casa_idrica) !== String(idCasaIdrica)) {
        if (String(existingSession.stato || "").toUpperCase() !== "BOZZA") {
          const error = new Error(
            "Esiste già una fatturazione calcolata per questi periodi con un provider diverso"
          );
          error.statusCode = 409;
          throw error;
        }

        await conn.query(
          `UPDATE fatture_sessioni SET id_casa_idrica = ? WHERE id = ?`,
          [idCasaIdrica, existingSession.id]
        );
        existingSession.id_casa_idrica = idCasaIdrica;
      }

      return { session: existingSession };
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
    const resolvedImportedDocumentId = linkedImportedDocument?.id || null;

    if (String(session.imported_document_id || "") !== String(resolvedImportedDocumentId || "")) {
      await conn.query(
        `UPDATE fatture_sessioni SET imported_document_id = ? WHERE id = ?`,
        [resolvedImportedDocumentId, session.id]
      );
      session.imported_document_id = resolvedImportedDocumentId;
    }

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
          CASE
            WHEN fr.storno_transition_status IS NOT NULL
              THEN COALESCE(fr.credito_storno_residuo, 0)
            ELSE COALESCE(fr.credito_storno_residuo, 0) + COALESCE((
              SELECT SUM(m.importo_euro)
              FROM fatture_acconti_movimenti m
              WHERE m.id_riga_fattura = fr.id
                AND m.tipo_movimento = 'RETTIFICA_POS'
                AND m.note = 'Credito storno non applicato per minimo fatturabile'
            ), 0)
          END AS minimum_payable_credit_euro,
          CASE
            WHEN fr.storno_transition_status IS NOT NULL
              THEN COALESCE(fr.credito_storno_residuo_mc, 0)
            ELSE COALESCE((
              SELECT SUM(m.importo_mc)
              FROM fatture_acconti_movimenti m
              WHERE m.id_riga_fattura = fr.id
                AND m.tipo_movimento = 'RETTIFICA_POS'
                AND m.note = 'Credito storno non applicato per minimo fatturabile'
            ), 0)
          END AS minimum_payable_credit_mc,
          u.id_user,
          CONCAT(u.nome,' ',u.cognome) AS utente,
          u.doppio_contatore,
          u.billing_group_id
        FROM fatture_righe fr
        JOIN utenze_v2 u ON u.id = fr.id_utenza
        WHERE fr.id_fattura = ?
        ORDER BY u.id_user ASC
        `,
        [sessionId]
    );

    const mapAtt = new Map(righeAtt.map((r) => [r.id_utenza, r]));
    const mapPrec = new Map(righePrec.map((r) => [r.id_utenza, r]));
    const context = parseCalculationContextJson(session.calculation_context_json);
    const calculationWarnings = Array.isArray(context.calculationWarnings)
      ? context.calculationWarnings
      : [];
    const accountingChecks = context.accountingChecks || null;
    const parsedOneriNormale = round2(context.parsedOneriPerequazione);
    applySeparatedOneriToLoadedRows(righeRows, session, parsedOneriNormale);
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
      calculationWarnings,
      accountingChecks,
    };
  } finally {
    conn.release();
  }
};

exports.getLegacyAcconti = async function ({ sessionId }) {
  assertUUID(sessionId, "sessionId");
  await ensureFattureAccontiTransitionColumns();

  const [sessions] = await db.query(
    `SELECT id, id_condominio FROM fatture_sessioni WHERE id = ? LIMIT 1`,
    [sessionId]
  );
  if (!sessions.length) throw new Error("Session not found");

  const [rows] = await db.query(
    `
    SELECT
      m.id,
      m.id_utenza,
      m.importo_euro,
      m.importo_mc,
      m.periodo_origine,
      m.note,
      COALESCE(SUM(s.importo_euro), 0) AS importo_euro_usato,
      COALESCE(SUM(s.importo_mc), 0) AS importo_mc_usato,
      u.id_user,
      CONCAT(u.nome, ' ', u.cognome) AS utente,
      u.interno
    FROM fatture_acconti_movimenti m
    JOIN utenze_v2 u ON u.id = m.id_utenza
    LEFT JOIN fatture_acconti_movimenti s
      ON s.source_movimento_id = m.id
     AND s.tipo_movimento = 'STORNO_APPLICATO'
    WHERE m.id_fattura = ?
      AND m.tipo_movimento = 'RETTIFICA_POS'
      AND m.origine_credito = 'LEGACY'
    GROUP BY
      m.id, m.id_utenza, m.importo_euro, m.importo_mc,
      m.periodo_origine, m.note, u.id_user, u.nome, u.cognome, u.interno
    ORDER BY u.id_user ASC
    `,
    [sessionId]
  );

  const entries = rows.map((row) => ({
    id: row.id,
    idUtenza: row.id_utenza,
    idUser: row.id_user,
    utente: row.utente,
    interno: row.interno,
    importoEuro: round2(row.importo_euro),
    importoMc: round3(row.importo_mc),
    usatoEuro: round2(row.importo_euro_usato),
    usatoMc: round3(row.importo_mc_usato),
    residuoEuro: round2(n2(row.importo_euro) - n2(row.importo_euro_usato)),
    residuoMc: round3(n2(row.importo_mc) - n2(row.importo_mc_usato)),
    periodoOrigine: row.periodo_origine || null,
    note: row.note || null,
  }));

  return {
    sessionId,
    periodoOrigine: entries.find((entry) => entry.periodoOrigine)?.periodoOrigine || null,
    totaleEuro: round2(entries.reduce((sum, entry) => sum + entry.importoEuro, 0)),
    residuoEuro: round2(entries.reduce((sum, entry) => sum + entry.residuoEuro, 0)),
    entries,
  };
};

exports.saveLegacyAcconti = async function ({ sessionId, periodoOrigine, entries }) {
  assertUUID(sessionId, "sessionId");
  if (!Array.isArray(entries)) throw new Error("entries must be an array");
  if (entries.length > 10000) throw new Error("Too many legacy entries");

  await ensureFattureAccontiTransitionColumns();
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [sessions] = await conn.query(
      `SELECT id, id_condominio FROM fatture_sessioni WHERE id = ? FOR UPDATE`,
      [sessionId]
    );
    if (!sessions.length) throw new Error("Session not found");
    const session = sessions[0];

    const normalized = new Map();
    for (const raw of entries) {
      const idUtenza = String(raw?.idUtenza || raw?.id_utenza || "").trim();
      assertUUID(idUtenza, "idUtenza");
      const importoEuro = round2(Math.max(0, n2(raw?.importoEuro ?? raw?.importo_euro)));
      const importoMc = round3(Math.max(0, n2(raw?.importoMc ?? raw?.importo_mc)));
      if (importoEuro <= 0 && importoMc <= 0) continue;

      normalized.set(idUtenza, {
        idUtenza,
        importoEuro,
        importoMc,
        note: String(raw?.note || "").trim().slice(0, 255) || null,
      });
    }

    const ids = [...normalized.keys()];
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      const [validUsers] = await conn.query(
        `SELECT id FROM utenze_v2 WHERE condominio_id = ? AND id IN (${placeholders})`,
        [session.id_condominio, ...ids]
      );
      const validIds = new Set(validUsers.map((row) => row.id));
      const invalidId = ids.find((id) => !validIds.has(id));
      if (invalidId) throw new Error(`Utenza non valida per il condominio: ${invalidId}`);
    }

    const [legacyRows] = await conn.query(
      `
      SELECT id
      FROM fatture_acconti_movimenti
      WHERE id_fattura = ?
        AND tipo_movimento = 'RETTIFICA_POS'
        AND origine_credito = 'LEGACY'
      `,
      [sessionId]
    );
    const legacyIds = legacyRows.map((row) => row.id);

    if (legacyIds.length) {
      const placeholders = legacyIds.map(() => "?").join(",");
      const [futureUses] = await conn.query(
        `
        SELECT COUNT(*) AS total
        FROM fatture_acconti_movimenti
        WHERE tipo_movimento = 'STORNO_APPLICATO'
          AND source_movimento_id IN (${placeholders})
          AND id_fattura <> ?
        `,
        [...legacyIds, sessionId]
      );
      if (Number(futureUses[0]?.total || 0) > 0) {
        throw new Error(
          "Il saldo iniziale e gia stato utilizzato in un periodo successivo e non puo essere modificato."
        );
      }

      await conn.query(
        `DELETE FROM fatture_acconti_movimenti
         WHERE tipo_movimento = 'STORNO_APPLICATO'
           AND source_movimento_id IN (${placeholders})
           AND id_fattura = ?`,
        [...legacyIds, sessionId]
      );
    }

    await conn.query(
      `DELETE FROM fatture_acconti_movimenti
       WHERE id_fattura = ?
         AND tipo_movimento = 'RETTIFICA_POS'
         AND origine_credito = 'LEGACY'`,
      [sessionId]
    );

    const sourcePeriod = String(periodoOrigine || "").trim().slice(0, 100) || null;
    for (const entry of normalized.values()) {
      await conn.query(
        `
        INSERT INTO fatture_acconti_movimenti
          (id, id_utenza, id_fattura, id_riga_fattura,
           tipo_movimento, importo_euro, importo_mc, source_movimento_id,
           origine_credito, periodo_origine, note)
        VALUES (?, ?, ?, NULL, 'RETTIFICA_POS', ?, ?, NULL, 'LEGACY', ?, ?)
        `,
        [
          uuid(),
          entry.idUtenza,
          sessionId,
          entry.importoEuro,
          entry.importoMc,
          sourcePeriod,
          entry.note || "Saldo acconto iniziale da piattaforma precedente",
        ]
      );
    }

    await conn.commit();
    return exports.getLegacyAcconti({ sessionId });
  } catch (error) {
    await conn.rollback();
    throw error;
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
      CASE
        WHEN fr.storno_transition_status IS NOT NULL
          THEN COALESCE(fr.credito_storno_residuo, 0)
        ELSE COALESCE(fr.credito_storno_residuo, 0) + COALESCE((
          SELECT SUM(m.importo_euro)
          FROM fatture_acconti_movimenti m
          WHERE m.id_riga_fattura = fr.id
            AND m.tipo_movimento = 'RETTIFICA_POS'
            AND m.note = 'Credito storno non applicato per minimo fatturabile'
        ), 0)
      END AS minimum_payable_credit_euro,
      CASE
        WHEN fr.storno_transition_status IS NOT NULL
          THEN COALESCE(fr.credito_storno_residuo_mc, 0)
        ELSE COALESCE((
          SELECT SUM(m.importo_mc)
          FROM fatture_acconti_movimenti m
          WHERE m.id_riga_fattura = fr.id
            AND m.tipo_movimento = 'RETTIFICA_POS'
            AND m.note = 'Credito storno non applicato per minimo fatturabile'
        ), 0)
      END AS minimum_payable_credit_mc,
      u.id_user,
      CONCAT(u.nome,' ',u.cognome) AS utente,
      u.doppio_contatore,
      u.billing_group_id
    FROM fatture_righe fr
    JOIN utenze_v2 u ON u.id = fr.id_utenza
    WHERE fr.id_fattura = ?
    ORDER BY u.id_user ASC
    `,
    [sessionId]
  );
  
  const session = sessionRows[0];
  const context = parseCalculationContextJson(session.calculation_context_json);
  const calculationWarnings = Array.isArray(interniTotals?.calculationWarnings)
    ? interniTotals.calculationWarnings
    : Array.isArray(context.calculationWarnings)
    ? context.calculationWarnings
    : [];
  const accountingChecks =
    interniTotals?.accountingChecks || context.accountingChecks || null;
  const parsedOneriNormale = round2(context.parsedOneriPerequazione);
  applySeparatedOneriToLoadedRows(righeRows, session, parsedOneriNormale);
  righeRows.forEach(annotateMinimumPayableRow);
  righeRows.dettaglio_consumi = interniTotals?.dettaglio_consumi;
  return {
    session,
    righe: righeRows, 
    generale: generaleResult?.generale || null,
    appliedTariff: generaleResult?.meta?.appliedTariff || context.appliedTariff || null,
    calculationWarnings,
    accountingChecks,
     
  };
}

function getBillingGroupSizes(rows) {
  const sizes = new Map();

  for (const row of rows) {
    const groupId = row?.billing_group_id;
    if (
      !groupId ||
      String(row?.doppio_contatore ?? "NO").toUpperCase() !== "SI"
    ) continue;
    sizes.set(groupId, (sizes.get(groupId) || 0) + 1);
  }

  return sizes;
}

function applySeparatedOneriToLoadedRows(rows, session, parsedOneriNormale) {
  const billingGroupSizes = getBillingGroupSizes(rows);
  const eligibleRows = rows.filter(
    (row) => n2(row.consumo_totale) > 0
  );
  const fallbackPereqShares = parsedOneriNormale
    ? allocateRoundedForDisplay(
        parsedOneriNormale,
        eligibleRows,
        2,
        (row) => n2(row.consumo_totale)
      )
    : eligibleRows.map(() => 0);
  const fallbackPereqByRowId = new Map();

  eligibleRows.forEach((row, index) => {
    fallbackPereqByRowId.set(row.id, round2(fallbackPereqShares[index] || 0));
  });

  for (const row of rows) {
    const combinedOneri = round2(row.imp_oneri);
    const persistedConfigured = round2(row.configured_oneri);
    const hasPersistedSeparation = persistedConfigured !== 0 || combinedOneri === 0;
    const fallbackPerequazione = round2(fallbackPereqByRowId.get(row.id) || 0);
    const perequazione = hasPersistedSeparation
      ? round2(row.imp_oneri_perequazione)
      : fallbackPerequazione;

    let configuredOneri = persistedConfigured;
    if (!hasPersistedSeparation) {
      const groupSize =
        String(row.doppio_contatore ?? "NO").toUpperCase() === "SI" &&
        row.billing_group_id
          ? Math.max(1, billingGroupSizes.get(row.billing_group_id) || 1)
          : 1;
      configuredOneri = round2(n2(session?.oneri_snapshot) * groupSize);
    }

    row.configured_oneri = configuredOneri;
    row.imp_oneri_base_display = configuredOneri;
    row.imp_oneri_perequazione_display = perequazione;
  }
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
  const A = Math.max(1, n2(numNuae));
  const acquedottoAllocation = allocateTariffConsumption({
    consumption: consumo,
    tiers: imposteG,
    // totNuc is already the sum of the effective household sizes. Passing it
    // as one unit applies condominium capacity once, without multiplying NUAe
    // a second time.
    nucleus: Math.max(1, n2(totNuc)),
    units: 1,
    referenceDays: giorniInterni,
    yearDays,
    key: "CONTATORE_GENERALE",
  });
  const daysQFv = Math.max(0, n2(giorniQF));
  const yd = Math.max(365, n2(yearDays));
 
  const impAcquedotto = round2(acquedottoAllocation.total);
  const impFognatura = consumo * n2(prezzoFognatura);
  const impDepurazione = consumo * n2(prezzoDepurazione);
  const depFog = impFognatura + impDepurazione;

  const hasParsedQF =
    parsedQF !== null &&
    parsedQF !== undefined &&
    parsedQF !== "" &&
    Number.isFinite(Number(parsedQF));
  const qfTot = hasParsedQF
    ? Number(parsedQF)
    : (n2(qfAnnua) / yd) * A * daysQFv;

   
 
  
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
    dettaglioAcquedotto: acquedottoAllocation.tiers,
  };
  
}

function calcolaStornoSoloAcquedotto({
  consumo,
  totNuc,
  numNuae,
  giorniInterni,
  yearDays,
  imposteG,
}) {
  const allocation = allocateTariffConsumption({
    consumption: Math.abs(n2(consumo)),
    tiers: imposteG,
    nucleus: Math.max(1, n2(totNuc)),
    units: 1,
    referenceDays: giorniInterni,
    yearDays,
    key: "STORNO_CONTATORE_GENERALE",
  });

  return {
    impAcquedottoStorno: round2(allocation.total),
    righe: allocation.tiers.map((tier) => ({
      ordine: tier.ordine,
      quantita: tier.mc_allocati,
      tariffa: tier.price,
      importo: tier.importo,
    })),
  };
}

async function calculateGenerale(conn, sessionId, annoAtt = null, annoPrec = null, eurStorno = 0, parsedQF = null) {
  assertUUID(sessionId, "sessionId");

  const n2 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

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
    const y = Number(pa.period_year || new Date().getFullYear());
    const m = Number(pa.period_month || 1);
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const billingRange = resolveBillingDateRange(
      pp,
      pa,
      session.giorni_consumi || session.giorni_interni
    );
    const start = billingRange.startDate;
    const end = billingRange.endDate || monthEnd;

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
      (sum, utenza) => sum + effectiveNucleus(utenza.nucleo),
      0
    );

    const [[condo]] = await conn.query(
      `SELECT nuae FROM condomini_v2 WHERE id = ? LIMIT 1`,
      [session.id_condominio]
    );

    const numNuae = condo?.nuae ? Math.max(1, n2(condo.nuae)) : 1;

    const baseTariffSegments = await loadTariffTimeline(conn, {
      providerId: session.id_casa_idrica,
      categoriaCodice: "RESIDENTE",
      startDate: billingRange.startDate,
      endDate: billingRange.endDate,
    });

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
    const base = calculateTariffPeriodAmounts({
      consumption: consumoNorm,
      segments: baseTariffSegments,
      nucleus: Math.max(1, totNuc),
      units: 1,
      qfUnits: numNuae,
      qfDays: session.giorni_qf,
      varie: session.varie,
      parsedQF,
      key: "CONTATORE_GENERALE",
    });

    // -----------------------------
    // WITH ACCONTO
    // -----------------------------
    const extendedEndDate = addUtcDays(
      billingRange.endDate,
      Math.max(0, n2(session.giorni_acconto))
    ).toISOString().slice(0, 10);
    const withAccTariffSegments = n2(session.giorni_acconto) > 0
      ? await loadTariffTimeline(conn, {
          providerId: session.id_casa_idrica,
          categoriaCodice: "RESIDENTE",
          startDate: billingRange.startDate,
          endDate: extendedEndDate,
        })
      : baseTariffSegments;
    const withAcc = calculateTariffPeriodAmounts({
      consumption: consumoTot,
      segments: withAccTariffSegments,
      nucleus: Math.max(1, totNuc),
      units: 1,
      qfUnits: numNuae,
      qfDays: session.giorni_qf,
      varie: session.varie,
      parsedQF,
      key: "CONTATORE_GENERALE_CON_ACCONTO",
    });

    // -----------------------------
    // ACCONTO BREAKDOWN (DELTA)
    // -----------------------------
    const impConsAcc = round2(withAcc.impAcquedotto - base.impAcquedotto);
    const depFogAcc = round2(withAcc.depFog - base.depFog);
    const ivaAcc = round2(withAcc.iva - base.iva);

    const totAcc = round2(impConsAcc + depFogAcc + ivaAcc);

    // -----------------------------
    // Prefer the full parsed storno total. The tariff calculation remains a
    // compatibility fallback for sessions that only provide manual storno mc.
    // -----------------------------
    const mcStorno =  n2(session.mcStorno) !== 0 ? n2(session.mcStorno) : 0;

   
    const stornoPeriodCalculation = calculateTariffPeriodAmounts({
      consumption: Math.abs(mcStorno),
      segments: baseTariffSegments,
      nucleus: Math.max(1, totNuc),
      units: 1,
      qfUnits: 1,
      qfDays: 0,
      parsedQF: 0,
      aliquotaIva: 0,
      key: "STORNO_CONTATORE_GENERALE",
    });
    const stornoEuro = eurStorno || round2(stornoPeriodCalculation.impAcquedotto);

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
        appliedTariff: buildAppliedTariffSnapshot(
          baseTariffSegments,
          billingRange.startDate,
          billingRange.endDate
        ),
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
        stornoDettaglio: stornoPeriodCalculation.dettaglioAcquedotto,

        totalePrimaStorno,
        totale: totaleFinale,
        totDaPagare: totaleFinale,
      },
    };
}
async function calculateInterni(
  conn,
  session,
  generale,
  tfCode,
  annoAtt,
  annoPrec = null,
  eurStorno = 0,
  abcDocumentTotal,
  parsedOneriPerequazione = null,
  parsedOneriPerequazioneAcconto = null,
  parsedAccontoImporto = null,
  parsedAccontoDepFog = null,
  parsedAccontoTotale = null
) {
  await ensureFattureRigheRecuperoColumns();
  await ensureFattureAccontiTransitionColumns();

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
    const y = Number(periodoAttuale.period_year);
    const m = Number(periodoAttuale.period_month);
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const billingRange = resolveBillingDateRange(
      periodoPrecedente,
      periodoAttuale,
      session.giorni_interni || session.giorni_consumi
    );
    const tariffCache = new Map();
    const getTariffForCategory = async (categoriaCodice) => {
      const code = upper(categoriaCodice, "RESIDENTE");
      if (!tariffCache.has(code)) {
        tariffCache.set(
          code,
          await loadTariffTimeline(conn, {
            providerId: session.id_casa_idrica,
            categoriaCodice: code,
            startDate: billingRange.startDate,
            endDate: billingRange.endDate,
          })
        );
      }
      return tariffCache.get(code);
    };

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
      const tariffSegments = await getTariffForCategory(categoriaCodice);

      const nucleo = effectiveNucleus(first.nucleo);
      const nuaeU = Math.max(1, n2(first.nuae));

      //qui potremmo aggiornare consumoNorm e assegnare una percentuale (60 con tariffe 2024, 40 con tariffe 2025) da addebitare a cavallo di due periodi.

      let impAcq = 0;
      let impFog = 0;
      let impDep = 0;
      
      let user_id = ra0?.id_utenza ?? first.id;

       
      if (consumoNorm !== null) {
        const impNorm = calculateTariffPeriodAmounts({
          consumption: consumoNorm,
          segments: tariffSegments,
          nucleus: nucleo,
          units: nuaeU,
          qfUnits: 1,
          qfDays: 0,
          parsedQF: 0,
          aliquotaIva: 0,
          key: user_id,
        });
  
        impAcq = round2(impNorm.impAcquedotto);
        impFog = round2(impNorm.impFognatura);
        impDep = round2(impNorm.impDepurazione);
        dettaglioConsumiAcquedotto.push(impNorm.dettaglioAcquedotto);
      }
 
      if (consumoTot === null) {
        impFog = 0;
        impDep = 0;
      }
      const impQf = flatTipo === "SPECIAL" ? 0 : round2(qfPerNuae * nuaeU);

      const meterCount = Math.max(1, group.length);
      const impOneri = round2(n2(session.oneri_snapshot) * meterCount);

      totaleOneri += impOneri;

      const impIva = calculateRowVat({
        acquedotto: impAcq,
        fognatura: impFog,
        depurazione: impDep,
        quotaFissa: impQf,
      });
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
        configured_oneri: impOneri,
        imp_oneri_base_display: impOneri,
        imp_oneri_perequazione_display: 0,
        imp_iva: impIva,
        

        imp_acconto: 0,
        depfog_acconto: 0,
        acconto: 0,

        storno_calcolato: 0,   // current invoice storno from mcStorno
        storno_mc_applicato: 0,
        storno_pregresso: 0,   // old ledger credit consumed
        storno_legacy: 0,
        storno_txt_aggiuntivo: 0,
        storno_txt_richiesto: 0,
        storno_txt_compensato_legacy: 0,
        storno_carenza_assorbita: 0,
        credito_storno_residuo: 0,
        credito_storno_residuo_mc: 0,
        credito_storno_ingresso: 0,
        credito_storno_assorbito: 0,
        credito_storno_differito: 0,
        storno_legacy_periodo: null,
        storno_transition_status: null,
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
        _unitMemberIds: group.map((member) => member.id),
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
            configured_oneri: 0,
            imp_oneri_base_display: 0,
            imp_oneri_perequazione_display: 0,
            imp_iva: 0,

            imp_acconto: 0,
            depfog_acconto: 0,
            acconto: 0,

            storno_calcolato: 0,
            storno_mc_applicato: 0,
            storno_pregresso: 0,
            storno_legacy: 0,
            storno_txt_aggiuntivo: 0,
            storno_txt_richiesto: 0,
            storno_txt_compensato_legacy: 0,
            storno_carenza_assorbita: 0,
            credito_storno_residuo: 0,
            credito_storno_residuo_mc: 0,
            credito_storno_ingresso: 0,
            credito_storno_assorbito: 0,
            credito_storno_differito: 0,
            storno_legacy_periodo: null,
            storno_transition_status: null,
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
    const consumptionWeightFn = (r) => Math.max(0, n2(r.consumo_totale));

    if (hasParsedOneri) {
      const perequazioneRows = primaries.filter(
        (r) => r.tfEligible && n2(r.consumo_totale) > 0
      );
      const oneriNormaleShares = allocateByWeight(
        parsedOneriNormale,
        perequazioneRows,
        consumptionWeightFn,
        2
      );

      for (let i = 0; i < perequazioneRows.length; i++) {
        const r = perequazioneRows[i];
        const share = round2(oneriNormaleShares[i] || 0);

        r.imp_oneri = round2(n2(r.imp_oneri) + share);
        r.imp_oneri_perequazione_display = round2(
          n2(r.imp_oneri_perequazione_display) + share
        );
        r.base_totale = round2(n2(r.base_totale) + share);
      }
    }

    const accontoAcquedottoTarget = round2(
      totImpConsAcc > 0 ? totImpConsAcc : totAccEuro
    );
    const accEuroShares = allocateByWeight(totAccEuro, primaries, mcWeightFn, 2);
    const impConsAccShares = allocateByWeight(
      accontoAcquedottoTarget,
      primaries,
      mcWeightFn,
      2
    );
    const depFogAccShares = allocateByWeight(totDepFogAcc, primaries, mcWeightFn, 2);
    const accMcShares = allocateByWeight(totConsAccMc, primaries, mcWeightFn, 3);
    for (let i = 0; i < primaries.length; i++) {
      const r = primaries[i];

      r.acconto = round2(accEuroShares[i] || 0);
      r.imp_acconto = round2(impConsAccShares[i] || 0);
      r.depfog_acconto = round2(depFogAccShares[i] || 0);
      r.consumo_acconto = round3(accMcShares[i] || 0);

      const basePrimaStorno = round2(
        n2(r.base_totale) +
        n2(r.acconto)
      );

      r._base_prima_storno = basePrimaStorno;
      r.storno_calcolato = 0;
      r._storno_calcolato_mc = 0;
      r._storno_credit_euro = 0;
      r._storno_credit_mc = 0;
      r.base_totale = basePrimaStorno;
    }

    let legacyCreditsAvailable = 0;
    let platformCreditsAvailable = 0;

    if (totStornoCalcolato < 0) {
      const requestedReduction = round2(Math.abs(totStornoCalcolato));
      const totalStornoMc = Math.abs(n2(session.mcStorno ?? 0));
      const creditsByPrimary = new Map();

      for (const row of primaries) {
        const memberIds = Array.isArray(row._unitMemberIds)
          ? row._unitMemberIds
          : [row.id_utenza];
        const credits = [];
        for (const idUtenza of memberIds) {
          const memberCredits = await loadOpenAccontoCredits(
            conn,
            idUtenza,
            session.id
          );
          credits.push(...memberCredits);
          for (const credit of memberCredits) {
            const openEuro = Math.max(0, n2(credit.open_euro));
            if (credit.origine_credito === "LEGACY") {
              legacyCreditsAvailable = round2(legacyCreditsAvailable + openEuro);
            } else {
              platformCreditsAvailable = round2(platformCreditsAvailable + openEuro);
            }
          }
        }
        creditsByPrimary.set(row, credits);
      }

      // The TXT is allocated before applying transition rules. This produces
      // the per-user TXT amount that must be compared with the certified legacy
      // acconto. Capacity is intentionally applied afterwards.
      const txtRequestedShares = allocateByWeight(
        requestedReduction,
        primaries,
        moneyWeightFn,
        2
      );
      const txtRequestedMcShares = allocateByWeight(
        totalStornoMc,
        txtRequestedShares.map((share) => ({ share })),
        (item) => item.share,
        3
      );

      for (let index = 0; index < primaries.length; index++) {
        const row = primaries[index];
        const credits = creditsByPrimary.get(row) || [];
        const legacyCredits = credits.filter(
          (credit) => credit.origine_credito === "LEGACY"
        );
        const platformCredits = credits.filter(
          (credit) => credit.origine_credito !== "LEGACY"
        );
        const legacyOpen = round2(
          legacyCredits.reduce(
            (sum, credit) => sum + Math.max(0, n2(credit.open_euro)),
            0
          )
        );
        const platformOpen = round2(
          platformCredits.reduce(
            (sum, credit) => sum + Math.max(0, n2(credit.open_euro)),
            0
          )
        );
        const legacyOpenMc = round3(
          legacyCredits.reduce(
            (sum, credit) => sum + Math.max(0, n2(credit.open_mc)),
            0
          )
        );
        const platformOpenMc = round3(
          platformCredits.reduce(
            (sum, credit) => sum + Math.max(0, n2(credit.open_mc)),
            0
          )
        );
        const txtRequested = round2(Math.max(0, n2(txtRequestedShares[index])));
        const txtRequestedMc = round3(
          Math.max(0, n2(txtRequestedMcShares[index]))
        );
        let remainingEuroCap = round2(getAvailableStornoReductionEuro(row));
        let remainingMcCap = round3(Math.max(0, n2(row.consumo_normale)));
        let legacyUsed = 0;
        let legacyMcUsed = 0;
        let platformUsed = 0;
        let platformMcUsed = 0;
        let txtApplied = 0;
        let txtAppliedMc = 0;
        let txtDeferred = 0;
        let txtDeferredMc = 0;
        let txtMatchedLegacy = 0;
        let shortageAbsorbed = 0;
        let status = "NESSUNO";
        const movements = [];
        const legacyPeriods = new Set();

        row.storno_txt_richiesto = round2(-txtRequested);
        row.credito_storno_ingresso = platformOpen;

        // Confirmed transition trigger: neither legacy nor deferred balances
        // move when this user's allocated TXT storno is zero.
        if (txtRequested > 0 && legacyOpen > 0) {
          const transition = resolveLegacyTxtTransition(txtRequested, legacyOpen);
          const legacyPlan = planCreditConsumption(
            legacyCredits,
            remainingEuroCap,
            remainingMcCap,
            true
          );
          legacyUsed = legacyPlan.euroUsed;
          legacyMcUsed = legacyPlan.mcUsed;
          remainingEuroCap = legacyPlan.remainingEuro;
          remainingMcCap = legacyPlan.remainingMc;
          movements.push(...legacyPlan.movements);
          legacyPlan.periods.forEach((period) => legacyPeriods.add(period));

          // Legacy replaces, rather than adds to, this period's TXT share.
          txtMatchedLegacy = transition.matched;
          shortageAbsorbed =
            legacyUsed + 0.001 < legacyOpen
              ? round2(Math.max(0, legacyUsed - txtRequested))
              : transition.shortageAbsorbed;
          txtDeferred = transition.deferred;
          txtDeferredMc =
            txtRequested > 0
              ? round3((txtRequestedMc * txtDeferred) / txtRequested)
              : 0;

          if (legacyUsed + 0.001 < legacyOpen) {
            status = "LEGACY_PARZIALE_MINIMO";
          } else {
            status = transition.status;
          }
        } else if (txtRequested > 0) {
          // Once the legacy transition is complete, consume the oldest saved
          // residual first. The current TXT is applied second and any part that
          // does not fit becomes the next period's residual.
          const platformPlan = planCreditConsumption(
            platformCredits,
            remainingEuroCap,
            remainingMcCap,
            false
          );
          platformUsed = platformPlan.euroUsed;
          platformMcUsed = platformPlan.mcUsed;
          remainingEuroCap = platformPlan.remainingEuro;
          remainingMcCap = platformPlan.remainingMc;
          movements.push(...platformPlan.movements);

          txtApplied = round2(Math.min(txtRequested, remainingEuroCap));
          txtAppliedMc =
            txtRequested > 0
              ? round3(
                  Math.min(
                    remainingMcCap,
                    txtRequestedMc,
                    (txtRequestedMc * txtApplied) / txtRequested
                  )
                )
              : 0;
          txtDeferred = round2(Math.max(0, txtRequested - txtApplied));
          txtDeferredMc = round3(Math.max(0, txtRequestedMc - txtAppliedMc));

          if (platformUsed > 0 && txtDeferred > 0) {
            status = "RESIDUO_ASSORBITO_TXT_DIFFERITO";
          } else if (platformUsed > 0) {
            status = "RESIDUO_ASSORBITO";
          } else if (txtDeferred > 0) {
            status = "TXT_PARZIALE_DIFFERITO";
          } else {
            status = "TXT_APPLICATO";
          }
        }

        const existingCreditsRemaining = round2(
          Math.max(0, legacyOpen - legacyUsed) +
            Math.max(0, platformOpen - platformUsed)
        );
        const totalAppliedForRow = round2(legacyUsed + platformUsed + txtApplied);

        row.storno_legacy = round2(-legacyUsed);
        row.storno_legacy_periodo = [...legacyPeriods].join(", ") || null;
        row.storno_pregresso = round2(-platformUsed);
        row.storno_txt_aggiuntivo = round2(-txtApplied);
        row.storno_calcolato = row.storno_txt_aggiuntivo;
        row.storno_txt_compensato_legacy = round2(txtMatchedLegacy);
        row.storno_carenza_assorbita = round2(shortageAbsorbed);
        row.credito_storno_assorbito = round2(platformUsed);
        row.credito_storno_differito = round2(txtDeferred);
        row.credito_storno_residuo = round2(
          existingCreditsRemaining + txtDeferred
        );
        row.credito_storno_residuo_mc = round3(
          Math.max(0, legacyOpenMc - legacyMcUsed) +
            Math.max(0, platformOpenMc - platformMcUsed) +
            txtDeferredMc
        );
        row.storno_transition_status = status;
        row._storno_mc = round3(legacyMcUsed + platformMcUsed);
        row._storno_calcolato_mc = txtAppliedMc;
        row.storno_mc_applicato = round3(
          legacyMcUsed + platformMcUsed + txtAppliedMc
        );
        row._storno_movements = movements;
        row._storno_credit_euro = txtDeferred;
        row._storno_credit_mc = txtDeferredMc;
        row.base_totale = round2(n2(row._base_prima_storno) - totalAppliedForRow);
      }
    } else {
      const positiveStornoShares = allocateByWeight(totStornoCalcolato, primaries, moneyWeightFn, 2);
      for (let i = 0; i < primaries.length; i++) {
        const r = primaries[i];
        r.storno_calcolato = round2(positiveStornoShares[i] || 0);
        r.storno_txt_aggiuntivo = r.storno_calcolato;
        r.base_totale = round2(n2(r._base_prima_storno) + n2(r.storno_calcolato));
      }
    }

    totaleOneri = round2(rows.reduce((s, r) => s + n2(r.imp_oneri), 0));
    parsedOneriRemainder = 0;
    generale.totaleOneri = totaleOneri;

    // finalize printable storno field
    for (const r of rows) {
      r.storno_totale = round2(
        n2(r.storno_legacy) + n2(r.storno_pregresso) + n2(r.storno_txt_aggiuntivo)
      );
    }

    // -------------------------------------------------------------------
    // TF base (TF applied on TF1 base, not stacked)
    // -------------------------------------------------------------------
    const baseSum = round2(rows.reduce((s, r) => s + n2(r.base_totale), 0));
    const totConfiguredOneri = round2(
      rows.reduce((sum, row) => sum + n2(row.configured_oneri), 0)
    );
    const previousCreditsApplied = round2(
      rows.reduce(
        (sum, row) =>
          sum + Math.abs(n2(row.storno_legacy)) + Math.abs(n2(row.storno_pregresso)),
        0
      )
    );
    const txtStornoCreditCreated = round2(
      rows.reduce((sum, row) => sum + n2(row._storno_credit_euro), 0)
    );
    const resolvedAbcTotal =
      n2(abcDocumentTotal) > 0 ? n2(abcDocumentTotal) : n2(generale.totale);
    // The condominium control total is immutable. Previous-user credits alter
    // the row allocation, not the amount that must be reconciled for the
    // condominium. TF2/TF3 absorb that redistribution through conguaglio.
    const targetInterniTotal = round2(resolvedAbcTotal + totConfiguredOneri);
    const diff = round2(targetInterniTotal - baseSum);
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
      } else {
        r._minimum_payable_adjustment = 0;
      }
    }

    // Apply conguaglio, minimum payable correction and rounding adjustment.
    // Keep the TF conguaglio value visible as calculated; the minimum correction
    // is carried by ARR so TF2 remains equal across eligible rows.
    for (const r of rows) {
      const minimumPayable = getMinimumPayableForRow(r);
      const beforeMinimum = round2(n2(r.base_totale) + n2(r.conguaglio));
      const beforeRound = round2(beforeMinimum + n2(r._minimum_payable_adjustment));
      const rounded = roundPayableToTenth(beforeRound, minimumPayable);
      const arr = round2(n2(r._minimum_payable_adjustment) + rounded - beforeRound);

      r.imp_arr = arr;
      r.totale = round2(beforeMinimum + arr);
    }

    const normalizedTfCode = normalizeTfCode(tfCode);
    const allocatedParsedOneri = round2(
      rows.reduce(
        (sum, row) => sum + n2(row.imp_oneri_perequazione_display),
        0
      )
    );
    const parsedOneriShareRounding = hasParsedOneri
      ? round2(allocatedParsedOneri - n2(parsedOneriNormale))
      : 0;
    const tf1UnexplainedDifference = round2(diff + parsedOneriShareRounding);
    const canReconcileTf1Rounding =
      normalizedTfCode === "TF1" &&
      Math.abs(tf1UnexplainedDifference) <= 0.05;
    const shouldReconcile =
      ["TF2", "TF3"].includes(normalizedTfCode) ||
      canReconcileTf1Rounding;

    const finalReconciliation = shouldReconcile
      ? reconcileRowsToTarget(rows, targetInterniTotal)
      : {
          total: round2(rows.reduce((sum, row) => sum + n2(row.totale), 0)),
          residual: round2(
            targetInterniTotal -
              rows.reduce((sum, row) => sum + n2(row.totale), 0)
          ),
        };

    const txtStornoRequested =
      totStornoCalcolato < 0 ? round2(Math.abs(totStornoCalcolato)) : 0;
    const txtStornoApplied = round2(
      rows.reduce(
        (sum, row) => sum + Math.abs(Math.min(0, n2(row.storno_txt_aggiuntivo))),
        0
      )
    );
    const txtStornoMatchedLegacy = round2(
      rows.reduce(
        (sum, row) => sum + Math.max(0, n2(row.storno_txt_compensato_legacy)),
        0
      )
    );
    const txtStornoDeferred = round2(
      rows.reduce((sum, row) => sum + n2(row._storno_credit_euro), 0)
    );
    const txtStornoConservationResidual = round2(
      txtStornoRequested -
        txtStornoApplied -
        txtStornoMatchedLegacy -
        txtStornoDeferred
    );
    const rowFormulaErrors = rows
      .filter(
        (row) =>
          Math.abs(
            round2(
              n2(row.totale) -
                (n2(row.base_totale) + n2(row.conguaglio) + n2(row.imp_arr))
            )
          ) > 0.01
      )
      .map((row) => row.id_utenza);
    const minimumErrors = rows
      .filter(
        (row) => n2(row.totale) + 0.01 < getMinimumPayableForRow(row)
      )
      .map((row) => row.id_utenza);
    const legacyCreditsApplied = round2(
      rows.reduce((sum, row) => sum + Math.abs(n2(row.storno_legacy)), 0)
    );
    const platformCreditsApplied = round2(
      rows.reduce((sum, row) => sum + Math.abs(n2(row.storno_pregresso)), 0)
    );
    const creditOveruseResidual = round2(
      Math.max(0, legacyCreditsApplied - legacyCreditsAvailable) +
        Math.max(0, platformCreditsApplied - platformCreditsAvailable)
    );
    const accontoAccounting = buildAccontoAccountingCheck({
      rows,
      expectedTotal: totAccEuro,
      expectedAcquedotto: accontoAcquedottoTarget,
      expectedDepFog: totDepFogAcc,
    });
    const accountingChecks = {
      controlTarget: targetInterniTotal,
      expectedControlTarget: round2(resolvedAbcTotal + totConfiguredOneri),
      reconciledTotal: finalReconciliation.total,
      reconciliationResidual: finalReconciliation.residual,
      txtStornoRequested,
      txtStornoApplied,
      txtStornoMatchedLegacy,
      txtStornoDeferred,
      txtStornoConservationResidual,
      previousCreditsApplied,
      legacyCreditsAvailable,
      legacyCreditsApplied,
      platformCreditsAvailable,
      platformCreditsApplied,
      creditOveruseResidual,
      rowFormulaErrors,
      minimumErrors,
      acconto: accontoAccounting,
      passed:
        Math.abs(txtStornoConservationResidual) <= 0.01 &&
        creditOveruseResidual <= 0.01 &&
        rowFormulaErrors.length === 0 &&
        minimumErrors.length === 0 &&
        accontoAccounting.passed,
    };

    if (!accountingChecks.passed) {
      const error = new Error(
        "Controllo contabile interno non superato. Il calcolo non e stato salvato."
      );
      error.statusCode = 422;
      error.accountingChecks = accountingChecks;
      throw error;
    }

    if (
      normalizedTfCode !== "TF1" &&
      Math.abs(finalReconciliation.residual) >= 0.01
    ) {
      const error = new Error(
        `Impossibile riconciliare il totale interni: residuo EUR ${finalReconciliation.residual.toFixed(
          2
        )}. Verificare il minimo pagabile e i crediti da riportare.`
      );
      error.statusCode = 422;
      throw error;
    }

    const calculationWarnings =
      normalizedTfCode === "TF1" &&
      Math.abs(tf1UnexplainedDifference) > 0.05
        ? [
            {
              code: "TF1_NOT_RECONCILED",
              level: "suggestion",
              difference: tf1UnexplainedDifference,
              message: `TF1 applicata con conguaglio pari a zero. La ripartizione differisce di EUR ${Math.abs(
                tf1UnexplainedDifference
              ).toFixed(
                2
              )} dal totale di controllo (documento provider + oneri condominio). Puoi mantenere TF1 oppure valutare TF2/TF3 per riconciliare il totale.`,
            },
          ]
        : [];

    // Replace the previous snapshot only after every accounting check passes.
    // This keeps the last valid rows intact when a recalculation is rejected.
    await conn.query(
      `DELETE FROM fatture_acconti_movimenti
       WHERE id_fattura = ?
         AND COALESCE(origine_credito, '') <> 'LEGACY'`,
      [session.id]
    );
    await conn.query(`DELETE FROM fatture_righe WHERE id_fattura = ?`, [session.id]);

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
         imp_qf, imp_oneri, configured_oneri, imp_oneri_perequazione, imp_iva,
         conguaglio, imp_arr,
         totale,
         imp_acconto, depfog_acconto, acconto, storno_acconto,
         storno_legacy, storno_pregresso, storno_txt_aggiuntivo,
         storno_txt_richiesto, storno_txt_compensato_legacy,
         storno_carenza_assorbita, storno_mc_applicato,
         credito_storno_residuo, credito_storno_residuo_mc,
         credito_storno_ingresso, credito_storno_assorbito,
         credito_storno_differito, storno_legacy_periodo,
         storno_transition_status,
         recupero_lettura, recupero_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          r.configured_oneri,
          r.imp_oneri_perequazione_display,
          r.imp_iva,

          r.conguaglio,
          r.imp_arr,

          r.totale,

          r.imp_acconto,
          r.depfog_acconto,
          r.acconto,
          r.storno_totale,
          r.storno_legacy,
          r.storno_pregresso,
          r.storno_txt_aggiuntivo,
          r.storno_txt_richiesto,
          r.storno_txt_compensato_legacy,
          r.storno_carenza_assorbita,
          r.storno_mc_applicato,
          r.credito_storno_residuo,
          r.credito_storno_residuo_mc,
          r.credito_storno_ingresso,
          r.credito_storno_assorbito,
          r.credito_storno_differito,
          r.storno_legacy_periodo,
          r.storno_transition_status,
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
           tipo_movimento, importo_euro, importo_mc, source_movimento_id,
           origine_credito, periodo_origine, note)
          VALUES (?, ?, ?, ?, 'RETTIFICA_POS', ?, ?, NULL, 'TXT_DIFFERITO', ?, ?)
          `,
          [
            uuid(),
            r.id_utenza,
            session.id,
            r.id_riga_fattura,
            round2(n2(r._storno_credit_euro)),
            round3(n2(r._storno_credit_mc)),
            `${Number(periodoAttuale.period_month)}/${Number(periodoAttuale.period_year)}`,
            'Credito storno TXT differito al periodo successivo',
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
              sm.id_utenza || r.id_utenza,
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
      totConfiguredOneri,
      totIva,
      sumUtenti,
      totConguaglio,
      totArr,
      baseSum,
      targetInterniTotal,
      previousCreditsApplied,
      txtStornoCreditCreated,
      reconciledTotal: finalReconciliation.total,
      reconciliationResidual: finalReconciliation.residual,
      accountingChecks,
      calculationWarnings,
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
    await assertNoLaterCalculatedBillingPeriods(conn, session);
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
      importedDocumentId ??
      calculationContext?.importedDocumentId ??
      session.imported_document_id ??
      null;
    let resolvedAbcDocumentTotal = n2(
      calculationContext?.totaleDocumento ?? totaleParsedWithOneri
    );
    let resolvedEurStorno = eurStorno;
    let resolvedMcStorno = calculationContext?.mcStorno ?? session.mcStorno;
    let resolvedStornoSource = "request";
    let resolvedStornoBreakdown = {
      mc: n2(calculationContext?.stornoBreakdown?.mc ?? resolvedMcStorno),
      acquedotto: n2(
        calculationContext?.stornoBreakdown?.acquedotto ??
          calculationContext?.parsedStornoAcquedotto
      ),
      depFog: n2(
        calculationContext?.stornoBreakdown?.depFog ??
          calculationContext?.parsedStornoDepFog
      ),
      depurazione: n2(calculationContext?.stornoBreakdown?.depurazione),
      fognatura: n2(calculationContext?.stornoBreakdown?.fognatura),
      quotaFissa: n2(
        calculationContext?.stornoBreakdown?.quotaFissa ??
          calculationContext?.parsedStornoQuotaFissa
      ),
      iva: n2(
        calculationContext?.stornoBreakdown?.iva ??
          calculationContext?.parsedStornoIva
      ),
      oneri: n2(
        calculationContext?.stornoBreakdown?.oneri ??
          calculationContext?.parsedOneriPerequazioneStorno
      ),
      totale: n2(
        calculationContext?.stornoBreakdown?.totale ??
          calculationContext?.parsedStornoTotale ??
          eurStorno
      ),
      source: calculationContext?.stornoBreakdown?.source || "request",
    };

    if (resolvedImportedDocumentId) {
      const [docRows] = await conn.query(
        `SELECT * FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
        [resolvedImportedDocumentId]
      );
      const importedDoc = docRows[0] ? enrichImportedDocumentWithStoredTxtSummary(docRows[0]) : null;
      if (!importedDoc) {
        const error = new Error("Documento associato alla sessione non trovato");
        error.statusCode = 404;
        throw error;
      }
      if (
        importedDoc.provider_id &&
        String(importedDoc.provider_id) !== String(session.id_casa_idrica)
      ) {
        const [[sessionProvider]] = await conn.query(
          `SELECT codice, nome FROM casa_idrica WHERE id = ? LIMIT 1`,
          [session.id_casa_idrica]
        );
        const [[documentProvider]] = await conn.query(
          `SELECT codice, nome FROM casa_idrica WHERE id = ? LIMIT 1`,
          [importedDoc.provider_id]
        );
        const error = new Error(
          `Provider non coerente: il documento e ${documentProvider?.codice || documentProvider?.nome || importedDoc.provider_id}, mentre la sessione usa ${sessionProvider?.codice || sessionProvider?.nome || session.id_casa_idrica}. Riassocia il documento prima del calcolo.`
        );
        error.statusCode = 409;
        throw error;
      }
      if (
        importedDoc?.importo_totale_da_pagare !== null &&
        importedDoc?.importo_totale_da_pagare !== undefined &&
        Number.isFinite(Number(importedDoc.importo_totale_da_pagare))
      ) {
        resolvedAbcDocumentTotal = n2(importedDoc.importo_totale_da_pagare);
      }
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
      // A parsed TXT is authoritative even when its storno is exactly zero.
      // Treating zero as a missing value could reuse a stale request/session
      // amount and consume credits in a period that contains no TXT storno.
      if (importedPayload) {
        resolvedEurStorno = stornoFromDoc.euro;
        resolvedMcStorno = stornoFromDoc.mc;
        resolvedStornoSource = stornoFromDoc.source;
        resolvedStornoBreakdown = {
          mc: stornoFromDoc.mc,
          acquedotto: stornoFromDoc.acquedotto,
          depurazione: stornoFromDoc.depurazione,
          fognatura: stornoFromDoc.fognatura,
          depFog: stornoFromDoc.depFog,
          quotaFissa: stornoFromDoc.quotaFissa,
          iva: stornoFromDoc.iva,
          oneri: stornoFromDoc.oneri,
          totale: stornoFromDoc.totale,
          source: stornoFromDoc.source,
        };
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

    let calculationContextJson = calculationContext
      ? JSON.stringify({
          ...calculationContext,
          tfCode: effectiveTfCode,
          importedDocumentId: resolvedImportedDocumentId,
          totaleDocumento: resolvedAbcDocumentTotal,
          eurStorno: resolvedEurStorno,
          mcStorno: resolvedMcStorno,
          stornoSource: resolvedStornoSource,
          parsedStornoAcquedotto: resolvedStornoBreakdown.acquedotto,
          parsedStornoDepFog: resolvedStornoBreakdown.depFog,
          parsedStornoQuotaFissa: resolvedStornoBreakdown.quotaFissa,
          parsedStornoIva: resolvedStornoBreakdown.iva,
          parsedOneriPerequazioneStorno: resolvedStornoBreakdown.oneri,
          parsedStornoTotale: resolvedStornoBreakdown.totale,
          stornoBreakdown: resolvedStornoBreakdown,
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
      resolvedAbcDocumentTotal,
      parsedOneriPerequazione,
      parsedOneriPerequazioneAcconto,
      parsedAccontoImporto,
      parsedAccontoDepFog,
      parsedAccontoTotale
    );

    if (generaleResult.meta.appliedTariff?.fallback_used) {
      const fallbackPeriods = (generaleResult.meta.appliedTariff.periods || [])
        .filter((period) => period.fallback)
        .map(
          (period) =>
            `${period.start} - ${period.end_exclusive} (${period.version.anno})`
        );
      interniTotals.calculationWarnings = [
        ...(interniTotals.calculationWarnings || []),
        {
          code: "TARIFF_LATEST_FALLBACK",
          level: "warning",
          message:
            `Tariffa valida non presente per una parte del periodo. ` +
            `E stata applicata la versione piu recente disponibile: ${fallbackPeriods.join(", ")}.`,
        },
      ];
    }

    if (calculationContextJson) {
      calculationContextJson = JSON.stringify({
        ...JSON.parse(calculationContextJson),
        abcDocumentTotal: resolvedAbcDocumentTotal,
        configuredOneriTotal: interniTotals.totConfiguredOneri,
        targetInterniTotal: interniTotals.targetInterniTotal,
        reconciledInterniTotal: interniTotals.reconciledTotal,
        reconciliationResidual: interniTotals.reconciliationResidual,
        accountingChecks: interniTotals.accountingChecks,
        calculationWarnings: interniTotals.calculationWarnings,
        appliedTariff: generaleResult.meta.appliedTariff,
      });
    } else {
      calculationContextJson = JSON.stringify({
        tfCode: effectiveTfCode,
        importedDocumentId: resolvedImportedDocumentId,
        totaleDocumento: resolvedAbcDocumentTotal,
        appliedTariff: generaleResult.meta.appliedTariff,
        accountingChecks: interniTotals.accountingChecks,
        calculationWarnings: interniTotals.calculationWarnings,
        savedAt: new Date().toISOString(),
      });
    }
    
    
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
        interniTotals.totConfiguredOneri,
        round2(
          (resolvedAbcDocumentTotal > 0
            ? resolvedAbcDocumentTotal
            : n2(g.totale)) + n2(interniTotals.totConfiguredOneri)
        ),
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
        pa.data_lettura_operatore AS periodo_attuale_data_operatore,
        pa.data_lettura_casa_idrica AS periodo_attuale_data_casa_idrica,
        pp.period_year AS periodo_precedente_anno,
        pp.period_month AS periodo_precedente_mese,
        pp.data_lettura_operatore AS periodo_precedente_data_operatore,
        pp.data_lettura_casa_idrica AS periodo_precedente_data_casa_idrica,
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

    return rows.map((row) => ({
      ...row,
      imported_document_id: row.linked_imported_document_id || null,
    }));
  } finally {
    conn.release();
  }
};
exports.getAvailablePeriods = async function ({ condominioId }) {
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query(
      `
      SELECT
        id,
        period_year,
        period_month,
        data_lettura_operatore,
        data_lettura_casa_idrica
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

function reconcileRowsToTarget(rows, targetTotal) {
  const currentTotal = () =>
    round2(rows.reduce((sum, row) => sum + n2(row.totale), 0));

  let residual = round2(n2(targetTotal) - currentTotal());
  if (Math.abs(residual) < 0.01) {
    return { total: currentTotal(), residual: 0 };
  }

  const primaryRows = rows.filter((row) => row._isPrimary);
  const eligibleRows = primaryRows.filter(
    (row) => row.tfEligible && n2(row.consumo_totale) > 0
  );
  const candidates = eligibleRows.length ? eligibleRows : primaryRows;

  if (!candidates.length) {
    return { total: currentTotal(), residual };
  }

  if (residual > 0) {
    const row = [...candidates].sort(
      (a, b) => n2(b.totale) - n2(a.totale)
    )[0];

    row.imp_arr = round2(n2(row.imp_arr) + residual);
    row.totale = round2(n2(row.totale) + residual);
  } else {
    let reductionLeft = round2(Math.abs(residual));
    const reducibleRows = [...candidates]
      .map((row) => ({
        row,
        capacity: Math.max(
          0,
          round2(n2(row.totale) - getMinimumPayableForRow(row))
        ),
      }))
      .filter((entry) => entry.capacity > 0)
      .sort((a, b) => b.capacity - a.capacity);

    for (const entry of reducibleRows) {
      if (reductionLeft < 0.01) break;

      const reduction = Math.min(entry.capacity, reductionLeft);
      entry.row.imp_arr = round2(n2(entry.row.imp_arr) - reduction);
      entry.row.totale = round2(n2(entry.row.totale) - reduction);
      reductionLeft = round2(reductionLeft - reduction);
    }
  }

  residual = round2(n2(targetTotal) - currentTotal());
  return {
    total: currentTotal(),
    residual: Math.abs(residual) < 0.01 ? 0 : residual,
  };
}

exports.createImportedDocument = async function (payload) {
  if (!payload?.condominioId) {
    throw new Error("condominioId mancante");
  }
  if (!payload?.originalFilename) {
    throw new Error("originalFilename mancante");
  }

  if (payload.manualEntry === true) {
    const invalidManualEntry = (message) => {
      const err = new Error(message);
      err.statusCode = 400;
      return err;
    };
    const manualConsumption = Number(payload.consumoGlobaleMc);
    const manualTotal = Number(payload.importoTotaleDaPagare);

    if (!payload.providerId) {
      throw invalidManualEntry("providerId mancante per l'inserimento manuale");
    }
    if (!payload.dataInizioPeriodo || !payload.dataFinePeriodo) {
      throw invalidManualEntry("Periodo fatturato incompleto per l'inserimento manuale");
    }
    if (payload.dataInizioPeriodo > payload.dataFinePeriodo) {
      throw invalidManualEntry("La data iniziale non puo essere successiva alla data finale");
    }
    if (
      payload.consumoGlobaleMc === null ||
      payload.consumoGlobaleMc === undefined ||
      payload.consumoGlobaleMc === "" ||
      !Number.isFinite(manualConsumption) ||
      manualConsumption < 0
    ) {
      throw invalidManualEntry("Consumo globale non valido per l'inserimento manuale");
    }
    if (
      payload.importoTotaleDaPagare === null ||
      payload.importoTotaleDaPagare === undefined ||
      payload.importoTotaleDaPagare === "" ||
      !Number.isFinite(manualTotal) ||
      manualTotal < 0
    ) {
      throw invalidManualEntry("Totale documento non valido per l'inserimento manuale");
    }

    const allowedBillTypes = new Set(["estimated", "actual", "mixed", "unknown"]);
    const billType = allowedBillTypes.has(payload.billType) ? payload.billType : "unknown";
    if (payload.sessionId) {
      await ensureFattureSessionContextColumns();
    }
    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();

      if (payload.sessionId) {
        const [sessionRows] = await conn.query(
          `
          SELECT id
          FROM fatture_sessioni
          WHERE id = ? AND id_condominio = ?
          LIMIT 1
          FOR UPDATE
          `,
          [payload.sessionId, payload.condominioId]
        );

        if (!sessionRows.length) {
          const err = new Error("Sessione fatturazione non trovata per il condominio indicato");
          err.statusCode = 404;
          throw err;
        }
      }

      const parseStatus = payload.sessionId ? "imported" : "reviewed";
      const [insertResult] = await conn.query(
        `
        INSERT INTO imported_invoice_documents (
          condominio_id,
          provider_id,
          original_filename,
          stored_filename,
          mime_type,
          file_size_bytes,
          numero_bolletta,
          codice_fornitura,
          codice_cliente,
          punto_erogazione,
          matricola_contatore,
          intestatario,
          indirizzo_fornitura,
          fornitore_servizi,
          bill_type,
          data_inizio_periodo,
          data_fine_periodo,
          consumo_globale_mc,
          importo_totale_da_pagare,
          parser_version,
          parser_confidence,
          parse_status,
          validation_status,
          parsed_payload_json,
          validation_json,
          parser_error_text,
          linked_session_id,
          parsed_at,
          reviewed_at,
          imported_at
        ) VALUES (
          ?, ?, ?, NULL, 'application/x-idromardi-manual', 0,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'manual-entry-v1', 1, ?, 'valid', ?, ?, NULL, ?, NOW(), NOW(),
          CASE WHEN ? IS NULL THEN NULL ELSE NOW() END
        )
        `,
        [
          payload.condominioId,
          payload.providerId ?? null,
          payload.originalFilename,
          payload.numeroBolletta ?? null,
          payload.codiceFornitura ?? null,
          payload.codiceCliente ?? null,
          payload.puntoErogazione ?? null,
          payload.matricolaContatore ?? null,
          payload.intestatario ?? null,
          payload.indirizzoFornitura ?? null,
          payload.fornitoreServizi ?? null,
          billType,
          payload.dataInizioPeriodo ?? null,
          payload.dataFinePeriodo ?? null,
          payload.consumoGlobaleMc ?? null,
          payload.importoTotaleDaPagare ?? null,
          parseStatus,
          payload.parsedPayload !== undefined ? JSON.stringify(payload.parsedPayload) : null,
          payload.validation !== undefined ? JSON.stringify(payload.validation) : null,
          payload.sessionId ?? null,
          payload.sessionId ?? null,
        ]
      );

      const documentId = insertResult.insertId;

      if (payload.sessionId) {
        await conn.query(
          `UPDATE imported_invoice_documents SET linked_session_id = NULL WHERE linked_session_id = ? AND id <> ?`,
          [payload.sessionId, documentId]
        );
        await conn.query(
          `
          UPDATE fatture_sessioni
          SET
            imported_document_id = ?,
            id_casa_idrica = COALESCE(?, id_casa_idrica)
          WHERE id = ?
          `,
          [documentId, payload.providerId ?? null, payload.sessionId]
        );
      }

      const [rows] = await conn.query(
        `SELECT * FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
        [documentId]
      );

      await conn.commit();
      return { ok: true, document: rows[0] || null };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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

exports.listImportedDocumentsByCondominio = async function (condominioId, sessionId = null) {
  if (sessionId) {
    const [sessionRows] = await db.query(
      `
      SELECT id
      FROM fatture_sessioni
      WHERE BINARY id = BINARY ?
        AND BINARY id_condominio = BINARY ?
      LIMIT 1
      `,
      [sessionId, condominioId]
    );

    if (!sessionRows.length) {
      const err = new Error("Periodo di fatturazione non trovato per il condominio indicato");
      err.statusCode = 404;
      throw err;
    }
  }

  const sql = `
    SELECT
      iid.id,
      iid.condominio_id,
      iid.provider_id,
      iid.original_filename,
      iid.numero_bolletta,
      iid.codice_fornitura,
      iid.fornitore_servizi,
      iid.bill_type,
      iid.data_inizio_periodo,
      iid.data_fine_periodo,
      iid.consumo_globale_mc,
      iid.importo_totale_da_pagare,
      iid.parse_status,
      iid.validation_status,
      iid.linked_session_id,
      iid.uploaded_at,
      iid.parsed_at,
      iid.imported_at
    FROM imported_invoice_documents iid
    WHERE BINARY iid.condominio_id = BINARY ?
      AND (
        ? IS NULL
        OR EXISTS (
          SELECT 1
          FROM fatture_sessioni fs
          WHERE BINARY fs.id = BINARY ?
            AND BINARY fs.id_condominio = BINARY ?
            AND (
              iid.id = fs.imported_document_id
              OR BINARY iid.linked_session_id = BINARY fs.id
            )
        )
      )
    ORDER BY iid.created_at DESC
  `;

  const [rows] = await db.query(sql, [
    condominioId,
    sessionId,
    sessionId,
    condominioId,
  ]);
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
      `UPDATE fatture_sessioni SET imported_document_id = NULL WHERE imported_document_id = ?`,
      [id]
    );

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
    try {
      deletedFile = await deleteImportedDocumentFile(doc.stored_filename);
    } catch (fileErr) {
      console.error("Errore eliminazione file importato:", fileErr);
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

  const allowedParseStatuses = new Set(["uploaded", "parsed", "reviewed", "imported", "failed"]);
  const allowedValidationStatuses = new Set(["pending", "valid", "warning", "error"]);
  const allowedBillTypes = new Set(["estimated", "actual", "mixed", "unknown"]);
  const parseStatus = allowedParseStatuses.has(payload.parseStatus)
    ? payload.parseStatus
    : "parsed";
  const validationStatus = allowedValidationStatuses.has(payload.validationStatus)
    ? payload.validationStatus
    : "pending";
  const billType = allowedBillTypes.has(payload.billType) ? payload.billType : "unknown";

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
      END,
      reviewed_at = CASE
        WHEN ? = 'reviewed' THEN NOW()
        ELSE reviewed_at
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
    billType,
    payload.dataInizioPeriodo ?? null,
    payload.dataFinePeriodo ?? null,
    payload.consumoGlobaleMc ?? null,
    payload.importoTotaleDaPagare ?? null,
    payload.parserVersion ?? null,
    payload.parserConfidence ?? null,
    parseStatus,
    validationStatus,
    payload.parsedPayload !== undefined ? JSON.stringify(payload.parsedPayload) : null,
    payload.validation !== undefined ? JSON.stringify(payload.validation) : null,
    payload.parserErrorText ?? null,
    parseStatus,
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
    `SELECT id, provider_id FROM imported_invoice_documents WHERE id = ? LIMIT 1`,
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
    SET
      imported_document_id = ?,
      id_casa_idrica = COALESCE(?, id_casa_idrica)
    WHERE id = ?
    `,
    [id, existingRows[0].provider_id || null, sessionId]
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
