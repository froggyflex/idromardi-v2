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
