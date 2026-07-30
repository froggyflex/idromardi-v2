const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const pdf = require("pdf-parse");
const db = require("../../config/db");
const puppeteer = require("puppeteer");

const BASE_URL = process.env.BASE_URL;

const logoUrl = `${BASE_URL}/images/image.png`;
 
function toFileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, "/")}`;
}

function resolveLogoUrl(logoPathOrUrl) {
  // 1. If database/env already gives full URL, use it
  if (logoPathOrUrl?.startsWith("http://") || logoPathOrUrl?.startsWith("https://")) {
    return logoPathOrUrl;
  }

  // 2. If database gives relative uploaded path
  // example: /uploads/logos/company-1.png
  if (logoPathOrUrl?.startsWith("/uploads/")) {
    const absolutePath = path.resolve(__dirname, "../../../", `.${logoPathOrUrl}`);

    if (fs.existsSync(absolutePath)) {
      return toFileUrl(absolutePath);
    }
  }

  // 3. Default fallback logo
  const fallbackPath = path.resolve(
    __dirname,
    "../../../../frontend/public/images/logo_colorato.png"
  );

  if (fs.existsSync(fallbackPath)) {
    return toFileUrl(fallbackPath);
  }

  return null;
}

function safeJsonParse(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeWhitespace(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function extractFirst(text, regex) {
  const m = text.match(regex);
  return m?.[1] ? String(m[1]).trim() : null;
}

// function parseItalianAmount(raw) {
//   if (!raw) return null;
//   const normalized = String(raw).replace(/\./g, "").replace(",", ".").trim();
//   const num = Number(normalized);
//   return Number.isFinite(num) ? num : null;
// }
function getLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function cleanValue(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function parseItalianAmount(value) {
  if (!value) return null;
  const normalized = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function monthNameToNumberIT(month) {
  const map = {
    gennaio: "01",
    febbraio: "02",
    marzo: "03",
    aprile: "04",
    maggio: "05",
    giugno: "06",
    luglio: "07",
    agosto: "08",
    settembre: "09",
    ottobre: "10",
    novembre: "11",
    dicembre: "12"
  };
  return map[String(month || "").toLowerCase()] || null;
}

function extractSupplierInfo(lines) {
  const head = lines.slice(0, 5);

  for (const line of head) {
    const m = line.match(
      /^(.*?)\s*(?:-|–|—)?\s*(?:P\.?\s*IVA|PARTITA\s+IVA)\s*:?\s*([A-Z0-9 ]{8,20})/i
    );
    if (m) {
      return {
        supplierName: cleanValue(m[1]) || null,
        supplierVatNumber: cleanValue(m[2]).replace(/\s+/g, "") || null
      };
    }
  }

  return {
    supplierName: cleanValue(head[0] || "") || null,
    supplierVatNumber: null
  };
}

function extractDocumentHeader(text) {
  const normalized = normalizePdfText(text);

  const pattern =
    /(?:Proforma\s+di\s+fattura|Proforma|Fattura)\s*(?:n\.|nr\.|n°|num\.?)?\s*([A-Z0-9/-]+)\s+d(?:el|ell['’])\s*([^\n]+)/i;

  const m = normalized.match(pattern);

  if (!m) {
    return {
      documentType: null,
      invoiceNumber: null,
      invoiceDate: null,
    };
  }

  const headerText = m[0];

  return {
    documentType: /proforma/i.test(headerText) ? "proforma_invoice" : "invoice",
    invoiceNumber: cleanValue(m[1]) || null,
    invoiceDate: parseItalianLongDate(cleanValue(m[2])) || null,
  };
}

function extractCustomerInfo(lines) {
  const idx = lines.findIndex((l) => /^Spett\.?le\b/i.test(l));

  if (idx === -1) {
    return {
      customerName: null,
      customerVatOrTaxCode: null,
      customerAddressLines: []
    };
  }

  const block = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];

    if (
      /^Lettura\b/i.test(line) ||
      /^Totale\b/i.test(line) ||
      /^Oggetto\b/i.test(line) ||
      /^Descrizione\b/i.test(line)
    ) {
      break;
    }

    block.push(line);
  }

  let customerVatOrTaxCode = null;
  const addressLines = [];

  for (const line of block) {
    const m = line.match(
      /(?:C\.?\s*F\.?|COD\.?\s*FISCALE|P\.?\s*IVA|C\.?\s*F\.?\s*\/\s*P\.?\s*IVA)\s*:?\s*([A-Z0-9]{8,20})/i
    );

    if (m && !customerVatOrTaxCode) {
      customerVatOrTaxCode = cleanValue(m[1]);
    } else {
      addressLines.push(line);
    }
  }

  return {
    customerName: cleanValue(addressLines[0] || "") || null,
    customerVatOrTaxCode,
    customerAddressLines: addressLines.slice(1)
  };
}

function extractServiceInfo(text) {
  const normalized = normalizePdfText(text);

  const descriptionMatch = normalized.match(
    /Lettura\s+e\s+fatturazione\s+consumi\s+idrici/i
  );

  const periodMatch = normalized.match(
    /periodo\s+(.+?)(?:\s+per\s+condominio|\s+sito\s+in|\n|$)/i
  );

  const addressMatch = normalized.match(
    /sito\s+in\s+(.+?)(?:\.|\n|$)/i
  );

  return {
    serviceDescription: descriptionMatch
      ? "Lettura e fatturazione consumi idrici"
      : null,
    servicePeriodDescription: periodMatch
      ? `periodo ${cleanValue(periodMatch[1])}`
      : null,
    propertyAddress: addressMatch ? cleanValue(addressMatch[1]) : null
  };
}

function extractPaymentInfo(text) {
  const normalized = normalizePdfText(text);

  const ibanMatch = normalized.match(
    /\bIBAN\b\s*:?\s*([A-Z]{2}\d{2}[A-Z0-9 ]{10,40})/i
  );

  const swiftMatch = normalized.match(
    /\b(?:SWIFT|BIC)\b\s*:?\s*([A-Z0-9]{8,11})/i
  );

  const paymentMethodMatch = normalized.match(
    /versato\s+a\s+mezzo\s+([^.:\n]+)/i
  );

  return {
    paymentMethod: paymentMethodMatch ? cleanValue(paymentMethodMatch[1]) : null,
    iban: ibanMatch ? cleanValue(ibanMatch[1]).replace(/\s+/g, "") : null,
    swift: swiftMatch ? cleanValue(swiftMatch[1]) : null
  };
}
function extractNotes(lines) {
  return lines.filter((l) =>
    /entro\s+\d+\s+giorni.*pagamento/i.test(
      l.replace(/[’']/g, "'")
    )
  );
}

function extractTotalAmount(text) {
  const normalized = normalizePdfText(text);
  const lines = normalized
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const labelScore =
      /totale da pagare/i.test(line) ? 100 :
      /importo totale/i.test(line) ? 90 :
      /totale fattura/i.test(line) ? 85 :
      /^totale\b/i.test(line) ? 70 :
      /totale/i.test(line) ? 50 : 0;

    if (!labelScore) continue;

    const sameLineMatch = line.match(/€?\s*([\d.]+,\d{2})\b/);
    if (sameLineMatch) {
      const amount = parseItalianAmount(sameLineMatch[1]);
      if (amount !== null) {
        candidates.push({ amount, score: labelScore + 20, line });
      }
    }

    const nextLine = lines[i + 1] || "";
    const nextLineMatch = nextLine.match(/^€?\s*([\d.]+,\d{2})\b/);
    if (nextLineMatch) {
      const amount = parseItalianAmount(nextLineMatch[1]);
      if (amount !== null) {
        candidates.push({ amount, score: labelScore + 10, line: `${line} ${nextLine}` });
      }
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => b.score - a.score);
  console.log("Total amount candidates:", candidates);
  return candidates[0].amount;
}

function parseItalianLongDate(value) {
  if (!value) return null;

  const m = cleanValue(value).match(
    /(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i
  );

  if (!m) return null;

  const day = String(m[1]).padStart(2, "0");
  const month = monthNameToNumberIT(m[2]);
  const year = m[3];

  if (!month) return null;
  return `${year}-${month}-${day}`;
}
function normalizePdfText(raw) {
  return String(raw || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .replace(/[–—]/g, "-")
    .replace(/€/g, "€ ")
    .replace(/\s+:\s+/g, ": ")
    .trim();
}

function parseProformaRawText(rawText, isFatura = false) {

  const normalizedText = normalizePdfText(rawText);

  const lines = getLines(normalizedText);

  const supplier = extractSupplierInfo(lines);
  const header = extractDocumentHeader(normalizedText);
  const customer = extractCustomerInfo(lines);
  const service = extractServiceInfo(normalizedText);
  const payment = extractPaymentInfo(normalizedText);
  const totalAmount = extractTotalAmount(normalizedText);
  const notes = extractNotes(lines);

  const warnings = [];

  if (!header.invoiceNumber) warnings.push("Invoice number not found");
  if (!header.invoiceDate) warnings.push("Invoice date not found");
  if (!supplier.supplierName) warnings.push("Supplier name not found");
  if (!totalAmount && totalAmount !== 0) warnings.push("Total amount not found");
  if (!customer.customerName) warnings.push("Customer name not found");

  return {
    documentType: header.documentType,
    supplierName: supplier.supplierName,
    supplierVatNumber: supplier.supplierVatNumber,
    invoiceNumber: header.invoiceNumber,
    invoiceDate: header.invoiceDate,
    customerName: customer.customerName,
    customerVatOrTaxCode: customer.customerVatOrTaxCode,
    customerAddressLines: customer.customerAddressLines,
    serviceDescription: service.serviceDescription,
    servicePeriodDescription: service.servicePeriodDescription,
    propertyAddress: service.propertyAddress,
    totalAmount,
    currency: "EUR",
    paymentMethod: payment.paymentMethod,
    iban: payment.iban,
    swift: payment.swift,
    notes,
    warnings,
    rawText: ""//rawText
  };
}

function parseProformaText(rawText) {
  const text = normalizeWhitespace(rawText);

  const numero =
    extractFirst(text, /(?:proforma|numero|n|n.[°º.]?)\s*[:\-]?\s*([A-Z0-9\/\-_]+)/i);

  const dateMatches = text.match(/\b(\d{2}\/\d{2}\/\d{4})\b/g) || [];
  const dataDocumento = dateMatches[0] || null;

  const importoRaw =
    extractFirst(
      text,
      /(?:totale|importo(?:\s+totale)?|da\s+pagare)\s*[:\-]?\s*€?\s*([\d\.\,]+)/i
    ) ||
    extractFirst(text, /€\s*([\d\.\,]+)/i);

  const importo = parseItalianAmount(importoRaw);

  const intestatario =
    extractFirst(text, /(?:intestatario|cliente|nominativo)\s*[:\-]?\s*([A-ZÀ-ÿ0-9\.\' ]{4,})/i);

  return {
    documentType: "PROFORMA",
    numero,
    dataDocumento,
    importo,
    intestatario,
    rawText,
  };
}

async function listProformas() {
  const [rows] = await db.query(
    `
    SELECT
      p.id,
      p.condominio_id,
      p.fattura_id,
      p.numero_progressivo,
      p.numero,
      p.descrizione,
      p.data_documento,
      p.importo,
      p.stato,
      p.source_import_file_id,
      p.created_at,
      p.updated_at,
      c.indirizzo AS condominio,
      f.numero AS fattura_numero
    FROM proformas p
    LEFT JOIN condomini_v2 c
      ON c.id = p.condominio_id
    LEFT JOIN fatture f
      ON f.id = p.fattura_id
    ORDER BY p.created_at DESC
    `
  );

  return rows.map((row) => ({
    id: row.id,
    condominio_id: row.condominio_id,
    fattura_id: row.fattura_id,
    numero_progressivo: row.numero_progressivo,
    numero: row.numero,
    descrizione: row.descrizione,
    data_documento: row.data_documento,
    importo: Number(row.importo || 0),
    stato: row.stato,
    source_import_file_id: row.source_import_file_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    condominio: row.condominio || "-",
    fattura_numero: row.fattura_numero || null,
  }));
}

async function getFatturaDetail(id) {
  const [[fattura]] = await db.query(
    `
    SELECT
      f.id,
      f.condominio_id,
      f.numero_progressivo,
      f.numero,
      f.descrizione,
      f.data_documento,
      f.importo,
      f.stato,
      f.created_at,
      f.updated_at,
      c.indirizzo AS condominio
        
    FROM fatture f
    LEFT JOIN condomini_v2 c
      ON c.id = f.condominio_id
 
    WHERE f.id = ?
    LIMIT 1
    `,
    [id]
  );



  if (!fattura) return null;

  const [proformas] = await db.query(
    `
    SELECT
      p.id,
      p.numero,
      p.descrizione,
      p.data_documento,
      p.importo,
      p.stato,
      p.condominio_id,
      c.indirizzo AS condominio
    FROM proformas p
    LEFT JOIN condomini_v2 c
      ON c.id = p.condominio_id
    WHERE p.fattura_id = ?
      AND p.stato <> 'ANNULLATA'
    ORDER BY p.data_documento DESC, p.created_at DESC
    `,
    [id]
  );

  const [availableProformas] = await db.query(
    `
    SELECT
      p.id,
      p.numero,
      p.descrizione,
      p.data_documento,
      p.importo,
      p.stato,
      p.condominio_id,
      c.indirizzo AS condominio
    FROM proformas p
    LEFT JOIN condomini_v2 c
      ON c.id = p.condominio_id
    WHERE p.fattura_id IS NULL
      AND p.stato <> 'ANNULLATA'
    ORDER BY p.data_documento DESC, p.created_at DESC
    `
  );

  const importoFattura = Number(fattura.importo || 0);
  const totaleProforme = proformas.reduce((sum, p) => sum + Number(p.importo || 0), 0);

    console.log("Fetched fattura:", fattura);

  return {
    id: fattura.id,
    condominio_id: fattura.condominio_id,
    numero_progressivo: fattura.numero_progressivo,
    numero: fattura.numero,
    descrizione: fattura.descrizione,
     
    data_documento: fattura.data_documento,
    importo: importoFattura,
    stato: fattura.stato,
    created_at: fattura.created_at,
    updated_at: fattura.updated_at,
    condominio: fattura.condominio || "-",
     
    totale_proforme_collegate: totaleProforme,
    residuo_da_associare: Math.max(importoFattura - totaleProforme, 0),
    eccedenza_proforme: Math.max(totaleProforme - importoFattura, 0),
    copertura_completa: totaleProforme >= importoFattura,

    proformas: proformas.map((p) => ({
      id: p.id,
      numero: p.numero,
      descrizione: p.descrizione,
      data_documento: p.data_documento,
      importo: Number(p.importo || 0),
      stato: p.stato,
      condominio_id: p.condominio_id,
      condominio: p.condominio || "-",
    })),

    available_proformas: availableProformas.map((p) => ({
      id: p.id,
      numero: p.numero,
      descrizione: p.descrizione,
      data_documento: p.data_documento,
      importo: Number(p.importo || 0),
      stato: p.stato,
      condominio_id: p.condominio_id,
      condominio: p.condominio || "-",
    })),
  };
}
async function listFattureSimple() {
  const [rows] = await db.query(
    `
    SELECT
      f.id,
      f.condominio_id,
      f.numero_progressivo,
      f.numero,
      f.descrizione,
      f.data_documento,
      f.importo,
      f.stato,
      f.created_at,
      f.updated_at,
      pi.extracted_number as import_numero,
      c.indirizzo AS condominio,

      COALESCE(SUM(p.importo), 0) AS totale_proforme_collegate,
      COUNT(p.id) AS numero_proforme_collegate

    FROM fatture f
    LEFT JOIN import_items pi
      ON pi.promoted_entity_id = f.source_import_file_id
    LEFT JOIN condomini_v2 c
      ON c.id = f.condominio_id
    LEFT JOIN proformas p
      ON p.fattura_id = f.id
     AND p.stato <> 'ANNULLATA'

    WHERE f.stato <> 'ANNULLATA'

    GROUP BY
      f.id,
      f.condominio_id,
      f.numero_progressivo,
      f.numero,
      f.descrizione,
      f.data_documento,
      f.importo,
      f.stato,
      f.created_at,
      f.updated_at,
      c.indirizzo

    ORDER BY import_numero DESC
    `
  );

  return rows.map((row) => {
    const importoFattura = Number(row.importo || 0);
    const totaleProforme = Number(row.totale_proforme_collegate || 0);

    return {
      id: row.id,
      condominio_id: row.condominio_id,
      numero_progressivo: row.numero_progressivo,
      numero: row.numero,
       
      descrizione: row.descrizione,
      data_documento: row.data_documento,
      importo: importoFattura,
      stato: row.stato,
      created_at: row.created_at,
      updated_at: row.updated_at,
      condominio: row.condominio || "-",
      import_numero: row.import_numero || null,
      totale_proforme_collegate: totaleProforme,
      numero_proforme_collegate: Number(row.numero_proforme_collegate || 0),
      residuo_da_associare: Math.max(importoFattura - totaleProforme, 0),
      eccedenza_proforme: Math.max(totaleProforme - importoFattura, 0),
      copertura_completa: totaleProforme >= importoFattura,
    };
  });
}

async function collegaSingolaProformaAFattura(proformaId, fatturaId) {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    if (!proformaId) {
      throw new Error("Proforma non valida.");
    }

    if (!fatturaId) {
      throw new Error("Seleziona una fattura.");
    }

   
    const result = await collegaProformaAFattura(conn, fatturaId, [proformaId]);


    if (!result.updatedCount) {
      throw new Error("Nessuna proforma aggiornata.");
    }

    await conn.commit();

    return {
      success: true,
      updatedCount: result.updatedCount,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function collegaProformeAFattura(conn, fatturaId, proformaIds = []) {
  const cleanIds = [
    ...new Set((Array.isArray(proformaIds) ? proformaIds : []).map(String).filter(Boolean)),
  ];

  if (!fatturaId) {
    throw new Error("fatturaId mancante.");
  }

  if (!cleanIds.length) {
    return { updatedCount: 0 };
  }

  const placeholders = cleanIds.map(() => "?").join(",");

  const [[fattura]] = await conn.query(
    `
    SELECT id, stato
    FROM fatture
    WHERE id = ?
    LIMIT 1
    FOR UPDATE
    `,
    [fatturaId]
  );

  if (!fattura) {
    throw new Error("Fattura non trovata.");
  }

  if (fattura.stato === "ANNULLATA") {
    throw new Error("La fattura è annullata e non può ricevere proforme.");
  }

  const [proformas] = await conn.query(
    `
    SELECT id, stato, fattura_id
    FROM proformas
    WHERE id IN (${placeholders})
    FOR UPDATE
    `,
    cleanIds
  );

  if (proformas.length !== cleanIds.length) {
    throw new Error("Una o più proforme selezionate non esistono.");
  }

  for (const p of proformas) {
    if (p.stato === "ANNULLATA") {
      throw new Error("Una proforma selezionata è annullata e non può essere associata.");
    }

    if (p.fattura_id) {
      throw new Error("Una proforma selezionata è già collegata a una fattura.");
    }
  }

  const [updateResult] = await conn.query(
    `
    UPDATE proformas
    SET
      fattura_id = ?,
      stato = 'COLLEGATA',
      updated_at = NOW()
    WHERE id IN (${placeholders})
    `,
    [fatturaId, ...cleanIds]
  );

  return {
    updatedCount: updateResult.affectedRows || 0,
  };
}

async function collegaProformeAFatturaEsistente(fatturaId, proformaIds = []) {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const result = await collegaProformeAFattura(conn, fatturaId, proformaIds);

    if (!result.updatedCount) {
      throw new Error("Nessuna proforma aggiornata.");
    }

    await conn.commit();

    return {
      success: true,
      fatturaId,
      updatedCount: result.updatedCount,
      linkedProformaIds: [...new Set((Array.isArray(proformaIds) ? proformaIds : []).map(String).filter(Boolean))],
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function collegaProformaAFattura(conn, fatturaId, proformaIds = []) {
   console.log("Collegamento fattura", { fatturaId });
  const cleanIds = [...new Set((Array.isArray(proformaIds) ? proformaIds : []).map(String).filter(Boolean))];

  console.log("collegaProformaAFattura called with:", { fatturaId, proformaIds, cleanIds });

  if (!cleanIds.length) {
    return { updatedCount: 0 };
  }

  const placeholders = cleanIds.map(() => "?").join(",");

  const [proformas] = await conn.query(
    `
    SELECT id, stato, fattura_id
    FROM proformas
    WHERE id IN (${placeholders})
    FOR UPDATE
    `,
    cleanIds
  );

  if (proformas.length !== cleanIds.length) {
    throw new Error("Una o più proforme selezionate non esistono.");
  }

  for (const p of proformas) {
    if (p.stato === "ANNULLATA") {
      throw new Error("Una proforma selezionata è annullata e non può essere associata.");
    }

    if (p.fattura_id) {
      throw new Error("Una proforma selezionata è già collegata a una fattura.");
    }
  }

  const [updateResult] = await conn.query(
    `
    UPDATE proformas
    SET
      fattura_id = ?,
      stato = 'COLLEGATA',
      updated_at = NOW()
    WHERE id IN (${placeholders})
    `,
    [fatturaId, ...cleanIds]
  );

  return {
    updatedCount: updateResult.affectedRows || 0,
  };
}
 
function normalizePage(value, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function normalizePageSize(value, fallback = 25) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), 100);
}

async function listImportedDocuments({
  page = 1,
  pageSize = 25,
  documentType = null,
  search = "",
}) {
  const safePage = normalizePage(page, 1);
  const safePageSize = normalizePageSize(pageSize, 25);
  const offset = (safePage - 1) * safePageSize;

  const where = [];
  const params = [];

  if (documentType) {
    where.push("COALESCE(i.document_type, '') = ?");
    params.push(String(documentType).trim().toUpperCase());
  }

  if (search && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    where.push(`
      (
        f.original_filename LIKE ?
        OR COALESCE(i.extracted_number, '') LIKE ?
        OR COALESCE(i.extracted_description, '') LIKE ?
      )
    `);
    params.push(q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const baseFromSql = `
    FROM import_batch_files f
    LEFT JOIN import_items i
      ON i.batch_id = f.batch_id
      AND i.promoted_entity_id = f.id
    ${whereSql}
  `;

  const [rows] = await db.query(
    `
    SELECT
      f.id,
      f.batch_id,
      f.original_filename,
      f.parse_status,
      f.processed_at,
      f.created_at,
      i.review_status,
      i.extracted_number,
      i.extracted_date,
      i.extracted_amount,
      i.extracted_description,
      i.document_type,

      CASE
        WHEN COALESCE(i.review_status, 'DA_REVISIONARE') = 'DA_REVISIONARE' THEN 0
        WHEN COALESCE(i.review_status, '') = 'COMPLETATO_CON_ERRORI' THEN 1
        ELSE 2
      END AS review_priority,

      CAST(
        COALESCE(
          NULLIF(REGEXP_SUBSTR(COALESCE(i.extracted_number, ''), '[0-9]+'), ''),
          '0'
        ) AS UNSIGNED
      ) AS sortable_numero
    ${baseFromSql}
    ORDER BY
      review_priority ASC,
      sortable_numero DESC,
      f.created_at DESC
    LIMIT ? OFFSET ?
    `,
    [...params, safePageSize, offset]
  );

  const [countRows] = await db.query(
    `
    SELECT COUNT(*) AS total
    ${baseFromSql}
    `,
    params
  );

  const total = Number(countRows?.[0]?.total || 0);

  return {
    items: rows.map((r) => ({
      id: r.id,
      batch_id: r.batch_id,
      original_filename: r.original_filename,
      parse_status: r.parse_status,
      review_status: r.review_status || "DA_REVISIONARE",
      descrizione: r.extracted_description || null,
      numero: r.extracted_number || null,
      data_documento: r.extracted_date || null,
      importo: r.extracted_amount != null ? Number(r.extracted_amount) : null,
      uploadedAt: r.created_at,
      processedAt: r.processed_at || null,
      type: r.document_type || null,
    })),
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}
async function getImportedDocumentDetail(fileId) {
  const [rows] = await db.query(
    `
    SELECT
      f.id,
      f.batch_id,
      f.original_filename,
      f.stored_filename,
      f.mime_type,
      f.file_path,
      f.parse_status,
      f.created_at AS uploaded_at,
      f.processed_at,
      i.id AS item_id,
      i.extracted_number,
      i.extracted_date,
      i.extracted_description,
      i.extracted_amount,
      i.extracted_payment_method,
      i.review_status,
      i.validation_errors,
      i.raw_payload
    FROM import_batch_files f
    LEFT JOIN import_items i
      ON i.promoted_entity_id = f.id
     
    WHERE f.id = ?
    LIMIT 1
    `,
    [fileId]
  );

  if (!rows.length) return null;

  const r = rows[0];

  return {
    id: r.id,
    batch_id: r.batch_id,
    original_filename: r.original_filename,
    stored_filename: r.stored_filename,
    mime_type: r.mime_type,
    file_path: r.file_path,
    parse_status: r.parse_status,
    uploaded_at: r.uploaded_at,
    processed_at: r.processed_at,
    item_id: r.item_id,
    review_status: r.review_status || "DA_REVISIONARE",
    parsed_result: safeJsonParse(r.raw_payload, null),
    extracted: {
      numero: r.extracted_number,
      data_documento: r.extracted_date,
      descrizione: r.extracted_description,
      importo: r.extracted_amount != null ? Number(r.extracted_amount) : null,
      payment_method: r.extracted_payment_method,
 
    },
    validation_errors: safeJsonParse(r.validation_errors, []),
  };
}

async function uploadImportedDocuments(files) {
  const batchId = crypto.randomUUID();

  await db.query(
    `
    INSERT INTO import_batches (
      id,
      document_type,
      original_filename,
      stored_filename,
      mime_type,
      file_path,
      stato,
      uploaded_at,
      created_at,
      updated_at
    )
    VALUES (?, 'PROFORMA', ?, NULL, NULL, NULL, 'CARICATO', NOW(), NOW(), NOW())
    `,
    [batchId, `Batch proforme (${files.length} file)`]
  );

  for (const file of files) {
    await db.query(
      `
      INSERT INTO import_batch_files (
        id,
        batch_id,
        original_filename,
        stored_filename,
        mime_type,
        file_path,
        parse_status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'CARICATO', NOW(), NOW())
      `,
      [
        crypto.randomUUID(),
        batchId,
        file.originalname,
        file.filename,
        file.mimetype,
        file.path,
      ]
    );
  }

  const [uploadedFiles] = await db.query(
    `
    SELECT id, batch_id, original_filename, parse_status, created_at
    FROM import_batch_files
    WHERE batch_id = ?
    ORDER BY created_at DESC
    `,
    [batchId]
  );

 
  uploadedFiles.forEach(async f => await parseImportedDocumentF(f.id));

  return {
    batch_id: batchId,
    files: uploadedFiles,
  };
}

async function uploadImportedDocumentsF(files, documentType = "FATTURA") {
  const batchId = crypto.randomUUID();

  await db.query(
    `
    INSERT INTO import_batches (
      id,
      document_type,
      original_filename,
      stored_filename,
      mime_type,
      file_path,
      stato,
      uploaded_at,
      created_at,
      updated_at
    )
    VALUES (?, 'FATTURA', ?, NULL, NULL, NULL, 'CARICATO', NOW(), NOW(), NOW())
    `,
    [batchId, `Batch fattura (${files.length} file)`]
  );

  for (const file of files) {
    await db.query(
      `
      INSERT INTO import_batch_files (
        id,
        batch_id,
        original_filename,
        stored_filename,
        mime_type,
        file_path,
        parse_status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'CARICATO', NOW(), NOW())
      `,
      [
        crypto.randomUUID(),
        batchId,
        file.originalname,
        file.filename,
        file.mimetype,
        file.path,
      ]
    );
  }

  const [uploadedFiles] = await db.query(
    `
    SELECT id, batch_id, original_filename, parse_status, created_at
    FROM import_batch_files
    WHERE batch_id = ?
    ORDER BY created_at DESC
    `,
    [batchId]
  );

  uploadedFiles.forEach(async f => await parseImportedDocumentF(f.id));
  return {
    batch_id: batchId,
    files: uploadedFiles,
  };
}


async function parseImportedDocument(fileId) {
  const detail = await getImportedDocumentDetail(fileId);
  if (!detail) {
    throw new Error("Documento non trovato.");
  }

  if (!detail.file_path || !fs.existsSync(detail.file_path)) {
    throw new Error("File PDF non trovato sul server.");
  }

  await db.query(
    `UPDATE import_batch_files
     SET parse_status = 'IN_ELABORAZIONE', updated_at = NOW()
     WHERE id = ?`,
    [fileId]
  );

  let parser;
  try {
    
    const buffer = fs.readFileSync(detail.file_path);
    parser = await pdf(buffer);
    const rawText = parser?.text || "";

    if (!rawText.trim()) {
      await db.query(
        `UPDATE import_batch_files
         SET parse_status = 'COMPLETATO_CON_ERRORI',
             processed_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [fileId]
      );
      throw new Error("Il PDF non contiene testo leggibile. Probabilmente serve OCR.");
    }
 
    const parsed = parseProformaRawText(rawText);

    // ---- map new parser contract to DB fields ----
    const extractedNumber = parsed?.invoiceNumber || null;
    const extractedDate = parsed?.invoiceDate || null; // already ISO yyyy-mm-dd in new parser
    const extractedDescription =
      parsed?.serviceDescription +" "+ parsed?.customerAddressLines +" "+ parsed?.servicePeriodDescription ||
      "Proforma importato da parser";

    const extractedAmount =
      parsed?.totalAmount != null ? Number(parsed.totalAmount) : null;

    const extractedPaymentMethod = parsed?.paymentMethod || null;

    // merge parser warnings with hard validation errors
    const validationErrors = [];

    if (!extractedNumber) {
      validationErrors.push("Numero documento non rilevato.");
    }

    if (!extractedDate) {
      validationErrors.push("Data documento non rilevata.");
    }

    if (extractedAmount == null || !Number.isFinite(extractedAmount)) {
      validationErrors.push("Importo non rilevato.");
    }

    if (Array.isArray(parsed?.warnings) && parsed.warnings.length) {
      validationErrors.push(...parsed.warnings);
    }

    // Save a richer payload. Do not save only parsed fields.
    // Keep raw text too, otherwise debugging later becomes stupidly hard.
    const rawPayload = {
      parserVersion: "v2",
      documentType: parsed?.documentType || "unknown",
      rawText: "", //rawText
      parsed,
    };

    const [existingItems] = await db.query(
      `
      SELECT id
      FROM import_items
      WHERE promoted_entity_id = ?
        AND document_type = 'PROFORMA'
      LIMIT 1
      `,
      [fileId]
    );

    if (existingItems.length) {
      await db.query(
        `
        UPDATE import_items
        SET
          batch_id = ?,
          extracted_number = ?,
          extracted_date = ?,
          extracted_description = ?,
          extracted_amount = ?,
          extracted_payment_method = ?,
          raw_payload = ?,
          validation_errors = ?,
          review_status = 'DA_REVISIONARE',
          updated_at = NOW()
        WHERE promoted_entity_id = ?
        `,
        [
          detail.batch_id,
          extractedNumber,
          extractedDate,
          extractedDescription,
          extractedAmount,
          extractedPaymentMethod,
          JSON.stringify(rawPayload),
          JSON.stringify(validationErrors),
          fileId,
        ]
      );
    } else {
      await db.query(
        `
        INSERT INTO import_items (
          id,
          batch_id,
          document_type,
          extracted_number,
          extracted_date,
          extracted_description,
          extracted_amount,
          extracted_payment_method,
          raw_payload,
          validation_errors,
          review_status,
          promoted_entity_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, 'PROFORMA', ?, ?, ?, ?, ?, ?, ?, 'DA_REVISIONARE', ?, NOW(), NOW())
        `,
        [
          crypto.randomUUID(),
          detail.batch_id,
          extractedNumber,
          extractedDate,
          extractedDescription,
          extractedAmount,
          extractedPaymentMethod,
          JSON.stringify(rawPayload),
          JSON.stringify(validationErrors),
          fileId,
        ]
      );
    }

    await db.query(
      `
      UPDATE import_batch_files
      SET
        parse_status = ?,
        processed_at = NOW(),
        updated_at = NOW()
      WHERE id = ?
      `,
      [validationErrors.length ? "COMPLETATO_CON_ERRORI" : "COMPLETATO", fileId]
    );

    return await getImportedDocumentDetail(fileId);
  } catch (error) {
    await db.query(
      `
      UPDATE import_batch_files
      SET
        parse_status = 'COMPLETATO_CON_ERRORI',
        processed_at = NOW(),
        updated_at = NOW()
      WHERE id = ?
      `,
      [fileId]
    );

    throw error;
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch (_) {
        // ignore destroy errors
      }
    }
  }
}

