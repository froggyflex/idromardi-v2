const db = require("../../config/db");
const { v4: uuidv4 } = require("uuid");

/* ------------------ Helpers ------------------ */

function assertUUID(id, name) {
  if (!id || typeof id !== "string" || id.length !== 36) {
    throw new Error(`${name} must be a valid UUID`);
  }
}

function assertStr(s, name) {
  if (!s || typeof s !== "string") throw new Error(`${name} is required`);
}

function assertInt(n, name) {
  if (!Number.isInteger(n)) throw new Error(`${name} must be integer`);
}

function assertDateISO(s, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${name} must be YYYY-MM-DD`);
}

function isUuidLike(id) {
  return typeof id === "string" && id.length === 36;
}

function toEndDate(d) {
  return d ?? "9999-12-31";
}

async function ensureNoOverlap(conn, { providerId, validFrom, validTo, excludeVersionId = null }) {
  // overlap if: existing.from <= new.to AND new.from <= existing.to
  const [rows] = await conn.query(
    `
    SELECT id, valid_from, valid_to
    FROM casa_idrica_tariffe
    WHERE id_casa_idrica = ?
      AND (? IS NULL OR id <> ?)
      AND valid_from <= ?
      AND ? <= COALESCE(valid_to, '9999-12-31')
    LIMIT 1
    `,
    [
      providerId,
      excludeVersionId,
      excludeVersionId,
      toEndDate(validTo),
      validFrom,
    ]
  );

  if (rows.length > 0) {
    throw new Error("Overlapping tariff validity range for this provider");
  }
}

/* ------------------ Providers ------------------ */

exports.listProviders = async function() {
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT * FROM casa_idrica ORDER BY nome ASC`
    );
    return { providers: rows };
  } finally {
    conn.release();
  }
}

exports.createProvider = async function({ codice, nome }) {
  assertStr(codice, "codice");
  assertStr(nome, "nome");

  const conn = await db.getConnection();
  try {
    const id = uuidv4();
    await conn.query(
      `INSERT INTO casa_idrica (id, codice, nome, attiva) VALUES (?, ?, ?, 1)`,
      [id, codice.trim().toUpperCase(), nome.trim()]
    );
    const [rows] = await conn.query(`SELECT * FROM casa_idrica WHERE id = ?`, [id]);
    return { provider: rows[0] };
  } finally {
    conn.release();
  }
}

exports.getProvider = async function({ providerId }) {
  assertUUID(providerId, "providerId");
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query(`SELECT * FROM casa_idrica WHERE id = ?`, [providerId]);
    if (rows.length === 0) throw new Error("Provider not found");
    return { provider: rows[0] };
  } finally {
    conn.release();
  }
}

/* ------------------ Versions ------------------ */

exports.listVersionsByProvider = async function({ providerId }) {
  assertUUID(providerId, "providerId");

  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query(
      `
      SELECT *
      FROM casa_idrica_tariffe
      WHERE id_casa_idrica = ?
      ORDER BY anno DESC, valid_from DESC
      `,
      [providerId]
    );
    return { versions: rows };
  } finally {
    conn.release();
  }
}

