const db = require("../../config/db");

const SEARCH_SCOPES = new Set([
  "all",
  "condomini",
  "utenze",
  "periodi",
  "fatture",
  "documenti",
]);

function normalizeSearchQuery(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function normalizeSearchScope(value) {
  const scope = String(value || "all").trim().toLowerCase();
  return SEARCH_SCOPES.has(scope) ? scope : "all";
}

function normalizeSearchLimit(value, scope) {
  const fallback = scope === "all" ? 6 : 30;
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(50, Math.max(1, parsed));
}

function withHasMore(rows, limit) {
  return {
    items: rows.slice(0, limit),
    hasMore: rows.length > limit,
  };
}

function formatPeriod(month, year) {
  if (!month || !year) return null;
  return `${String(month).padStart(2, "0")}/${year}`;
}

async function searchCondomini(query, limit) {
  const like = `%${query}%`;
  const prefix = `${query}%`;
  const [rows] = await db.query(
    `
    SELECT
      c.id,
      c.codice,
      c.nome,
      c.indirizzo,
      c.cap,
      c.citta,
      c.stato,
      c.nuae,
      (
        SELECT cc.nome
        FROM condominio_contatti_v2 cc
        WHERE cc.condominio_id = c.id
        ORDER BY cc.created_at ASC
        LIMIT 1
      ) AS amministratore,
      (
        SELECT COUNT(*)
        FROM utenze_v2 u
        WHERE u.condominio_id = c.id
          AND u.stato = 'ATTIVA'
      ) AS utenze_attive
    FROM condomini_v2 c
    WHERE
      CONCAT_WS(' ', c.codice, c.nome, c.indirizzo, c.cap, c.citta, c.nuae, c.contratto) LIKE ?
      OR EXISTS (
        SELECT 1
        FROM condominio_contatti_v2 cc
        WHERE cc.condominio_id = c.id
          AND CONCAT_WS(' ', cc.nome, cc.ruolo, cc.telefono, cc.email) LIKE ?
      )
    ORDER BY
      CASE
        WHEN CAST(c.codice AS CHAR) = ? THEN 0
        WHEN c.nome LIKE ? THEN 1
        WHEN c.indirizzo LIKE ? THEN 2
        ELSE 3
      END,
      c.codice ASC
    LIMIT ?
    `,
    [like, like, query, prefix, prefix, limit + 1]
  );

  return withHasMore(
    rows.map((row) => ({
      type: "condominio",
      id: row.id,
      condominioId: row.id,
      title: row.nome || `Condominio ${row.codice}`,
      subtitle: [row.indirizzo, row.cap, row.citta].filter(Boolean).join(" - "),
      status: row.stato || null,
      code: row.codice == null ? null : String(row.codice),
      administrator: row.amministratore || null,
      activeUsers: Number(row.utenze_attive || 0),
      nuae: row.nuae || null,
    })),
    limit
  );
}

async function searchUtenze(query, limit) {
  const like = `%${query}%`;
  const prefix = `${query}%`;
  const [rows] = await db.query(
    `
    SELECT
      u.id,
      u.condominio_id,
      u.id_user,
      u.Nome,
      u.Cognome,
      u.Interno,
      u.Scala,
      u.Isolato,
      u.Matricola_Contatore,
      u.Contatore_Inverso,
      u.stato,
      c.codice AS condominio_codice,
      c.nome AS condominio_nome,
      c.indirizzo AS condominio_indirizzo
    FROM utenze_v2 u
    JOIN condomini_v2 c ON c.id = u.condominio_id
    WHERE CONCAT_WS(
      ' ',
      u.id_user,
      u.Nome,
      u.Cognome,
      u.Interno,
      u.Scala,
      u.Isolato,
      u.Matricola_Contatore,
      c.codice,
      c.nome,
      c.indirizzo
    ) LIKE ?
    ORDER BY
      CASE
        WHEN u.Matricola_Contatore = ? THEN 0
        WHEN u.Cognome LIKE ? THEN 1
        WHEN u.Nome LIKE ? THEN 2
        ELSE 3
      END,
      c.codice ASC,
      u.id_user ASC
    LIMIT ?
    `,
    [like, query, prefix, prefix, limit + 1]
  );

  return withHasMore(
    rows.map((row) => {
      const fullName = [row.Cognome, row.Nome].filter(Boolean).join(" ").trim();
      return {
        type: "utenza",
        id: row.id,
        condominioId: row.condominio_id,
        title: fullName || `Utenza ${row.id_user}`,
        subtitle:
          row.condominio_nome ||
          row.condominio_indirizzo ||
          `Condominio ${row.condominio_codice}`,
        status: row.stato || null,
        userNumber: row.id_user == null ? null : String(row.id_user),
        meterNumber: row.Matricola_Contatore || null,
        apartment: row.Interno || null,
        staircase: row.Scala || null,
        block: row.Isolato || null,
        inverseMeter: String(row.Contatore_Inverso || "").toUpperCase() === "SI",
        condominioCode:
          row.condominio_codice == null ? null : String(row.condominio_codice),
      };
    }),
    limit
  );
}

async function searchPeriodi(query, limit) {
  const like = `%${query}%`;
  const [rows] = await db.query(
    `
    SELECT
      fs.id,
      fs.id_condominio,
      fs.stato,
      fs.tf_code,
      fs.grand_total,
      fs.updated_at,
      c.codice AS condominio_codice,
      c.nome AS condominio_nome,
      c.indirizzo AS condominio_indirizzo,
      pa.period_month AS mese_attuale,
      pa.period_year AS anno_attuale,
      pp.period_month AS mese_precedente,
      pp.period_year AS anno_precedente
    FROM fatture_sessioni fs
    JOIN condomini_v2 c ON c.id = fs.id_condominio
    LEFT JOIN letture_sessioni pa ON pa.id = fs.id_periodo_attuale
    LEFT JOIN letture_sessioni pp ON pp.id = fs.id_periodo_precedente
    WHERE CONCAT_WS(
      ' ',
      fs.id,
      fs.stato,
      fs.tf_code,
      c.codice,
      c.nome,
      c.indirizzo,
      CONCAT(LPAD(COALESCE(pp.period_month, ''), 2, '0'), '/', COALESCE(pp.period_year, '')),
      CONCAT(LPAD(COALESCE(pa.period_month, ''), 2, '0'), '/', COALESCE(pa.period_year, ''))
    ) LIKE ?
    ORDER BY pa.period_year DESC, pa.period_month DESC, fs.updated_at DESC
    LIMIT ?
    `,
    [like, limit + 1]
  );

  return withHasMore(
    rows.map((row) => {
      const previousPeriod = formatPeriod(row.mese_precedente, row.anno_precedente);
      const currentPeriod = formatPeriod(row.mese_attuale, row.anno_attuale);
      return {
        type: "periodo",
        id: row.id,
        condominioId: row.id_condominio,
        title: `Fatturazione ${previousPeriod || "-"} → ${currentPeriod || "-"}`,
        subtitle:
          row.condominio_nome ||
          row.condominio_indirizzo ||
          `Condominio ${row.condominio_codice}`,
        status: row.stato || null,
        previousPeriod,
        currentPeriod,
        tariffCode: row.tf_code || null,
        amount: row.grand_total == null ? null : Number(row.grand_total),
        updatedAt: row.updated_at || null,
        condominioCode:
          row.condominio_codice == null ? null : String(row.condominio_codice),
      };
    }),
    limit
  );
}

async function searchFatture(query, limit) {
  const like = `%${query}%`;
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
      f.updated_at,
      c.codice AS condominio_codice,
      c.nome AS condominio_nome,
      c.indirizzo AS condominio_indirizzo
    FROM fatture f
    LEFT JOIN condomini_v2 c ON c.id = f.condominio_id
    WHERE CONCAT_WS(
      ' ',
      f.numero_progressivo,
      f.numero,
      f.descrizione,
      f.data_documento,
      f.importo,
      f.stato,
      c.codice,
      c.nome,
      c.indirizzo
    ) LIKE ?
    ORDER BY f.data_documento DESC, f.created_at DESC, f.numero_progressivo DESC
    LIMIT ?
    `,
    [like, limit + 1]
  );

  return withHasMore(
    rows.map((row) => ({
      type: "fattura",
      id: row.id,
      condominioId: row.condominio_id,
      title: `Fattura ${row.numero || row.numero_progressivo || row.id}`,
      subtitle:
        row.condominio_nome ||
        row.condominio_indirizzo ||
        (row.condominio_codice ? `Condominio ${row.condominio_codice}` : "Senza condominio"),
      status: row.stato || null,
      invoiceNumber: row.numero || null,
      progressiveNumber:
        row.numero_progressivo == null ? null : String(row.numero_progressivo),
      description: row.descrizione || null,
      documentDate: row.data_documento || null,
      amount: row.importo == null ? null : Number(row.importo),
      updatedAt: row.updated_at || null,
      condominioCode:
        row.condominio_codice == null ? null : String(row.condominio_codice),
    })),
    limit
  );
}

async function optionalQuery(sql, params) {
  try {
    const [rows] = await db.query(sql, params);
    return rows;
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE" || error?.code === "ER_BAD_FIELD_ERROR") {
      console.warn("Optional global-search source unavailable:", error.message);
      return [];
    }
    throw error;
  }
}

async function searchDocumenti(query, limit) {
  const like = `%${query}%`;
  const [generatedRows, importedRows] = await Promise.all([
    optionalQuery(
      `
      SELECT
        gd.id,
        gd.condominio_id,
        gd.fattura_id,
        gd.document_type,
        gd.filename,
        gd.file_size,
        gd.created_at,
        c.codice AS condominio_codice,
        c.nome AS condominio_nome,
        c.indirizzo AS condominio_indirizzo
      FROM generated_documents gd
      LEFT JOIN condomini_v2 c ON c.id = gd.condominio_id
      WHERE CONCAT_WS(
        ' ',
        gd.filename,
        gd.document_type,
        c.codice,
        c.nome,
        c.indirizzo
      ) LIKE ?
      ORDER BY gd.created_at DESC
      LIMIT ?
      `,
      [like, limit + 1]
    ),
    optionalQuery(
      `
      SELECT
        iid.id,
        iid.condominio_id,
        iid.linked_session_id,
        iid.original_filename,
        iid.numero_bolletta,
        iid.codice_fornitura,
        iid.fornitore_servizi,
        iid.parse_status,
        iid.uploaded_at,
        c.codice AS condominio_codice,
        c.nome AS condominio_nome,
        c.indirizzo AS condominio_indirizzo
      FROM imported_invoice_documents iid
      LEFT JOIN condomini_v2 c ON c.id = iid.condominio_id
      WHERE CONCAT_WS(
        ' ',
        iid.original_filename,
        iid.numero_bolletta,
        iid.codice_fornitura,
        iid.fornitore_servizi,
        c.codice,
        c.nome,
        c.indirizzo
      ) LIKE ?
      ORDER BY iid.uploaded_at DESC
      LIMIT ?
      `,
      [like, limit + 1]
    ),
  ]);

  const generated = generatedRows.map((row) => ({
    type: "documento",
    id: row.id,
    source: "generated",
    condominioId: row.condominio_id,
    billingSessionId: row.fattura_id || null,
    title: row.filename || "Documento generato",
    subtitle:
      row.condominio_nome ||
      row.condominio_indirizzo ||
      (row.condominio_codice ? `Condominio ${row.condominio_codice}` : "Archivio documenti"),
    status: row.document_type || "documento",
    documentType: row.document_type || null,
    fileSize: row.file_size == null ? null : Number(row.file_size),
    createdAt: row.created_at || null,
    condominioCode:
      row.condominio_codice == null ? null : String(row.condominio_codice),
  }));

  const imported = importedRows.map((row) => ({
    type: "documento",
    id: `imported:${row.id}`,
    source: "imported",
    sourceId: String(row.id),
    condominioId: row.condominio_id,
    billingSessionId: row.linked_session_id || null,
    title: row.original_filename || "Documento importato",
    subtitle:
      row.condominio_nome ||
      row.condominio_indirizzo ||
      (row.condominio_codice ? `Condominio ${row.condominio_codice}` : "Archivio documenti"),
    status: row.parse_status || "CARICATO",
    documentType: "documento_importato",
    invoiceNumber: row.numero_bolletta || null,
    supplyCode: row.codice_fornitura || null,
    provider: row.fornitore_servizi || null,
    createdAt: row.uploaded_at || null,
    condominioCode:
      row.condominio_codice == null ? null : String(row.condominio_codice),
  }));

  const combined = [...generated, ...imported]
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  return withHasMore(combined, limit);
}

async function search({ query: rawQuery, scope: rawScope, limit: rawLimit }) {
  const query = normalizeSearchQuery(rawQuery);
  const scope = normalizeSearchScope(rawScope);
  const limit = normalizeSearchLimit(rawLimit, scope);

  if (!query) {
    return {
      query,
      scope,
      groups: {},
      hasMore: {},
      total: 0,
    };
  }

  const handlers = {
    condomini: searchCondomini,
    utenze: searchUtenze,
    periodi: searchPeriodi,
    fatture: searchFatture,
    documenti: searchDocumenti,
  };
  const requestedScopes = scope === "all" ? Object.keys(handlers) : [scope];
  const entries = await Promise.all(
    requestedScopes.map(async (currentScope) => [
      currentScope,
      await handlers[currentScope](query, limit),
    ])
  );

  const groups = {};
  const hasMore = {};
  let total = 0;
  for (const [currentScope, result] of entries) {
    groups[currentScope] = result.items;
    hasMore[currentScope] = result.hasMore;
    total += result.items.length;
  }

  return { query, scope, groups, hasMore, total };
}

module.exports = {
  normalizeSearchLimit,
  normalizeSearchQuery,
  normalizeSearchScope,
  search,
};