async function parseImportedDocumentF(fileId) {
  const detail = await getImportedDocumentDetail(fileId);
  if (!detail) {
    throw new Error("Documento non trovato.");
  }

  if (!detail.file_path || !fs.existsSync(detail.file_path)) {
    throw new Error("File PDF non trovato sul server.");
  }

  await db.query(
    `UPDATE import_batch_files
     SET parse_status = 'IN_ELABORAZIONE', updated_at = NOW()
     WHERE id = ?`,
    [fileId]
  );

  let parser;
  try {
    
    const buffer = fs.readFileSync(detail.file_path);
    parser = await pdf(buffer);
    const rawText = parser?.text || "";

    if (!rawText.trim()) {
      await db.query(
        `UPDATE import_batch_files
         SET parse_status = 'COMPLETATO_CON_ERRORI',
             processed_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [fileId]
      );
      throw new Error("Il PDF non contiene testo leggibile. Probabilmente serve OCR.");
    }
 
    const parsed = parseProformaRawText(rawText);

    // ---- map new parser contract to DB fields ----
    const extractedNumber = parsed?.invoiceNumber || null;
    const extractedDate = parsed?.invoiceDate || null; // already ISO yyyy-mm-dd in new parser
    const extractedDescription =
      parsed?.serviceDescription +" "+ parsed?.customerAddressLines +" "+ parsed?.servicePeriodDescription ||
      "Fattura importata da parser";

    const extractedAmount =
      parsed?.totalAmount != null ? Number(parsed.totalAmount) : null;

    const extractedPaymentMethod = parsed?.paymentMethod || null;

    // merge parser warnings with hard validation errors
    const validationErrors = [];

    if (!extractedNumber) {
      validationErrors.push("Numero documento non rilevato.");
    }

    if (!extractedDate) {
      validationErrors.push("Data documento non rilevata.");
    }

    if (extractedAmount == null || !Number.isFinite(extractedAmount)) {
      validationErrors.push("Importo non rilevato.");
    }

    if (Array.isArray(parsed?.warnings) && parsed.warnings.length) {
      validationErrors.push(...parsed.warnings);
    }

    // Save a richer payload. Do not save only parsed fields.
    // Keep raw text too, otherwise debugging later becomes stupidly hard.
    const rawPayload = {
      parserVersion: "v2",
      documentType: parsed?.documentType || "unknown",
      rawText: "", //rawText
      parsed,
    };

    const [existingItems] = await db.query(
      `
      SELECT id
      FROM import_items
      WHERE promoted_entity_id = ?
        AND document_type = 'FATTURA'
      LIMIT 1
      `,
      [fileId]
    );

    if (existingItems.length) {
      await db.query(
        `
        UPDATE import_items
        SET
          batch_id = ?,
          extracted_number = ?,
          extracted_date = ?,
          extracted_description = ?,
          extracted_amount = ?,
          extracted_payment_method = ?,
          raw_payload = ?,
          validation_errors = ?,
          review_status = 'DA_REVISIONARE',
          updated_at = NOW()
        WHERE promoted_entity_id = ?
        `,
        [
          detail.batch_id,
          extractedNumber,
          extractedDate,
          extractedDescription,
          extractedAmount,
          extractedPaymentMethod,
          JSON.stringify(rawPayload),
          JSON.stringify(validationErrors),
          fileId,
        ]
      );
    } else {
      await db.query(
        `
        INSERT INTO import_items (
          id,
          batch_id,
          document_type,
          extracted_number,
          extracted_date,
          extracted_description,
          extracted_amount,
          extracted_payment_method,
          raw_payload,
          validation_errors,
          review_status,
          promoted_entity_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, 'FATTURA', ?, ?, ?, ?, ?, ?, ?, 'DA_REVISIONARE', ?, NOW(), NOW())
        `,
        [
          crypto.randomUUID(),
          detail.batch_id,
          extractedNumber,
          extractedDate,
          extractedDescription,
          extractedAmount,
          extractedPaymentMethod,
          JSON.stringify(rawPayload),
          JSON.stringify(validationErrors),
          fileId,
        ]
      );
    }

    await db.query(
      `
      UPDATE import_batch_files
      SET
        parse_status = ?,
        processed_at = NOW(),
        updated_at = NOW()
      WHERE id = ?
      `,
      [validationErrors.length ? "COMPLETATO_CON_ERRORI" : "COMPLETATO", fileId]
    );

    return await getImportedDocumentDetail(fileId);
  } catch (error) {
    await db.query(
      `
      UPDATE import_batch_files
      SET
        parse_status = 'COMPLETATO_CON_ERRORI',
        processed_at = NOW(),
        updated_at = NOW()
      WHERE id = ?
      `,
      [fileId]
    );

    throw error;
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch (_) {
        // ignore destroy errors
      }
    }
  }
}

async function getNextDocumentNumber(conn, documentType, anno, buildingLabel = null) {
  if (!conn) {
    throw new Error("Connessione database mancante.");
  }

  if (!documentType) {
    throw new Error("documentType mancante.");
  }

  if (!anno || Number.isNaN(Number(anno))) {
    throw new Error("anno non valido.");
  }

  const requestedType = String(documentType).trim().toUpperCase();
  const normalizedType =
    requestedType === "PAGAMENTO" ? "PAYMENT" : requestedType;
  const documentConfig = {
    PROFORMA: { table: "proformas", prefix: "PF" },
    FATTURA: { table: "fatture", prefix: "FT" },
    PAYMENT: { table: "payments", prefix: "PG" },
  }[normalizedType];

  if (!documentConfig) {
    throw new Error(`Tipo documento non supportato: ${requestedType}`);
  }

  const documentYear = Number(anno);

  // Older code attempted to write PAGAMENTO into an enum that accepts PAYMENT.
  // MySQL stored that invalid enum value as an empty string; recover that row
  // before creating a new counter for the same year.
  if (normalizedType === "PAYMENT") {
    const [paymentCounterRows] = await conn.query(
      `
      SELECT id, document_type, current_value
      FROM document_number_counters
      WHERE anno = ?
        AND (document_type = 'PAYMENT' OR document_type = '')
      FOR UPDATE
      `,
      [documentYear]
    );
    const validCounter = paymentCounterRows.find(
      (row) => row.document_type === "PAYMENT"
    );
    const legacyCounter = paymentCounterRows.find(
      (row) => row.document_type === ""
    );

    if (!validCounter && legacyCounter) {
      await conn.query(
        `
        UPDATE document_number_counters
        SET document_type = 'PAYMENT', updated_at = NOW()
        WHERE id = ?
        `,
        [legacyCounter.id]
      );
    } else if (validCounter && legacyCounter) {
      await conn.query(
        `
        UPDATE document_number_counters
        SET current_value = GREATEST(current_value, ?), updated_at = NOW()
        WHERE id = ?
        `,
        [Number(legacyCounter.current_value || 0), validCounter.id]
      );
      await conn.query(
        `DELETE FROM document_number_counters WHERE id = ?`,
        [legacyCounter.id]
      );
    }
  }

  await conn.query(
    `
    INSERT IGNORE INTO document_number_counters (
      id,
      document_type,
      anno,
      current_value,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, 0, NOW(), NOW())
    `,
    [crypto.randomUUID(), normalizedType, documentYear]
  );

  const [rows] = await conn.query(
    `
    SELECT id, current_value
    FROM document_number_counters
    WHERE document_type = ?
      AND anno = ?
    LIMIT 1
    FOR UPDATE
    `,
    [normalizedType, documentYear]
  );

  if (!rows.length) {
    throw new Error(
      `Contatore numerazione non disponibile per ${normalizedType} ${documentYear}.`
    );
  }

  const [[issuedRow]] = await conn.query(
    `
    SELECT COALESCE(MAX(numero_progressivo), 0) AS max_value
    FROM ${documentConfig.table}
    `
  );
  const [[counterMaxRow]] = await conn.query(
    `
    SELECT COALESCE(MAX(current_value), 0) AS max_value
    FROM document_number_counters
    WHERE document_type = ?
    `,
    [normalizedType]
  );
  const nextValue =
    Math.max(
      Number(rows[0].current_value || 0),
      Number(issuedRow?.max_value || 0),
      Number(counterMaxRow?.max_value || 0)
    ) + 1;

  await conn.query(
    `
    UPDATE document_number_counters
    SET
      current_value = ?,
      updated_at = NOW()
    WHERE id = ?
    `,
    [nextValue, rows[0].id]
  );

  const padded = String(nextValue).padStart(6, "0");

  const slug = buildingLabel
    ? String(buildingLabel)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9, ]+/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
    : null;

  return {
    documentType: normalizedType,
    progressivo: nextValue,
    numero: slug
      ? `${documentConfig.prefix}-${padded}-${slug}`
      : `${documentConfig.prefix}-${padded}`,
  };
}

async function annullaProforma(id, reason, userId = null) {
  const [rows] = await db.query(
    `
    SELECT id, stato, fattura_id
    FROM proformas
    WHERE id = ?
    LIMIT 1
    `,
    [id]
  );

  if (!rows.length) throw new Error("Proforma non trovata.");

  const row = rows[0];

  if (row.stato === "ANNULLATA") {
    throw new Error("La proforma è già annullata.");
  }

  await db.query(
    `
    UPDATE proformas
    SET
      stato = 'ANNULLATA',
      cancellation_reason = ?,
      cancellation_date = NOW(),
      cancellation_user_id = ?,
      updated_at = NOW()
    WHERE id = ?
    `,
    [reason || "Annullata manualmente", userId, id]
  );

  return { success: true };
}

async function recalculateFatturaStatus(conn, fatturaId) {
  const [[fattura]] = await conn.query(
    `
    SELECT id, importo, stato
    FROM fatture
    WHERE id = ?
    LIMIT 1
    FOR UPDATE
    `,
    [fatturaId]
  );

  if (!fattura) {
    throw new Error("Fattura non trovata.");
  }

  if (fattura.stato === "ANNULLATA") {
    return {
      fatturaId,
      stato: "ANNULLATA",
      totaleAllocato: 0,
      residuo: Number(fattura.importo || 0),
    };
  }

  const [[allocRow]] = await conn.query(
    `
    SELECT COALESCE(SUM(importo_allocato), 0) AS totale_allocato
    FROM payment_allocations
    WHERE fattura_id = ?
    `,
    [fatturaId]
  );

  const importo = Number(fattura.importo || 0);
  const totaleAllocato = Number(allocRow?.totale_allocato || 0);
  const residuo = Math.max(importo - totaleAllocato, 0);

  let nuovoStato = "EMESSA";

  if (totaleAllocato <= 0) {
    nuovoStato = "EMESSA";
  } else if (totaleAllocato < importo) {
    nuovoStato = "PARZIALMENTE_PAGATA";
  } else {
    nuovoStato = "PAGATA";
  }

  await conn.query(
    `
    UPDATE fatture
    SET
      stato = ?,
      updated_at = NOW()
    WHERE id = ?
    `,
    [nuovoStato, fatturaId]
  );

  return {
    fatturaId,
    stato: nuovoStato,
    totaleAllocato,
    residuo,
  };
}


async function registraPagamentoFattura(fatturaId, payload) {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const cleanImporto = Number(payload.importo);

    if (!fatturaId) {
      throw new Error("fatturaId mancante.");
    }

    if (!Number.isFinite(cleanImporto) || cleanImporto <= 0) {
      throw new Error("Importo pagamento non valido.");
    }

    if (!payload.paymentMethod) {
      throw new Error("Metodo di pagamento mancante.");
    }

    if (!payload.dataPagamento) {
      throw new Error("Data pagamento mancante.");
    }

    const [[fattura]] = await conn.query(
      `
      SELECT
        f.id,
        f.condominio_id,
        f.importo,
        f.stato,
        c.indirizzo AS condominio
      FROM fatture f
      LEFT JOIN condomini_v2 c
        ON c.id = f.condominio_id
      WHERE f.id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [fatturaId]
    );

    if (!fattura) {
      throw new Error("Fattura non trovata.");
    }

    if (fattura.stato === "ANNULLATA") {
      throw new Error("La fattura è annullata e non può ricevere pagamenti.");
    }

    const [[allocRow]] = await conn.query(
      `
      SELECT COALESCE(SUM(importo_allocato), 0) AS totale_allocato
      FROM payment_allocations
      WHERE fattura_id = ?
      `,
      [fatturaId]
    );

    const importoFattura = Number(fattura.importo || 0);
    const totaleAllocatoPrecedente = Number(allocRow?.totale_allocato || 0);
    const residuoPrecedente = Math.max(importoFattura - totaleAllocatoPrecedente, 0);

    if (cleanImporto > residuoPrecedente) {
      throw new Error(
        `L'importo supera il residuo disponibile della fattura (${residuoPrecedente.toFixed(2)}).`
      );
    }

    const anno = new Date(payload.dataPagamento).getFullYear();

    if (!anno || Number.isNaN(anno)) {
      throw new Error("Anno pagamento non valido.");
    }

    const numbering = await getNextDocumentNumber(
      conn,
      "PAGAMENTO",
      anno,
      fattura.condominio || null
    );

    const paymentId = crypto.randomUUID();

    await conn.query(
      `
      INSERT INTO payments (
        id,
        numero_progressivo,
        numero,
        payment_method,
        stato,
        data_pagamento,
        importo,
        descrizione,
        cancellation_reason,
        cancellation_date,
        cancellation_user_id,
        replacement_payment_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, 'ALLOCATO', ?, ?, ?, NULL, NULL, NULL, NULL, NOW(), NOW())
      `,
      [
        paymentId,
        numbering.progressivo,
        numbering.numero,
        payload.paymentMethod,
        payload.dataPagamento,
        cleanImporto,
        payload.descrizione || null,
      ]
    );

    const allocationId = crypto.randomUUID();

    await conn.query(
      `
      INSERT INTO payment_allocations (
        id,
        payment_id,
        fattura_id,
        importo_allocato,
        data_allocazione,
        descrizione,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [
        allocationId,
        paymentId,
        fatturaId,
        cleanImporto,
        payload.dataPagamento,
        payload.descrizione || null,
      ]
    );

    const statusInfo = await recalculateFatturaStatus(conn, fatturaId);

    await conn.commit();

    return {
      success: true,
      payment: {
        id: paymentId,
        numero: numbering.numero,
        numero_progressivo: numbering.progressivo,
        payment_method: payload.paymentMethod,
        stato: "ALLOCATO",
        data_pagamento: payload.dataPagamento,
        importo: cleanImporto,
        descrizione: payload.descrizione || null,
      },
      allocation: {
        id: allocationId,
        payment_id: paymentId,
        fattura_id: fatturaId,
        importo_allocato: cleanImporto,
        data_allocazione: payload.dataPagamento,
        descrizione: payload.descrizione || null,
      },
      fatturaStatus: statusInfo.stato,
      totaleAllocato: statusInfo.totaleAllocato,
      residuo: statusInfo.residuo,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteImportedDocument(fileId, documentType) {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const normalizedType = String(documentType || "").trim().toUpperCase();

    if (!["PROFORMA", "FATTURA"].includes(normalizedType)) {
      throw new Error("Tipo documento non supportato.");
    }

    const [[fileRow]] = await conn.query(
      `
      SELECT
        id,
        batch_id,
        file_path,
        original_filename,
        stored_filename
      FROM import_batch_files
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [fileId]
    );

    if (!fileRow) {
      throw new Error("Documento importato non trovato.");
    }

    const [items] = await conn.query(
      `
      SELECT
        id,
        review_status
      FROM import_items
      WHERE document_type = ?
        AND promoted_entity_id = ?
      FOR UPDATE
      `,
      [normalizedType, fileId]
    );

    const hasPromoted = items.some((i) => i.review_status === "PROMOSSO");

    if (hasPromoted) {
      throw new Error(
        "Il documento importato è già stato promosso. Non può essere eliminato dallo staging."
      );
    }

    await conn.query(
      `
      DELETE FROM import_items
      WHERE document_type = ?
        AND promoted_entity_id = ?
      `,
      [normalizedType, fileId]
    );

    await conn.query(
      `
      DELETE FROM import_batch_files
      WHERE id = ?
      `,
      [fileId]
    );

    const [[batchCount]] = await conn.query(
      `
      SELECT COUNT(*) AS cnt
      FROM import_batch_files
      WHERE batch_id = ?
      `,
      [fileRow.batch_id]
    );

    let deletedBatchId = null;

    if (Number(batchCount?.cnt || 0) === 0) {
      await conn.query(
        `
        DELETE FROM import_batches
        WHERE id = ?
        `,
        [fileRow.batch_id]
      );

      deletedBatchId = fileRow.batch_id;
    }

    await conn.commit();

    if (fileRow.file_path && fs.existsSync(fileRow.file_path)) {
      try {
        fs.unlinkSync(fileRow.file_path);
      } catch (fileErr) {
        console.error("Errore eliminazione file fisico:", fileErr);
      }
    }

    return {
      success: true,
      deletedFileId: fileId,
      deletedBatchId,
      deletedImportItemsCount: items.length,
      originalFilename: fileRow.original_filename,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteImportedDocumentF(fileId, documentType) {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const normalizedType = String(documentType || "").trim().toUpperCase();

    if (!["PROFORMA", "FATTURA"].includes(normalizedType)) {
      throw new Error("Tipo documento non supportato.");
    }

    const [[fileRow]] = await conn.query(
      `
      SELECT
        id,
        batch_id,
        file_path,
        original_filename,
        stored_filename
      FROM import_batch_files
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [fileId]
    );

    if (!fileRow) {
      throw new Error("Documento importato non trovato.");
    }

    const [items] = await conn.query(
      `
      SELECT
        id,
        review_status
      FROM import_items
      WHERE document_type = ?
        AND promoted_entity_id = ?
      FOR UPDATE
      `,
      [normalizedType, fileId]
    );

    const hasPromoted = items.some((i) => i.review_status === "PROMOSSO");

    if (hasPromoted) {
      throw new Error(
        "Il documento importato è già stato promosso. Non può essere eliminato dallo staging."
      );
    }

    await conn.query(
      `
      DELETE FROM import_items
      WHERE document_type = ?
        AND promoted_entity_id = ?
      `,
      [normalizedType, fileId]
    );

    await conn.query(
      `
      DELETE FROM import_batch_files
      WHERE id = ?
      `,
      [fileId]
    );

    const [[batchCount]] = await conn.query(
      `
      SELECT COUNT(*) AS cnt
      FROM import_batch_files
      WHERE batch_id = ?
      `,
      [fileRow.batch_id]
    );

    let deletedBatchId = null;

    if (Number(batchCount?.cnt || 0) === 0) {
      await conn.query(
        `
        DELETE FROM import_batches
        WHERE id = ?
        `,
        [fileRow.batch_id]
      );

      deletedBatchId = fileRow.batch_id;
    }

    await conn.commit();

    if (fileRow.file_path && fs.existsSync(fileRow.file_path)) {
      try {
        fs.unlinkSync(fileRow.file_path);
      } catch (fileErr) {
        console.error("Errore eliminazione file fisico:", fileErr);
      }
    }

    return {
      success: true,
      deletedFileId: fileId,
      deletedBatchId,
      deletedImportItemsCount: items.length,
      originalFilename: fileRow.original_filename,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
async function deleteProforma(id) {
  const [rows] = await db.query(
    `
    SELECT id, stato, fattura_id
    FROM proformas
    WHERE id = ?
    LIMIT 1
    `,
    [id]
  );

  if (!rows.length) throw new Error("Proforma non trovata.");

  const row = rows[0];

  if (row.fattura_id) {
    throw new Error("La proforma è collegata a una fattura e non può essere eliminata definitivamente.");
  }

  if (!["BOZZA", "EMESSA"].includes(row.stato)) {
    throw new Error("Solo le proforme in stato BOZZA o EMESSA possono essere eliminate definitivamente.");
  }

  await db.query(`DELETE FROM proformas WHERE id = ?`, [id]);

  return { success: true };
}

async function promoteImportedDocumentToProforma(fileId, condominioIds = []) {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    if (!Array.isArray(condominioIds) || condominioIds.length === 0) {
      throw new Error("Seleziona almeno un condominio.");
    }

    const uniqueCondominioIds = [...new Set(condominioIds.map(String).filter(Boolean))];

    const [rows] = await conn.query(
      `
      SELECT
        f.id AS file_id,
        f.batch_id,
        f.original_filename,
        i.id AS item_id,
        i.review_status,
        i.extracted_number,
        i.extracted_date,
        i.extracted_description,
        i.extracted_amount,
        i.raw_payload,
        i.validation_errors
      FROM import_batch_files f
      INNER JOIN import_items i
        ON i.promoted_entity_id = f.id
       AND i.document_type = 'PROFORMA'
      WHERE f.id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [fileId]
    );

    if (!rows.length) {
      throw new Error("Documento importato non trovato.");
    }

    const row = rows[0];

    if (row.review_status === "PROMOSSO") {
      throw new Error("Questo documento è già stato promosso.");
    }

    const validationErrors = safeJsonParse(row.validation_errors, []);
    if (Array.isArray(validationErrors) && validationErrors.length > 0) {
      console.error("Validation errors:", validationErrors);
      throw new Error("Il documento ha errori di validazione. Correggilo prima della promozione.");
      
    }

    const extractedDate = row.extracted_date;
    const extractedDescription = row.extracted_description || "Proforma creata da parser";
    const extractedAmount = row.extracted_amount != null ? Number(row.extracted_amount) : null;

    if (!extractedDate) {
      throw new Error("Data documento mancante.");
    }

    if (extractedAmount == null || !Number.isFinite(extractedAmount)) {
      throw new Error("Importo documento mancante o non valido.");
    }

    const placeholders = uniqueCondominioIds.map(() => "?").join(",");
    const [condominiRows] = await conn.query(
      `
      SELECT id, indirizzo
      FROM condomini_v2
      WHERE id IN (${placeholders})
      `,
      uniqueCondominioIds
    );

    if (condominiRows.length !== uniqueCondominioIds.length) {
      throw new Error("Uno o più condomini selezionati non esistono.");
    }

    const anno = new Date(extractedDate).getFullYear();
    if (!anno || Number.isNaN(anno)) {
      throw new Error("Anno documento non valido.");
    }

    const createdProformas = [];
    const [existing] = await conn.query(
        `
        SELECT id
        FROM proformas
        WHERE source_import_file_id = ?
        LIMIT 1
        `,
        [fileId]
      );

      if (existing.length) {
        throw new Error("Proforma già creato per questo documento.");
      }

    for (const condominio of condominiRows) {



      const buildingLabel = condominio.indirizzo || null;
      const numbering = await getNextDocumentNumber(conn, "PROFORMA", anno, buildingLabel);

      const proformaId = crypto.randomUUID();


      await conn.query(
        `
        INSERT INTO proformas (
          id,
          condominio_id,
          source_import_file_id,
          fattura_id,
          numero_progressivo,
          numero,
          descrizione,
          data_documento,
          importo,
          stato,
          cancellation_reason,
          cancellation_date,
          cancellation_user_id,
          replacement_proforma_id,
          created_at,
          updated_at
        )
        VALUES (
          ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'EMESSA',
          NULL, NULL, NULL, NULL, NOW(), NOW()
        )
        `,
        [
          proformaId,
          condominio.id,
          fileId,
          numbering.progressivo,
          numbering.numero,
          extractedDescription,
          extractedDate,
          extractedAmount,
        ]
      );

      createdProformas.push({
        id: proformaId,
        condominio_id: condominio.id,
        condominio_label: condominio.indirizzo || null,
        numero: numbering.numero,
        numero_progressivo: numbering.progressivo,
        descrizione: extractedDescription,
        data_documento: extractedDate,
        importo: extractedAmount,
        stato: "EMESSA",
      });
    }

    await conn.query(
      `
      UPDATE import_items
      SET
        review_status = 'PROMOSSO',
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE id = ?
      `,
      [row.item_id]
    );

    await conn.query(
      `
      UPDATE import_batch_files
      SET
        parse_status = 'COMPLETATO_PROMOSSO',
        processed_at = NOW(),
        updated_at = NOW()
      WHERE id = ?
      `,
      [fileId]
    );

    await conn.commit();

    return {
      success: true,
      createdCount: createdProformas.length,
      proformas: createdProformas,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listCondominiSimple() {
  const [rows] = await db.query(
    `
    SELECT id, indirizzo
    FROM condomini_v2
    ORDER BY indirizzo ASC
    `
  );

  return rows;
}
 async function searchCondomini(search = "") {
  const like = `%${String(search).trim()}%`;

  const [rows] = await db.query(
    `
    SELECT id, indirizzo
    FROM condomini_v2
    WHERE indirizzo LIKE ?
    ORDER BY indirizzo ASC
    LIMIT 20
    `,
    [like]
  );

  return rows;
}

async function getSummary() {
  const [[proformeRow]] = await db.query(
    `
    SELECT
      COALESCE(SUM(importo), 0) AS totale
    FROM proformas
    WHERE stato IN ('BOZZA', 'EMESSA', 'COLLEGATA', 'PARZIALMENTE_SALDATA')
    `
  );

  const [[fattureRow]] = await db.query(
    `
    SELECT
      COALESCE(SUM(importo), 0) AS totale
    FROM fatture
    WHERE stato IN ('BOZZA', 'EMESSA', 'PARZIALMENTE_PAGATA')
    `
  );

  const [[incassatoRow]] = await db.query(
    `
    SELECT
      COALESCE(SUM(importo), 0) AS totale
    FROM payments
    WHERE stato IN ('REGISTRATO', 'PARZIALMENTE_ALLOCATO', 'ALLOCATO')
    `
  );

  return {
    totaleInsolutoProforme: Number(proformeRow?.totale || 0),
    totaleInsolutoFatture: Number(fattureRow?.totale || 0),
    totaleIncassato: Number(incassatoRow?.totale || 0),
  };
}

async function getRecentRows() {
  const [rows] = await db.query(
    `
    SELECT *
    FROM (
      SELECT
        p.id AS id,
        'PROFORMA' AS type,
        p.numero AS number,
        COALESCE(c.indirizzo, '-') AS condominio,
        NULL AS customer,
        CASE
          WHEN p.source_import_file_id IS NULL THEN 'MANUALE'
          ELSE 'UPLOAD_PARSER'
        END AS source,
        p.stato AS status,
        NULL AS paymentMethod,
        p.data_documento AS date,
        p.importo AS amount,
        p.created_at AS sort_date
      FROM proformas p
      LEFT JOIN condomini_v2 c
        ON c.id = p.condominio_id

      UNION ALL

      SELECT
        f.id AS id,
        'FATTURA' AS type,
        f.numero AS number,
        COALESCE(c.indirizzo, '-') AS condominio,
        NULL AS customer,
        CASE
          WHEN f.source_import_file_id IS NULL THEN 'MANUALE'
          ELSE 'UPLOAD_PARSER'
        END AS source,
        f.stato AS status,
        NULL AS paymentMethod,
        f.data_documento AS date,
        f.importo AS amount,
        f.created_at AS sort_date
      FROM fatture f
      LEFT JOIN condomini_v2 c
        ON c.id = f.condominio_id

      UNION ALL

      SELECT
        pay.id AS id,
        'PAGAMENTO' AS type,
        pay.numero AS number,
        CASE
          WHEN COUNT(DISTINCT c.id) = 0 THEN '-'
          WHEN COUNT(DISTINCT c.id) = 1 THEN MAX(c.indirizzo)
          ELSE 'Multipli condomini'
        END AS condominio,
        NULL AS customer,
        'MANUALE' AS source,
        pay.stato AS status,
        pay.payment_method AS paymentMethod,
        pay.data_pagamento AS date,
        pay.importo AS amount,
        pay.created_at AS sort_date
      FROM payments pay
      LEFT JOIN payment_allocations pa
        ON pa.payment_id = pay.id
      LEFT JOIN fatture f
        ON f.id = pa.fattura_id
      LEFT JOIN condomini_v2 c
        ON c.id = f.condominio_id
      GROUP BY
        pay.id,
        pay.numero,
        pay.stato,
        pay.payment_method,
        pay.data_pagamento,
        pay.importo,
        pay.created_at
    ) x
    ORDER BY x.sort_date DESC
     
    `
  );

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    number: row.number,
    condominio: row.condominio || "-",
    customer: row.customer || null,
    source: row.source,
    status: row.status,
    paymentMethod: row.paymentMethod || null,
    date: row.date,
    amount: Number(row.amount || 0),
  }));
}

async function listFattureWithProforme() {
  const [rows] = await db.query(
    `
    SELECT
      f.id,
      f.condominio_id,
      f.numero_progressivo,
      f.numero,
      f.descrizione,
      f.data_documento,
      f.importo,
      f.stato,
      f.created_at,
      f.updated_at,
      c.indirizzo AS condominio,
      COUNT(p.id) AS proforme_count
    FROM fatture f
    LEFT JOIN condomini_v2 c
      ON c.id = f.condominio_id
    LEFT JOIN proformas p
      ON p.fattura_id = f.id
    GROUP BY
      f.id,
      f.condominio_id,
      f.numero_progressivo,
      f.numero,
      f.descrizione,
      f.data_documento,
      f.importo,
      f.stato,
      f.created_at,
      f.updated_at,
      c.indirizzo
    ORDER BY f.created_at DESC
    `
  );

  return rows.map((row) => ({
    id: row.id,
    condominio_id: row.condominio_id,
    numero_progressivo: row.numero_progressivo,
    numero: row.numero,
    descrizione: row.descrizione,
    data_documento: row.data_documento,
    importo: Number(row.importo || 0),
    stato: row.stato,
    condominio: row.condominio || "-",
    proforme_count: Number(row.proforme_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

async function getFatturaProforme(fatturaId) {
  const [rows] = await db.query(
    `
    SELECT
      p.id,
      p.numero,
      p.descrizione,
      p.data_documento,
      p.importo,
      p.stato,
      c.indirizzo AS condominio
    FROM proformas p
    LEFT JOIN condomini_v2 c
      ON c.id = p.condominio_id
    WHERE p.fattura_id = ?
    ORDER BY p.created_at DESC
    `,
    [fatturaId]
  );

  return rows.map((row) => ({
    id: row.id,
    numero: row.numero,
    descrizione: row.descrizione,
    data_documento: row.data_documento,
    importo: Number(row.importo || 0),
    stato: row.stato,
    condominio: row.condominio || "-",
  }));
}

async function promoteImportedDocumentToFattura(fileId, condominioId, proformaIds = [], fatturaDate = null, totaleOneri = 0, current = null, previous = null) {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    if (!fileId) throw new Error("File mancante");
    if (!condominioId) throw new Error("Condominio mancante");

    const cleanProformaIds = Array.isArray(proformaIds)
      ? proformaIds.filter(Boolean)
      : [];
 
    console.log("fileId:", fileId);
    console.log("condominioId:", condominioId);
    console.log("proformaIds:", cleanProformaIds);
    console.log("fatturaDate:", fatturaDate);
    console.log("totaleOneri:", totaleOneri);
    console.log("current:", parseItalianLongDate(current));
    console.log("previous:", parseItalianLongDate(previous));

    // 3. GET CONDOMINIO
    const [[condominio]] = await conn.query(
            `SELECT id, indirizzo, cap, citta FROM condomini_v2 WHERE id = ?`,
            [condominioId]
    );

    const [[currentP]] = await conn.query(
            `SELECT period_month, period_year FROM letture_sessioni WHERE id = ?`,
            [current]
    );

    const [[previousP]] = await conn.query(
            `SELECT period_month, period_year FROM letture_sessioni WHERE id = ?`,
            [previous]
    );

    let imported = null;
    let description = "";
    if(fileId !== "01") {
      // 1. GET IMPORTED DOC
      [[imported]] = await conn.query(
        `
        SELECT *
        FROM import_items
        WHERE promoted_entity_id = ?
        AND document_type = 'FATTURA'
        LIMIT 1
        FOR UPDATE
        `,
        [fileId]
      );

      if (!imported) {
        throw new Error("Documento importato non trovato");
      }

      if (imported.review_status === "PROMOSSO") {
        throw new Error("Documento già promosso");
      }
    }else{



        const period = "dal "+previousP.period_month+"."+previousP.period_year+" al "+currentP.period_month+"."+currentP.period_year;

        description =  "Lettura e fatturazione consumi idrici periodo "+period+" per condominio sito in "+condominio.cap+" - "+condominio.citta+" alla "+condominio.indirizzo;

    }



  

    const oneriDaFatturazione =  fileId === "01"? totaleOneri : null;
    // 2. VALIDATE DATA
    const data = fileId === "01"? fatturaDate : imported.extracted_date;
    const descrizione = fileId === "01" ? description : imported.extracted_description || "Fattura da parser";
    const importo = fileId === "01" ? Number(oneriDaFatturazione) :  Number(imported.extracted_amount);

    if (!data) throw new Error("Data mancante");
    if (!Number.isFinite(importo)) throw new Error("Importo non valido");

    if (!condominio) throw new Error("Condominio non trovato");

    // 4. CREATE FATTURA
    const anno = new Date(data).getFullYear();

    const numbering = await getNextDocumentNumber(
      conn,
      "FATTURA",
      anno,
      condominio.indirizzo
    );

    const fatturaId = crypto.randomUUID();

    await conn.query(
      `
      INSERT INTO fatture (
        id,
        condominio_id,
        source_import_file_id,
        numero_progressivo,
        numero,
        descrizione,
        data_documento,
        importo,
        stato,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EMESSA', NOW(), NOW())
      `,
      [
        fatturaId,
        condominioId,
        fileId,
        numbering.progressivo,
        numbering.numero,
        descrizione,
        data,
        importo,
      ]
    );

    console.log("✅ Fattura creata:", fatturaId);

    // 5. LINK PROFORMAS (CRITICAL PART)
    if (cleanProformaIds.length > 0) {
      const placeholders = cleanProformaIds.map(() => "?").join(",");

      const [existing] = await conn.query(
        `
        SELECT id, fattura_id
        FROM proformas
        WHERE id IN (${placeholders})
        FOR UPDATE
        `,
        cleanProformaIds
      );

      console.log("🔍 Proforme trovate:", existing.length);

      if (existing.length !== cleanProformaIds.length) {
        throw new Error("Alcune proforme non esistono");
      }

      // HARD UPDATE
      const [updateResult] = await conn.query(
        `
        UPDATE proformas
        SET
          fattura_id = ?,
          stato = 'COLLEGATA',
          updated_at = NOW()
        WHERE id IN (${placeholders})
        `,
        [fatturaId, ...cleanProformaIds]
      );

      console.log("🧠 UPDATE RESULT:", updateResult);

      if (updateResult.affectedRows === 0) {
        throw new Error("Nessuna proforma aggiornata (BUG)");
      }
    }

    // 6. MARK IMPORT AS DONE
    if(fileId !== "01") {
      await conn.query(
        `
        UPDATE import_items
        SET review_status = 'PROMOSSO', updated_at = NOW()
        WHERE id = ?
        `,
        [imported.id]
      );

      await conn.query(
          `
          UPDATE import_batch_files
          SET
            parse_status = 'COMPLETATO_PROMOSSO',
            updated_at = NOW()
          WHERE id = ?
          `,
          [fileId]
        );
    }
    await conn.commit();

    return {
      success: true,
      fatturaId,
    };
  } catch (err) {
    await conn.rollback();
    console.error("promoteImportedDocumentToFattura:", err);
    throw err;
  } finally {
    conn.release();
  }
}

async function annullaFattura(id, reason, userId = null) {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [[fattura]] = await conn.query(
      `
      SELECT id, stato
      FROM fatture
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [id]
    );

    if (!fattura) {
      throw new Error("Fattura non trovata.");
    }

    if (fattura.stato === "ANNULLATA") {
      throw new Error("La fattura è già annullata.");
    }

    await conn.query(
      `
      UPDATE fatture
      SET
        stato = 'ANNULLATA',
        cancellation_reason = ?,
        cancellation_date = NOW(),
        cancellation_user_id = ?,
        updated_at = NOW()
      WHERE id = ?
      `,
      [reason || "Annullata manualmente", userId, id]
    );

    await conn.query(
      `
      UPDATE proformas
      SET
        fattura_id = NULL,
        stato = CASE
          WHEN stato = 'COLLEGATA' THEN 'EMESSA'
          ELSE stato
        END,
        updated_at = NOW()
      WHERE fattura_id = ?
      `,
      [id]
    );

    await conn.commit();

    return { success: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}


async function listPayments() {
  const [rows] = await db.query(
    `
    SELECT
      p.id,
      p.numero_progressivo,
      p.numero,
      p.payment_method,
      p.stato,
      p.data_pagamento,
      p.importo,
      p.descrizione,
      p.created_at,
      p.updated_at,
      COUNT(pa.id) AS numero_allocazioni,
      COALESCE(SUM(pa.importo_allocato), 0) AS totale_allocato
    FROM payments p
    LEFT JOIN payment_allocations pa
      ON pa.payment_id = p.id
    GROUP BY
      p.id,
      p.numero_progressivo,
      p.numero,
      p.payment_method,
      p.stato,
      p.data_pagamento,
      p.importo,
      p.descrizione,
      p.created_at,
      p.updated_at
    ORDER BY p.created_at DESC
    `
  );

  return rows.map((row) => ({
    id: row.id,
    numero_progressivo: row.numero_progressivo,
    numero: row.numero,
    payment_method: row.payment_method,
    stato: row.stato,
    data_pagamento: row.data_pagamento,
    importo: Number(row.importo || 0),
    descrizione: row.descrizione || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    numero_allocazioni: Number(row.numero_allocazioni || 0),
    totale_allocato: Number(row.totale_allocato || 0),
  }));
}

async function getPaymentDetail(id) {
  const [[payment]] = await db.query(
    `
    SELECT
      id,
      numero_progressivo,
      numero,
      payment_method,
      stato,
      data_pagamento,
      importo,
      descrizione,
      created_at,
      updated_at
    FROM payments
    WHERE id = ?
    LIMIT 1
    `,
    [id]
  );

  if (!payment) return null;

  const [allocations] = await db.query(
    `
    SELECT
      pa.id,
      pa.payment_id,
      pa.fattura_id,
      pa.importo_allocato,
      pa.data_allocazione,
      pa.descrizione,
      f.numero AS fattura_numero,
      f.importo AS fattura_importo,
      c.indirizzo AS condominio
    FROM payment_allocations pa
    LEFT JOIN fatture f
      ON f.id = pa.fattura_id
    LEFT JOIN condomini_v2 c
      ON c.id = f.condominio_id
    WHERE pa.payment_id = ?
    ORDER BY pa.data_allocazione DESC, pa.created_at DESC
    `,
    [id]
  );

  return {
    id: payment.id,
    numero_progressivo: payment.numero_progressivo,
    numero: payment.numero,
    payment_method: payment.payment_method,
    stato: payment.stato,
    data_pagamento: payment.data_pagamento,
    importo: Number(payment.importo || 0),
    descrizione: payment.descrizione || null,
    created_at: payment.created_at,
    updated_at: payment.updated_at,
    allocations: allocations.map((a) => ({
      id: a.id,
      payment_id: a.payment_id,
      fattura_id: a.fattura_id,
      fattura_numero: a.fattura_numero,
      fattura_importo: Number(a.fattura_importo || 0),
      condominio: a.condominio || "-",
      importo_allocato: Number(a.importo_allocato || 0),
      data_allocazione: a.data_allocazione,
      descrizione: a.descrizione || null,
    })),
  };
}

async function createManualProforma(payload) {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const condominioId = payload?.condominioId;
    const descrizione = String(payload?.descrizione || "").trim();
    const dataDocumento = payload?.dataDocumento;
    const importo = Number(payload?.importo);

    if (!condominioId) {
      throw new Error("Seleziona un condominio.");
    }

    if (!descrizione) {
      throw new Error("Descrizione mancante.");
    }

    if (!dataDocumento) {
      throw new Error("Data documento mancante.");
    }

    if (!Number.isFinite(importo) || importo <= 0) {
      throw new Error("Importo non valido.");
    }

    const [[condominio]] = await conn.query(
      `
      SELECT id, indirizzo
      FROM condomini_v2
      WHERE id = ?
      LIMIT 1
      `,
      [condominioId]
    );

    if (!condominio) {
      throw new Error("Condominio non trovato.");
    }

    const anno = new Date(dataDocumento).getFullYear();
    if (!anno || Number.isNaN(anno)) {
      throw new Error("Anno documento non valido.");
    }

    const numbering = await getNextDocumentNumber(
      conn,
      "PROFORMA",
      anno,
      condominio.indirizzo || null
    );

    const proformaId = crypto.randomUUID();

    await conn.query(
      `
      INSERT INTO proformas (
        id,
        condominio_id,
        source_import_file_id,
        fattura_id,
        numero_progressivo,
        numero,
        descrizione,
        data_documento,
        importo,
        stato,
        cancellation_reason,
        cancellation_date,
        cancellation_user_id,
        replacement_proforma_id,
        created_at,
        updated_at
      )
      VALUES (
        ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 'EMESSA',
        NULL, NULL, NULL, NULL, NOW(), NOW()
      )
      `,
      [
        proformaId,
        condominio.id,
        numbering.progressivo,
        numbering.numero,
        descrizione,
        dataDocumento,
        importo,
      ]
    );

    await conn.commit();

    return {
      success: true,
      proforma: {
        id: proformaId,
        condominio_id: condominio.id,
        condominio: condominio.indirizzo || "-",
        numero_progressivo: numbering.progressivo,
        numero: numbering.numero,
        descrizione,
        data_documento: dataDocumento,
        importo,
        stato: "EMESSA",
      },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function createManualFattura(payload) {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const condominioId = payload?.condominioId;
    const descrizione = String(payload?.descrizione || "").trim();
    const dataDocumento = payload?.dataDocumento;
    const importo = Number(payload?.importo);
    const proformaIds = Array.isArray(payload?.proformaIds) ? payload.proformaIds : [];

    if (!condominioId) {
      throw new Error("Seleziona un condominio.");
    }

    if (!descrizione) {
      throw new Error("Descrizione mancante.");
    }

    if (!dataDocumento) {
      throw new Error("Data documento mancante.");
    }

    if (!Number.isFinite(importo) || importo <= 0) {
      throw new Error("Importo non valido.");
    }

    const [[condominio]] = await conn.query(
      `
      SELECT id, indirizzo
      FROM condomini_v2
      WHERE id = ?
      LIMIT 1
      `,
      [condominioId]
    );

    if (!condominio) {
      throw new Error("Condominio non trovato.");
    }

    const anno = new Date(dataDocumento).getFullYear();
    if (!anno || Number.isNaN(anno)) {
      throw new Error("Anno documento non valido.");
    }

    const numbering = await getNextDocumentNumber(
      conn,
      "FATTURA",
      anno,
      condominio.indirizzo || null
    );

    const fatturaId = crypto.randomUUID();

    await conn.query(
      `
      INSERT INTO fatture (
        id,
        condominio_id,
        source_import_file_id,
        numero_progressivo,
        numero,
        descrizione,
        data_documento,
        importo,
        stato,
        cancellation_reason,
        cancellation_date,
        cancellation_user_id,
        replacement_fattura_id,
        created_at,
        updated_at
      )
      VALUES (
        ?, ?, NULL, ?, ?, ?, ?, ?, 'EMESSA',
        NULL, NULL, NULL, NULL, NOW(), NOW()
      )
      `,
      [
        fatturaId,
        condominio.id,
        numbering.progressivo,
        numbering.numero,
        descrizione,
        dataDocumento,
        importo,
      ]
    );

    let linkedCount = 0;

    if (proformaIds.length > 0) {
      const linkResult = await collegaProformeAFattura(conn, fatturaId, proformaIds);

      if (!linkResult.updatedCount) {
        throw new Error("Nessuna proforma collegata alla fattura.");
      }

      linkedCount = linkResult.updatedCount;
    }

    await conn.commit();

    return {
      success: true,
      fattura: {
        id: fatturaId,
        condominio_id: condominio.id,
        condominio: condominio.indirizzo || "-",
        numero_progressivo: numbering.progressivo,
        numero: numbering.numero,
        descrizione,
        data_documento: dataDocumento,
        importo,
        stato: "EMESSA",
      },
      linkedProformasCount: linkedCount,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getProformaPrintData(id) {
  const [rows] = await db.query(
    `
    SELECT
      p.id,
      p.numero,
      p.data_documento,
      p.importo,
      p.descrizione,
      p.stato,
      p.condominio_id,
      c.indirizzo
       
    FROM proformas p
    LEFT JOIN condomini_v2 c
      ON c.id = p.condominio_id
    WHERE p.id = ?
    LIMIT 1
    `,
    [id]
  );

  if (!rows.length) {
    throw new Error("Proforma non trovata.");
  }

  return rows[0];
}

async function getFatturaPrintData(id) {

  const [rows] = await db.query(
    `
    SELECT
      f.id,
      f.numero,
      f.data_documento,
      f.importo,
      f.descrizione,
      f.stato,
      f.condominio_id,
      c.indirizzo,
      c.cap,
      c.citta,
      c.iva
      
    FROM fatture f
    LEFT JOIN condomini_v2 c
      ON c.id = f.condominio_id
    WHERE f.id = ?
    LIMIT 1
    `,
    [id]
  );

  if (!rows.length) {
    throw new Error("Fattura non trovata.");
  }

  return rows[0];
}

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }

  return browserPromise;
}


async function htmlToPdfBuffer(html, mode = "color") {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);

    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Wait for logos/images to finish loading
    await page.evaluate(async () => {
      const images = Array.from(document.images);

      await Promise.all(
        images.map((img) => {
          if (img.complete && img.naturalWidth !== 0) {
            return Promise.resolve();
          }

          return new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          });
        })
      );
    });

    if (mode === "bw") {
      await page.addStyleTag({
        content: `
          * {
            color: #000 !important;
            text-shadow: none !important;
            box-shadow: none !important;
            filter: none !important;
          }

          body,
          .sheet,
          .sheet-inner,
          .page {
            background: #fff !important;
          }

          .soft-card,
          .pay-card,
          .payment-box,
          .footer-card,
          .chip-value,
          .deadline,
          .pay-card.main {
            background: #fff !important;
            border: 0.35mm solid #000 !important;
          }

          /* IMPORTANT: remove black fills */
          .chip-label,
          .footer-icon-badge {
            background: #fff !important;
            color: #000 !important;
            border: 0.35mm solid #000 !important;
          }

          .pay-main-sub {
            background: #fff !important;
            border-top: 0.35mm solid #000 !important;
          }

          .logo-wrap img {
            filter: grayscale(100%) contrast(160%) !important;
          }

          .meta-head,
          .footer-card-label,
          .footer-caption,
          .footer-sub,
          .legal {
            color: #000 !important;
          }
        `,
      });
    }


    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "12mm",
        right: "10mm",
        bottom: "12mm",
        left: "10mm",
      },
    });
  } finally {
    await page.close();
  }
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function n(v) {
  const num = Number(v ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function euro(v) {
  return n(v).toFixed(2).replace(".", ",");
}

function formatEuro(v) {
  return `€ ${euro(v)}`;
}

function extractCleanNumber(raw) {
  if (!raw) return "";
  const str = String(raw).trim();
  const match = str.match(/\d+/);
  if (!match) return str;
  return match[0].padStart(6, "0");
}

function formatItalianLongDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatItalianShortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function textOrDash(v) {
  const s = String(v ?? "").trim();
  return s || "-";
}

function buildFinancialDocumentPdfHtml(doc) {
  return `
  <!doctype html>
  <html lang="it">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${esc(
        String(doc?.documentType || "").toUpperCase() === "PROFORMA"
          ? "Proforma di fattura"
          : "Fattura"
      )}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 0;
        }

        :root {
          --page: #e9e9e9;
          --paper: #ececec;
          --ink: #2f2f2f;
          --muted: #6d6d6d;
          --muted-2: #808080;
          --box: #dcdcdc;
          --box-2: #efefef;
          --line: #cfcfcf;
          --yellow: #6cabf3;
          --yellow-dark: #4373ce;
          --white: #ffffff;
        }

        * {
          box-sizing: border-box;
        }

        html, body {
          margin: 0;
          padding: 0;
          background: #ffffff;
          color: var(--ink);
          font-family:
            "Arial",
            "Helvetica",
            sans-serif;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        body {
          font-size: 10.8pt;
        }

        .page {
          width: 210mm;
          min-height: 297mm;
          page-break-after: auto;
        }

        .sheet {
          width: 210mm;
          min-height: 297mm;
          background: var(--page);
          padding: 1mm;
        }

        .sheet-inner {
          min-height: 295mm;
          border: 1px solid #dadada;
          background: var(--paper);
          padding: 10mm 11mm 8mm 11mm;
          display: flex;
          flex-direction: column;
        }

        .topbar {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 10mm;
          align-items: start;
        }

        .identity {
          min-width: 0;
        }

        .product-line {
          display: flex;
          align-items: flex-start;
          gap: 4mm;
          margin-top: 16mm;
        }

        .product-icon {
          width: 14mm;
          height: 14mm;
          border: 1mm solid #171727;
          border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%;
          position: relative;
          flex: 0 0 14mm;
          transform: rotate(180deg);
        }

        .product-icon::after {
          content: "";
          position: absolute;
          inset: 2.2mm;
          background: var(--paper);
          border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%;
        }

        .product-copy-small {
          font-size: 11pt;
          color: #3b3b3b;
          line-height: 1.1;
        }

        .product-copy-big {
          font-size: 18pt;
          line-height: 1.05;
          font-weight: 700;
        }

        .logo-wrap {
          width: 44mm;
          min-height: 18mm;
          display: flex;
          justify-content: flex-end;
          align-items: flex-start;
        }

        .logo-wrap img {
          max-width: 100%;
          max-height: 18mm;
          object-fit: contain;
          display: block;
        }

        .logo-fallback {
          min-width: 34mm;
          min-height: 14mm;
          padding: 2mm 3mm;
          border: 1px dashed #9f9f9f;
          border-radius: 2mm;
          font-size: 9pt;
          font-weight: 700;
          color: var(--muted);
          background: #f8f8f8;
          text-align: center;
        }

        .chip-row {
          display: flex;
          justify-content: flex-end;
          gap: 3mm;
          flex-wrap: wrap;
          margin-bottom: 5mm;
        }

        .chip {
          min-width: 30mm;
        }

        .chip-label {
          padding: 1.1mm 2.2mm;
          font-size: 7pt;
          line-height: 1;
          border-radius: 2.5mm 2.5mm 0 0;
          background: #777;
          color: #fff;
          text-align: center;
        }

        .chip-value {
          padding: 2mm 2.5mm 1.8mm;
          font-size: 9.2pt;
          line-height: 1;
          border: 0.4mm solid #777;
          border-top: 0;
          border-radius: 0 0 2.5mm 2.5mm;
          background: #f3f3f3;
          text-align: center;
          font-weight: 700;
          color: #303030;
        }

        .chip.yellow .chip-label {
          background: var(--yellow);
          color: #111;
        }

        .chip.yellow .chip-value {
          background: #98d1f7;
          border-color: var(--yellow-dark);
        }

        .hero {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12mm;
          margin-top: 8mm;
          align-items: start;
        }

        .period-block {
          min-width: 0;
        }

        .period-label {
          font-size: 10pt;
          color: var(--muted);
          margin-bottom: 1.5mm;
        }

        .period-dates {
          font-size: 16pt;
          line-height: 1.15;
          font-weight: 700;
        }

        .period-sub {
          margin-top: 2mm;
          font-size: 8.5pt;
          color: var(--muted-2);
        }

        .recipient-block {
          justify-self: start;
          padding-top: 1mm;
        }

        .recipient-name {
          font-size: 12pt;
          line-height: 1.15;
          font-weight: 400;
        }

        .recipient-line {
          font-size: 10pt;
          line-height: 1.15;
        }

        .content {
          margin-top: 30mm;
          display: grid;
          grid-template-columns: 1.35fr 0.95fr;
          gap: 6mm;
          align-items: start;
          flex: 1;
        }

        .left,
        .right {
          display: flex;
          flex-direction: column;
          gap: 3mm;
        }

        .soft-card {
          background: var(--box);
          border-radius: 3mm;
          padding: 3mm 3.5mm;
        }

        .soft-title {
          font-size: 10.5pt;
          font-weight: 700;
          margin-bottom: 2mm;
        }

        .two-col {
          display: grid;
          grid-template-columns: 1fr 1.1fr;
          gap: 4mm;
        }

        .meta-head {
          font-size: 8pt;
          color: var(--muted);
          margin-bottom: 0.8mm;
        }

        .meta-body {
          font-size: 9pt;
          line-height: 1.2;
        }

        .desc-body {
          font-size: 9pt;
          line-height: 1.4;
          min-height: 26mm;
          max-height: 36mm;
          overflow: hidden;
          white-space: pre-line;
        }

        .note-body {
          font-size: 8.6pt;
          line-height: 1.35;
          color: #555;
        }

        .pay-card {
          background: #f1f1f1;
          border: 0.45mm solid var(--yellow-dark);
          border-radius: 3mm;
          overflow: hidden;
        }

        .pay-card.main {
          background: var(--yellow);
        }

        .pay-main-head {
          padding: 3mm 3.5mm 1mm;
          font-size: 11pt;
        }

        .pay-main-value {
          padding: 0 3.5mm 2.6mm;
          text-align: right;
          font-size: 24pt;
          line-height: 1;
          font-weight: 800;
        }

        .pay-main-sub {
          background: rgba(255,255,255,0.78);
          border-top: 0.35mm solid rgba(0,0,0,0.08);
          padding: 2.1mm 3.5mm;
          display: flex;
          justify-content: space-between;
          gap: 3mm;
          font-size: 9pt;
        }

        .pay-row {
          padding: 2.8mm 3.5mm;
          display: flex;
          justify-content: space-between;
          gap: 3mm;
          align-items: center;
        }

        .pay-left-label {
          font-size: 10.5pt;
          line-height: 1.1;
        }

        .pay-left-sub {
          margin-top: 0.8mm;
          font-size: 8.4pt;
          color: #333;
        }

        .pay-right-value {
          font-size: 11.8pt;
          font-weight: 800;
          white-space: nowrap;
        }

        .pay-card.total .pay-right-value {
          font-size: 15pt;
        }

        .deadline {
          background: var(--yellow);
          border-radius: 999px;
          padding: 1.6mm 3mm;
          font-size: 8.2pt;
          line-height: 1.2;
          color: #413600;
        }

        .footer {
          margin-top: auto;
          padding-top: 14mm;
          position: relative;
        }

        .footer-title {
          font-size: 11pt;
          font-weight: 700;
          margin-bottom: 4mm;
        }

        .footer-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 7mm;
        }

        .footer-item {
          display: flex;
          gap: 3mm;
          align-items: flex-start;
        }

        .footer-icon {
          width: 10mm;
          height: 10mm;
          border: 0.45mm solid #2d2d2d;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 10mm;
          font-size: 10pt;
          line-height: 1;
        }

        .footer-head {
          font-size: 8.8pt;
          font-weight: 700;
          line-height: 1.2;
        }

        .footer-sub {
          margin-top: 0.5mm;
          font-size: 7.8pt;
          color: var(--muted);
          line-height: 1.25;
        }
 

        .recipient {
          position: absolute;
          top: 40mm;
          right: 18mm;
          width: 70mm;
          text-align: left; /* IMPORTANT */
        }

        .label {
          font-weight: 500;
          margin-bottom: 4px;
        }

        .address {
          line-height: 1.4;
        }

        .full-width-card {
          grid-column: 1 / -1;
        }

        .full-width-card {
  grid-column: 1 / -1;
}

.payment-box {
  padding: 4mm 4.5mm;
  background: #e2e2e2;
}

.payment-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8mm;
  padding-bottom: 3mm;
  margin-bottom: 3mm;
  border-bottom: 0.35mm solid var(--line);
}

.payment-total-pill {
  min-width: 36mm;
  padding: 2.5mm 3.2mm;
  border-radius: 2.5mm;
  background: #f3f3f3;
  border: 0.35mm solid var(--line);
  text-align: right;
}

.payment-amount-value {
  font-size: 16pt;
  line-height: 1;
  font-weight: 800;
}

.payment-grid-clean {
  display: grid;
  grid-template-columns: 1fr 1.6fr 0.8fr;
  gap: 4.5mm;
}

.payment-cell {
  min-width: 0;
}

.payment-main-text {
  font-weight: 700;
}

.payment-iban {
  font-size: 10.5pt;
  font-weight: 800;
  letter-spacing: 0.04em;
  word-break: break-word;
}

.payment-strong {
  font-size: 10pt;
  font-weight: 800;
}

.footer {
  margin-top: 7mm;
  padding-top: 6mm;
  border-top: 0.35mm solid var(--line);
  position: relative;
}

.footer-top {
  display: flex;
  justify-content: space-between;
  gap: 8mm;
  align-items: flex-start;
  margin-bottom: 4mm;
}

.footer-title {
  font-size: 11pt;
  font-weight: 800;
  margin-bottom: 0.8mm;
}

.footer-caption {
  font-size: 7.8pt;
  color: var(--muted);
  line-height: 1.25;
}

.footer-brand {
  max-width: 55mm;
  text-align: right;
  font-size: 8.4pt;
  font-weight: 700;
  color: #3f3f3f;
}
 
.legal {
  margin-top: 0;
  padding-right: 0;
  font-size: 6.3pt;
  line-height: 1.25;
  color: #555;
}

.page-no {
  position: static;
  flex: 0 0 auto;
  font-size: 8.5pt;
  color: #333;
}

.icon {
  width: 10px;
  height: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 4px;
  flex: 0 0 10px;
}

.icon svg {
  width: 10px;
  height: 10px;
  fill: none;
  stroke: #444;
  stroke-width: 1.6;
}

.footer-row {
  display: flex;
  align-items: flex-start;
  gap: 3px;
  margin-bottom: 1mm;
}

.footer-grid-professional {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr 1.25fr;
  gap: 3.5mm;
}

.footer-card {
  min-height: 22mm;
  border-radius: 3mm;
  background: #e8f2ff;
  border: 0.35mm solid #b9d8ff;
  padding: 3mm 3.2mm;
}

.footer-card:nth-child(2) {
  background: #eef6ff;
}

.footer-card:nth-child(3) {
  background: #e5f0ff;
}

.footer-card-label {
  display: flex;
  align-items: center;
  gap: 1.6mm;
  font-size: 7pt;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #315f9d;
  margin-bottom: 1.7mm;
}

.footer-icon-badge {
  width: 5mm;
  height: 5mm;
  border-radius: 999px;
  background: #6cabf3;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 7pt;
  line-height: 1;
  font-weight: 800;
}

.footer-card-value {
  font-size: 8pt;
  line-height: 1.45;
  color: #27374a;
  word-break: break-word;
}

.phone-list div,
.channel-list div {
  margin-bottom: 0.7mm;
  white-space: nowrap;
}

.footer-bottom {
  display: flex;
  justify-content: space-between;
  gap: 8mm;
  align-items: flex-end;
  margin-top: 4mm;
}

 .recipient-block {
  position: absolute;
  top: 42mm;
  right: 18mm;
  width: 70mm;
  text-align: left;
}

.recipient-heading {
  font-size: 10pt;
  color: #666;
  margin-bottom: 2mm;
}

.recipient-name {
  font-size: 13.5pt;
  font-weight: 600;
  line-height: 1.2;
  margin-bottom: 1.2mm;
}

.recipient-line {
  font-size: 11pt;
  line-height: 1.3;
  color: #333;
}

.recipient-meta {
  margin-top: 1.5mm;
  font-size: 10pt;
  color: #555;
}
      </style>
    </head>
    <body>
      ${buildFinancialDocument(doc || {})}
    </body>
  </html>
  `;
}


function buildFinancialDocument({
  documentType,
  supplierName,
  supplierVatNumber,
  supplierSubtitle,
  documentNumber,
  documentDate,
  customerName,
  customerAddressLine1,
  customerAddressLine2,
  customerVatOrCf,
  description,
  amount,
  beneficiary,
  iban,
  swift,
  note,
  legalAddress,
  operatingAddress,
  phone1,
  phone2,
  mobile,
  email,
  website,
  logoUrl,
}) {
  const isProforma = String(documentType || "").toUpperCase() === "PROFORMA";
  const cleanNumber = extractCleanNumber(documentNumber);
  const longDate = formatItalianLongDate(documentDate);
  const shortDate = formatItalianShortDate(documentDate);

  const title = isProforma
    ? `Proforma di fattura n. ${cleanNumber}`
    : `Fattura n. ${cleanNumber}`;

  const amountText = formatEuro(amount);

  return `
    <section class="page">
      <article class="sheet">
        <div class="sheet-inner">
          <header class="topbar">
            <div class="identity">
              <div class="logo-wrap">
                ${
                  logoUrl
                    ? `<img src="${esc(logoUrl)}" alt="Logo aziendale" />`
                    : `<div class="logo-fallback">${esc(supplierName || "LOGO")}</div>`
                }
              </div>
              
            </div>

            <div>
              <div class="chip-row">
                <div class="chip">
                  <div class="chip-label">rif. documento</div>
                  <div class="chip-value">${esc(cleanNumber || "-")}</div>
                </div>

                <div class="chip">
                  <div class="chip-label">data di emissione</div>
                  <div class="chip-value">${esc(shortDate || "-")}</div>
                </div>
 
              </div>


            </div>
          </header>

          <section class="hero">
            <div class="period-block">
              <div class="period-label">Documento di riferimento</div>
              <div class="period-dates">${esc(title)}<br><br></div>
 
            </div>

          </section>

<div class="recipient-block">
  <div class="recipient-heading">Spett.le</div>

  <div class="recipient-name">
    ${esc(textOrDash(customerName))}
  </div>

  <div class="recipient-line">
    ${esc(textOrDash(customerAddressLine1))}
  </div>

  ${
    customerAddressLine2
      ? `<div class="recipient-line">${esc(customerAddressLine2)}</div>`
      : ""
  }

  ${
    customerVatOrCf
      ? `<div class="recipient-meta">${esc(customerVatOrCf)}</div>`
      : ""
  }
</div>

          <section class="content">
            <div class="left">
              <section class="soft-card">
                <div class="soft-title">La mia fornitura</div>
                <div class="two-col">
                  <div>
                    <div class="meta-head">Fornitore</div>
                    <div class="meta-body">${esc(textOrDash(supplierName))}</div>
                    ${supplierVatNumber ? `<div class="meta-body">P.IVA ${esc(supplierVatNumber)}</div>` : ""}
                  </div>
                  <div>
                    <div class="meta-head">Intestatario documento</div>
                    <div class="meta-body">${esc(textOrDash(customerName))}</div>
                    <div class="meta-body">${esc(textOrDash(customerAddressLine1))}</div>
                  </div>
                </div>
              </section>

              <section class="soft-card">
                <div class="soft-title">Descrizione documento</div>
                <div class="desc-body">${esc(textOrDash(description))}</div>
              </section>

              ${
                note
                  ? `
                <section class="soft-card">
                  <div class="soft-title">Note</div>
                  <div class="note-body">${esc(note)}</div>
                </section>
              `
                  : ""
              }


            </div>

            <aside class="right">
              <section class="pay-card main">
                <div class="pay-main-head">Quanto devo pagare?</div>
                <div class="pay-main-value">${amountText}</div>
 
              </section>

              <section class="pay-card">
                <div class="pay-row">
                  <div>
                    <div class="pay-left-label">Numero documento</div>
                    <div class="pay-left-sub">${esc(cleanNumber || "-")}</div>
                  </div>
                  <div class="pay-right-value">${esc(cleanNumber || "-")}</div>
                </div>
              </section>

              <section class="pay-card">
                <div class="pay-row">
                  <div>
                    <div class="pay-left-label">Data documento</div>
                    <div class="pay-left-sub">${esc(longDate || "-")}</div>
                  </div>
                  <div class="pay-right-value">${esc(shortDate || "-")}</div>
                </div>
              </section>

     

              <section class="deadline">
                ${
                  isProforma
                    ? "Entro 5 giorni dall’avvenuto pagamento verrà emessa formale fattura."
                    : "Documento emesso a fini amministrativi e contabili."
                }
              </section>



            </aside>

            <section class="soft-card full-width-card payment-box">
              <div class="payment-header">
                <div>
                  <div class="soft-title">Dati per il pagamento</div>
                  <div class="note-body">
                    Coordinate bancarie da utilizzare per il saldo del documento.
                  </div>
                </div>

                <div class="payment-total-pill">
                  <div class="meta-head">Importo</div>
                  <div class="payment-amount-value">${amountText}</div>
                </div>
              </div>

              <div class="payment-grid-clean">
                <div class="payment-cell">
                  <div class="meta-head">Beneficiario</div>
                  <div class="meta-body payment-main-text">
                    ${esc(textOrDash(beneficiary || supplierName))}
                  </div>
                </div>

                <div class="payment-cell iban-cell">
                  <div class="meta-head">IBAN</div>
                  <div class="payment-iban">${esc(textOrDash(iban))}</div>
                </div>

                ${
                  swift
                    ? `
                    <div class="payment-cell">
                      <div class="meta-head">SWIFT / BIC</div>
                      <div class="payment-strong">${esc(swift)}</div>
                    </div>
                  `
                    : ""
                }
              </div>
            </section>
          </section>

<footer class="footer">
  <div class="footer-top">
    <div>
      <div class="footer-title">Contatti</div>
      <div class="footer-caption">Riferimenti aziendali e canali ufficiali</div>
    </div>

    <div class="footer-brand">${esc(textOrDash(supplierName))}</div>
  </div>

  <div class="footer-grid footer-grid-professional">
    <div class="footer-card">
      <div class="footer-card-label">
        <span class="footer-icon-badge">⌂</span>
        Indirizzo postale
      </div>
      <div class="footer-card-value">
        ${esc(textOrDash(operatingAddress))}
      </div>
    </div>

    <div class="footer-card">
      <div class="footer-card-label">
        <span class="footer-icon-badge">☎</span>
        Telefono
      </div>
      <div class="footer-card-value phone-list">
        ${phone1 ? `<div>${esc(phone1)}</div>` : ""}
        ${phone2 ? `<div>${esc(phone2)}</div>` : ""}
        ${mobile ? `<div>${esc(mobile)}</div>` : ""}
      </div>
    </div>

    <div class="footer-card footer-card-channels">
      <div class="footer-card-label">
        <span class="footer-icon-badge">@</span>
        Canali ufficiali
      </div>

      <div class="footer-card-value channel-list">
        ${email ? `<div>${esc(email)}</div>` : "<div>info@idromardi.it</div>"}
        ${website ? `<div>${esc(website)}</div>` : ""}
        <div>facebook.com/idromardi</div>
        <div>@idromardi_servizi</div>
      </div>
    </div>
  </div>

  <div class="footer-bottom">
    <div class="legal">
      ${esc(textOrDash(supplierName))}
      ${supplierVatNumber ? ` · P.IVA ${esc(supplierVatNumber)}` : ""}
      ${legalAddress ? ` · ${esc(legalAddress)}` : ""}
    </div>

    <div class="page-no">Pag. 1</div>
  </div>
</footer>
        </div>
      </article>
    </section>
  `;
}


async function generateFatturaPdf(id, mode = "color") {

  const doc = await getFatturaPrintData(id);
 
   
  const html = buildFinancialDocumentPdfHtml({
    documentType: "FATTURA",
    supplierName: "Idromardi l.t.d.",
    supplierVatNumber: "204524123",
    supplierSubtitle: "Lettura e contabilità - apparecchi idrici e Manutenzione",
    documentNumber: doc.numero || doc.id,
    documentDate: doc.data_documento,
    customerName: doc.amministratore || "Amministrazione Condominio",
    customerAddressLine1: doc.indirizzo || "-",
    customerAddressLine2: doc.cap && doc.citta ? `${doc.cap} - ${doc.citta}` : "",
    customerVatOrCf: "C.F./P.Iva " + (doc.codice_fiscale || doc.iva || "-"),
    description: doc.descrizione || "Fattura manuale.",
    amount: doc.importo || 0,
    beneficiary: "Idromardi ltd",
    iban: "BG 32 BPBI 7940 1485 3382 01",
    swift: "BPBI BGSF",
    note: "Documento emesso a fini amministrativi e contabili.",
    legalAddress: "Шипченски проход (Shipchenski Prohod), 65B blocco 11 - 1574 Sofia (BG)",
    operatingAddress: "Via Posillipo, 299 - 80123 Napoli (IT)",
    phone1: "+35 987 689.84.62",
    phone2: "+39 081 575.02.63",
    mobile: "+39 328 32.98.115",
    email: "info@idromardi.it",
    website: "www.idromardi.it",
    logoUrl: logoUrl,
  });

  return await htmlToPdfBuffer(html, mode);
}

async function generateProformaPdf(id) {
  const doc = await getProformaPrintData(id);

  const html = buildFinancialDocumentPdfHtml({
    documentType: "PROFORMA",
    supplierName: "Idromardi l.t.d.",
    supplierVatNumber: "204524123",
    supplierSubtitle: "Lettura e contabilità - apparecchi idrici e Manutenzione",
    documentNumber: doc.numero || doc.id,
    documentDate: doc.data_documento,
    customerName: doc.amministratore || "Amministrazione Condominio",
    customerAddressLine1: doc.indirizzo || "-",
    customerAddressLine2: "",
    customerVatOrCf: "",
    description: doc.descrizione || "Fattura manuale.",
    amount: doc.importo || 0,
    beneficiary: "Idromardi ltd",
    iban: "BG 32 BPBI 7940 1485 3382 01",
    swift: "BPBI BGSF",
    note: "Documento emesso a fini amministrativi e contabili.",
    legalAddress: "Шипченски проход (Shipchenski Prohod), 65B blocco 11 - 1574 Sofia (BG)",
    operatingAddress: "Via Posillipo, 299 - 80123 Napoli (IT)",
    phone1: "+35 987 689.84.62",
    phone2: "+39 081 575.02.63",
    mobile: "+39 328 32.98.115",
    email: "info@idromardi.it",
    website: "www.idromardi.it",
    logoUrl: "../../uploads/logo_colorato.png",
  });

  return await htmlToPdfBuffer(html, mode);
}

async function resetToEmessa(id) {
  await db.query(
    `
    UPDATE proformas
    SET stato = 'EMESSA',
        fattura_id = NULL
    WHERE id = ?
    `,
    [id]
  );
}

 module.exports = {
  resetToEmessa,
  listImportedDocuments,
  getImportedDocumentDetail,
  uploadImportedDocuments,
  parseImportedDocument,
  getSummary,
  getRecentRows,
  getNextDocumentNumber,
  promoteImportedDocumentToProforma,
  searchCondomini,
  listCondominiSimple,
  annullaProforma,
  deleteProforma,
  deleteImportedDocument,
    deleteImportedDocumentF,
  listProformas,
  collegaProformeAFatturaEsistente,
  listFattureSimple,
  listFattureWithProforme,
  getFatturaProforme,
  uploadImportedDocumentsF,
  parseImportedDocumentF,
  collegaSingolaProformaAFattura,
  promoteImportedDocumentToFattura,
  getFatturaDetail,
  annullaFattura,
  registraPagamentoFattura,
  listPayments,
  getPaymentDetail,
  createManualProforma,
  createManualFattura,
  generateProformaPdf,
  generateFatturaPdf,

};