exports.createVersion = async function({ providerId, anno, valid_from, valid_to = null, descrizione = null }) {
  assertUUID(providerId, "providerId");
  assertInt(Number(anno), "anno");
  assertDateISO(valid_from, "valid_from");
  if (valid_to) assertDateISO(valid_to, "valid_to");

  const conn = await db.getConnection();
  try {
    await ensureNoOverlap(conn, {
      providerId,
      validFrom: valid_from,
      validTo: valid_to,
      excludeVersionId: null,
    });

    const id = uuidv4();

    await conn.query(
      `
      INSERT INTO casa_idrica_tariffe
      (id, id_casa_idrica, anno, valid_from, valid_to, descrizione)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [id, providerId, Number(anno), valid_from, valid_to, descrizione]
    );

    const [rows] = await conn.query(`SELECT * FROM casa_idrica_tariffe WHERE id = ?`, [id]);
    return { version: rows[0] };
  } finally {
    conn.release();
  }
}

exports.updateVersion = async function({ versionId, anno, valid_from, valid_to = null, descrizione = null }) {
  assertUUID(versionId, "versionId");
  assertInt(Number(anno), "anno");
  assertDateISO(valid_from, "valid_from");
  if (valid_to) assertDateISO(valid_to, "valid_to");

  const conn = await db.getConnection();
  try {
    const [curRows] = await conn.query(
      `SELECT id_casa_idrica FROM casa_idrica_tariffe WHERE id = ?`,
      [versionId]
    );
    if (curRows.length === 0) throw new Error("Version not found");
    const providerId = curRows[0].id_casa_idrica;

    await ensureNoOverlap(conn, {
      providerId,
      validFrom: valid_from,
      validTo: valid_to,
      excludeVersionId: versionId,
    });

    await conn.query(
      `
      UPDATE casa_idrica_tariffe
      SET anno = ?, valid_from = ?, valid_to = ?, descrizione = ?
      WHERE id = ?
      `,
      [Number(anno), valid_from, valid_to, descrizione, versionId]
    );

    const [rows] = await conn.query(`SELECT * FROM casa_idrica_tariffe WHERE id = ?`, [versionId]);
    return { version: rows[0] };
  } finally {
    conn.release();
  }
}

exports.getVersionFull = async function ({ versionId }) {
  assertUUID(versionId, "versionId");

  const conn = await db.getConnection();
  try {
    const [vRows] = await conn.query(
      `SELECT * FROM casa_idrica_tariffe WHERE id = ?`,
      [versionId]
    );

    if (vRows.length === 0) throw new Error("Version not found");
    const version = vRows[0];

    const [catRows] = await conn.query(
      `
      SELECT *
      FROM casa_idrica_tariff_categorie
      WHERE id_tariffa = ?
      ORDER BY codice ASC
      `,
      [versionId]
    );

    const categoryIds = catRows.map((c) => c.id);

    let sRows = [];
    let qRows = [];
    let cRows = [];

    if (categoryIds.length > 0) {
      const inList = categoryIds.map(() => "?").join(",");

      const [scaglioniRows] = await conn.query(
        `
        SELECT *
        FROM casa_idrica_tariff_scaglioni
        WHERE id_categoria IN (${inList})
        ORDER BY id_categoria ASC, ordine ASC
        `,
        categoryIds
      );
      sRows = scaglioniRows;

      const [quoteRows] = await conn.query(
        `
        SELECT *
        FROM casa_idrica_tariff_quote_fisse
        WHERE id_categoria IN (${inList})
        ORDER BY id_categoria ASC, codice ASC
        `,
        categoryIds
      );
      qRows = quoteRows;

      const [componentiRows] = await conn.query(
        `
        SELECT *
        FROM casa_idrica_tariff_componenti_mc
        WHERE id_categoria IN (${inList})
        ORDER BY id_categoria ASC, codice ASC
        `,
        categoryIds
      );
      cRows = componentiRows;
    }

    const categories = catRows.map((c) => ({
      ...c,
      scaglioni: sRows.filter((s) => s.id_categoria === c.id),
      quote_fisse: qRows.filter((q) => q.id_categoria === c.id),
      componenti_mc: cRows.filter((x) => x.id_categoria === c.id),
    }));

    return { version, categories };
  } finally {
    conn.release();
  }
};


/* ------------------ Categories ------------------ */

exports.upsertCategory = async function({ versionId, codice, descrizione = null }) {
  assertUUID(versionId, "versionId");
  assertStr(codice, "codice");

  const conn = await db.getConnection();
  try {
    const code = codice.trim().toUpperCase();

    const [rows] = await conn.query(
      `SELECT * FROM casa_idrica_tariff_categorie WHERE id_tariffa = ? AND codice = ? LIMIT 1`,
      [versionId, code]
    );

    if (rows.length > 0) {
      await conn.query(
        `UPDATE casa_idrica_tariff_categorie SET descrizione = ? WHERE id = ?`,
        [descrizione, rows[0].id]
      );
      const [updated] = await conn.query(`SELECT * FROM casa_idrica_tariff_categorie WHERE id = ?`, [rows[0].id]);
      return { category: updated[0] };
    }

    const id = uuidv4();
    await conn.query(
      `INSERT INTO casa_idrica_tariff_categorie (id, id_tariffa, codice, descrizione) VALUES (?, ?, ?, ?)`,
      [id, versionId, code, descrizione]
    );

    const [created] = await conn.query(`SELECT * FROM casa_idrica_tariff_categorie WHERE id = ?`, [id]);
    return { category: created[0] };
  } finally {
    conn.release();
  }
}

exports.saveCategoryConfig = async function({
  categoryId,
  scaglioni = [],
  quote_fisse = [],
  componenti_mc = [],
}) {
  assertUUID(categoryId, "categoryId");

  const conn = await db.getConnection();
  let committed = false;
  try {
    await conn.beginTransaction();

    const [categoryRows] = await conn.query(
      `SELECT * FROM casa_idrica_tariff_categorie WHERE id = ? LIMIT 1`,
      [categoryId]
    );

    if (categoryRows.length === 0) {
      throw new Error("Category not found");
    }

    const normalizedScaglioni = scaglioni.map((s, index) => {
      const nome = String(s.nome || "").trim();
      if (!nome) {
        throw new Error(`Nome scaglione mancante alla riga ${index + 1}`);
      }

      const mcDa = Number(s.mc_da_base ?? 0);
      const mcA = s.mc_a_base === "" || s.mc_a_base === null || s.mc_a_base === undefined
        ? null
        : Number(s.mc_a_base);
      const prezzo = Number(s.prezzo_acquedotto ?? 0);

      if (!Number.isFinite(mcDa) || mcDa < 0) {
        throw new Error(`mc_da non valido alla riga ${index + 1}`);
      }

      if (mcA !== null && (!Number.isFinite(mcA) || mcA <= mcDa)) {
        throw new Error(`mc_a deve essere maggiore di mc_da alla riga ${index + 1}`);
      }

      if (!Number.isFinite(prezzo) || prezzo < 0) {
        throw new Error(`Tariffa acquedotto non valida alla riga ${index + 1}`);
      }

      return {
        id: isUuidLike(s.id) ? s.id : null,
        ordine: Number.isFinite(Number(s.ordine)) ? Number(s.ordine) : index + 1,
        nome,
        mc_da_base: mcDa,
        mc_a_base: mcA,
        moltiplica_per_nucleo: Number(s.moltiplica_per_nucleo) ? 1 : 0,
        prezzo_acquedotto: prezzo,
      };
    });

    const orderedScaglioni = [...normalizedScaglioni].sort(
      (a, b) => a.ordine - b.ordine
    );

    for (let i = 0; i < orderedScaglioni.length; i++) {
      const current = orderedScaglioni[i];
      const currentEnd = current.mc_a_base === null ? Infinity : current.mc_a_base;

      for (let j = i + 1; j < orderedScaglioni.length; j++) {
        const next = orderedScaglioni[j];
        const nextEnd = next.mc_a_base === null ? Infinity : next.mc_a_base;

        if (current.mc_da_base < nextEnd && next.mc_da_base < currentEnd) {
          throw new Error("Scaglioni sovrapposti: correggi mc_da/mc_a prima di salvare.");
        }
      }
    }

    const normalizeCode = (value, fallback) => String(value || fallback).trim().toUpperCase();

    const normalizedQuote = quote_fisse.map((q, index) => {
      const codice = normalizeCode(q.codice, "QF");
      const importo = Number(q.importo ?? 0);

      if (!Number.isFinite(importo) || importo < 0) {
        throw new Error(`Quota fissa non valida alla riga ${index + 1}`);
      }

      return {
        id: isUuidLike(q.id) ? q.id : null,
        codice,
        importo,
      };
    });

    const normalizedComponenti = componenti_mc
      .filter((c) => String(c.codice || "").trim())
      .map((c, index) => {
        const codice = normalizeCode(c.codice, "");
        const prezzo = Number(c.prezzo_mc ?? 0);

        if (!Number.isFinite(prezzo) || prezzo < 0) {
          throw new Error(`Componente ${codice || index + 1} non valida`);
        }

        return {
          id: isUuidLike(c.id) ? c.id : null,
          codice,
          prezzo_mc: prezzo,
        };
      });

    const syncRows = async ({ table, existingRows, rows, insertSql, updateSql, toInsertValues, toUpdateValues }) => {
      const existingIds = new Set(existingRows.map((row) => row.id));
      const keptExistingIds = rows
        .map((row) => row.id)
        .filter((id) => id && existingIds.has(id));

      if (keptExistingIds.length) {
        await conn.query(
          `DELETE FROM ${table} WHERE id_categoria = ? AND id NOT IN (${keptExistingIds.map(() => "?").join(",")})`,
          [categoryId, ...keptExistingIds]
        );
      } else {
        await conn.query(`DELETE FROM ${table} WHERE id_categoria = ?`, [categoryId]);
      }

      for (const row of rows) {
        if (row.id && existingIds.has(row.id)) {
          await conn.query(updateSql, toUpdateValues(row));
        } else {
          const id = uuidv4();
          await conn.query(insertSql, toInsertValues({ ...row, id }));
        }
      }
    };

    const [existingScaglioni] = await conn.query(
      `SELECT id FROM casa_idrica_tariff_scaglioni WHERE id_categoria = ?`,
      [categoryId]
    );
    await syncRows({
      table: "casa_idrica_tariff_scaglioni",
      existingRows: existingScaglioni,
      rows: normalizedScaglioni,
      insertSql: `
        INSERT INTO casa_idrica_tariff_scaglioni
        (id, id_categoria, ordine, nome, mc_da_base, mc_a_base, moltiplica_per_nucleo, prezzo_acquedotto)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      updateSql: `
        UPDATE casa_idrica_tariff_scaglioni
        SET ordine = ?, nome = ?, mc_da_base = ?, mc_a_base = ?, moltiplica_per_nucleo = ?, prezzo_acquedotto = ?
        WHERE id = ?
      `,
      toInsertValues: (row) => [
        row.id,
        categoryId,
        row.ordine,
        row.nome,
        row.mc_da_base,
        row.mc_a_base,
        row.moltiplica_per_nucleo,
        row.prezzo_acquedotto,
      ],
      toUpdateValues: (row) => [
        row.ordine,
        row.nome,
        row.mc_da_base,
        row.mc_a_base,
        row.moltiplica_per_nucleo,
        row.prezzo_acquedotto,
        row.id,
      ],
    });

    const [existingQuote] = await conn.query(
      `SELECT id FROM casa_idrica_tariff_quote_fisse WHERE id_categoria = ?`,
      [categoryId]
    );
    await syncRows({
      table: "casa_idrica_tariff_quote_fisse",
      existingRows: existingQuote,
      rows: normalizedQuote,
      insertSql: `
        INSERT INTO casa_idrica_tariff_quote_fisse
        (id, id_categoria, codice, importo)
        VALUES (?, ?, ?, ?)
      `,
      updateSql: `
        UPDATE casa_idrica_tariff_quote_fisse
        SET codice = ?, importo = ?
        WHERE id = ?
      `,
      toInsertValues: (row) => [row.id, categoryId, row.codice, row.importo],
      toUpdateValues: (row) => [row.codice, row.importo, row.id],
    });

    const [existingComponenti] = await conn.query(
      `SELECT id FROM casa_idrica_tariff_componenti_mc WHERE id_categoria = ?`,
      [categoryId]
    );
    await syncRows({
      table: "casa_idrica_tariff_componenti_mc",
      existingRows: existingComponenti,
      rows: normalizedComponenti,
      insertSql: `
        INSERT INTO casa_idrica_tariff_componenti_mc
        (id, id_categoria, codice, prezzo_mc)
        VALUES (?, ?, ?, ?)
      `,
      updateSql: `
        UPDATE casa_idrica_tariff_componenti_mc
        SET codice = ?, prezzo_mc = ?
        WHERE id = ?
      `,
      toInsertValues: (row) => [row.id, categoryId, row.codice, row.prezzo_mc],
      toUpdateValues: (row) => [row.codice, row.prezzo_mc, row.id],
    });

    await conn.commit();
    committed = true;

    return await exports.getVersionFull({ versionId: categoryRows[0].id_tariffa });
  } catch (err) {
    if (!committed) {
      await conn.rollback();
    }
    throw err;
  } finally {
    conn.release();
  }
};

