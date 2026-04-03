 
const fs = require("fs");
const crypto = require("crypto");
//const { PDFParse } = require("pdf-parse");
const pdf = require("pdf-parse");
const db = require("../../config/db");

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

function parseItalianAmount(raw) {
  if (!raw) return null;
  const normalized = String(raw).replace(/\./g, "").replace(",", ".").trim();
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}
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

  const patterns = [
    /Proforma\s+di\s+fattura\s*(?:n\.|nr\.|n°|num\.?)\s*([A-Z0-9/-]+)\s+del\s+([^\n]+)/i,
    /Proforma\s+di\s+fattura\s+([A-Z0-9/-]+)\s+del\s+([^\n]+)/i,
    /Proforma\s*(?:n\.|nr\.|n°|num\.?)\s*([A-Z0-9/-]+)\s+del\s+([^\n]+)/i
  ];

  for (const pattern of patterns) {
    const m = normalized.match(pattern);
    if (m) {
      return {
        documentType: "proforma_invoice",
        invoiceNumber: cleanValue(m[1]) || null,
        invoiceDate: parseItalianLongDate(m[2]) || null
      };
    }
  }

  return {
    documentType: null,
    invoiceNumber: null,
    invoiceDate: null
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

function parseProformaRawText(rawText) {
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

async function listImportedDocuments() {
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
      i.extracted_amount
    FROM import_batch_files f
    LEFT JOIN import_items i
      ON i.batch_id = f.batch_id
     AND i.promoted_entity_id = f.id
    ORDER BY f.created_at DESC
    `
  );

  return rows.map((r) => ({
    id: r.id,
    batch_id: r.batch_id,
    original_filename: r.original_filename,
    parse_status: r.parse_status,
    review_status: r.review_status || "DA_REVISIONARE",
    numero: r.extracted_number || null,
    data_documento: r.extracted_date || null,
    importo: r.extracted_amount != null ? Number(r.extracted_amount) : null,
    uploaded_at: r.created_at,
  }));
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
     AND i.document_type = 'PROFORMA'
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
      parsed?.serviceDescription +" "+ parsed?.customerAddressLines ||
      "Proforma importata da parser";

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

async function getNextDocumentNumber(conn, documentType, anno, buildingLabel = null) {
  const [rows] = await conn.query(
    `
    SELECT id, current_value
    FROM document_number_counters
    WHERE document_type = ? AND anno = ?
    FOR UPDATE
    `,
    [documentType, anno]
  );

  let nextValue = 1;

  if (!rows.length) {
    const counterId = crypto.randomUUID();
    await conn.query(
      `
      INSERT INTO document_number_counters (
        id, document_type, anno, current_value, created_at, updated_at
      )
      VALUES (?, ?, ?, 1, NOW(), NOW())
      `,
      [counterId, documentType, anno]
    );
    nextValue = 1;
  } else {
    nextValue = Number(rows[0].current_value || 0) + 1;
    await conn.query(
      `
      UPDATE document_number_counters
      SET current_value = ?, updated_at = NOW()
      WHERE id = ?
      `,
      [nextValue, rows[0].id]
    );
  }

  const padded = String(nextValue).padStart(6, "0");

  const slug = buildingLabel
    ? String(buildingLabel)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    : null;

  if (documentType === "PROFORMA") {
    return {
      progressivo: nextValue,
      numero: slug ? `PF-${padded}-${slug}` : `PF-${padded}`,
    };
  }

  throw new Error("Tipo documento non supportato per la numerazione.");
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
        throw new Error("Proforma già creata per questo documento.");
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
    LIMIT 50
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

 module.exports = {
  listImportedDocuments,
  getImportedDocumentDetail,
  uploadImportedDocuments,
  parseImportedDocument,
    getSummary,
  getRecentRows,
  getNextDocumentNumber,
  promoteImportedDocumentToProforma,
  searchCondomini,
  listCondominiSimple
};