/* ------------------ Scaglioni ------------------ */

exports.createScaglione = async function({ categoryId, ordine, nome, 
    mc_da_base, mc_a_base = null, moltiplica_per_nucleo = 1, prezzo_acquedotto}) {
  assertUUID(categoryId, "categoryId");
  assertInt(Number(ordine), "ordine");
  assertStr(nome, "nome");

  const conn = await db.getConnection();
  try {
   const id = uuidv4();

    await conn.query(
      `
      INSERT INTO casa_idrica_tariff_scaglioni
      (id, id_categoria, ordine, nome, mc_da_base, mc_a_base,
       moltiplica_per_nucleo, prezzo_acquedotto)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        categoryId,
        Number(ordine),
        nome.trim(),
        Number(mc_da_base ?? 0),
        mc_a_base === "" || mc_a_base === null ? null : Number(mc_a_base),
        moltiplica_per_nucleo ? 1 : 0,
        Number(prezzo_acquedotto),
      ]
    );

    const [rows] = await conn.query(
      `SELECT * FROM casa_idrica_tariff_scaglioni WHERE id = ?`,
      [id]
    );

    return { scaglione: rows[0] };
  } finally {
    conn.release();
  }
}

exports.updateScaglione = async function({ scaglioneId, ordine, nome, mc_da_base, mc_a_base = null, 
    moltiplica_per_nucleo = 1, prezzo_acquedotto }) {
  assertUUID(scaglioneId, "scaglioneId");
  assertInt(Number(ordine), "ordine");
  assertStr(nome, "nome");

  const conn = await db.getConnection();
  try {
    await conn.query(
      `
      UPDATE casa_idrica_tariff_scaglioni
      SET ordine = ?, nome = ?, mc_da_base = ?, mc_a_base = ?, moltiplica_per_nucleo = ?,
          prezzo_acquedotto = ?
      WHERE id = ?
      `,
      [
        Number(ordine),
        nome.trim(),
        Number(mc_da_base ?? 0),
        mc_a_base === "" || mc_a_base === null ? null : Number(mc_a_base),
        moltiplica_per_nucleo ? 1 : 0,
        Number(prezzo_acquedotto),
        scaglioneId,
      ]
    );

    const [rows] = await conn.query(`SELECT * FROM casa_idrica_tariff_scaglioni WHERE id = ?`, [scaglioneId]);
    return { scaglione: rows[0] };
  } finally {
    conn.release();
  }
}

exports.deleteScaglione = async function({ scaglioneId }) {
  assertUUID(scaglioneId, "scaglioneId");
  const conn = await db.getConnection();
  try {
    const [res] = await conn.query(`DELETE FROM casa_idrica_tariff_scaglioni WHERE id = ?`, [scaglioneId]);
    return { ok: true, affectedRows: res.affectedRows };
  } finally {
    conn.release();
  }
}


exports.createComponenteMC = async function({ categoryId, codice, prezzo_mc }) {
  assertUUID(categoryId, "categoryId");

  const conn = await db.getConnection();
  try {
    const id = uuidv4();

    await conn.query(
      `
      INSERT INTO casa_idrica_tariff_componenti_mc
      (id, id_categoria, codice, prezzo_mc)
      VALUES (?, ?, ?, ?)
      `,
      [id, categoryId, codice.trim().toUpperCase(), Number(prezzo_mc)]
    );

    const [rows] = await conn.query(
      `SELECT * FROM casa_idrica_tariff_componenti_mc WHERE id = ?`,
      [id]
    );

    return { componente: rows[0] };
  } finally {
    conn.release();
  }
}

exports.updateComponenteMC = async function({ componenteId, codice, prezzo_mc }) {
  assertUUID(componenteId, "componenteId");

  const conn = await db.getConnection();
  try {
    await conn.query(
      `
      UPDATE casa_idrica_tariff_componenti_mc
      SET codice = ?, prezzo_mc = ?
      WHERE id = ?
      `,
      [codice.trim().toUpperCase(), Number(prezzo_mc), componenteId]
    );

    const [rows] = await conn.query(
      `SELECT * FROM casa_idrica_tariff_componenti_mc WHERE id = ?`,
      [componenteId]
    );

    return { componente: rows[0] };
  } finally {
    conn.release();
  }
}

exports.deleteComponenteMC = async function({ componenteId }) {
  assertUUID(componenteId, "componenteId");

  const conn = await db.getConnection();
  try {
    const [res] = await conn.query(
      `DELETE FROM casa_idrica_tariff_componenti_mc WHERE id = ?`,
      [componenteId]
    );
    return { ok: true, affectedRows: res.affectedRows };
  } finally {
    conn.release();
  }
}



/* ------------------ Quote fisse ------------------ */

exports.createQuotaFissa = async function({ categoryId, codice, importo }) {
  assertUUID(categoryId, "categoryId");
  assertStr(codice, "codice");

  const conn = await db.getConnection();
  try {
    const id = uuidv4();
    await conn.query(
      `
      INSERT INTO casa_idrica_tariff_quote_fisse
      (id, id_categoria, codice, importo)
      VALUES (?, ?, ?, ?)
      `,
      [id, categoryId, codice.trim().toUpperCase(), Number(importo)]
    );

    const [rows] = await conn.query(`SELECT * FROM casa_idrica_tariff_quote_fisse WHERE id = ?`, [id]);
    return { quota: rows[0] };
  } finally {
    conn.release();
  }
}

exports.updateQuotaFissa = async function({ quotaId, codice, importo }) {
  assertUUID(quotaId, "quotaId");
  assertStr(codice, "codice");

  const conn = await db.getConnection();
  try {
    await conn.query(
      `UPDATE casa_idrica_tariff_quote_fisse SET codice = ?, importo = ? WHERE id = ?`,
      [codice.trim().toUpperCase(), Number(importo), quotaId]
    );
    const [rows] = await conn.query(`SELECT * FROM casa_idrica_tariff_quote_fisse WHERE id = ?`, [quotaId]);
    return { quota: rows[0] };
  } finally {
    conn.release();
  }
}

exports.deleteQuotaFissa = async function({ quotaId }) {
  assertUUID(quotaId, "quotaId");
  const conn = await db.getConnection();
  try {
    const [res] = await conn.query(`DELETE FROM casa_idrica_tariff_quote_fisse WHERE id = ?`, [quotaId]);
    return { ok: true, affectedRows: res.affectedRows };
  } finally {
    conn.release();
  }
}
