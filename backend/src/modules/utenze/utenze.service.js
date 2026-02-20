const db = require("../../config/db");
const { v4: uuid } = require("uuid");

exports.getByCondominio = async (condominioId) => {
  const [rows] = await db.execute(
    `
    SELECT *
    FROM utenze_v2
    WHERE condominio_id = ?
    AND stato = 'ATTIVA'
    ORDER BY id_user ASC
    `,
    [condominioId]
  );

  return rows;
};

exports.create = async (condominioId, data) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {

    const [[condominio]] = await conn.execute(
    `SELECT id FROM condomini_v2 WHERE id = ?`,
      [condominioId]
    );

    if (!condominio) {
      throw new Error("Condominio not found. Cannot create utenza.");
    }

    // 1️⃣ Find first gap among ATTIVA users
    const [[gapRow]] = await conn.execute(
      `
      SELECT MIN(t1.id_user + 1) AS next_id
      FROM utenze_v2 t1
      LEFT JOIN utenze_v2 t2
        ON t1.condominio_id = t2.condominio_id
        AND t2.id_user = t1.id_user + 1
        AND t2.stato = 'ATTIVA'
      WHERE t1.condominio_id = ?
        AND t1.stato = 'ATTIVA'
        AND t2.id IS NULL
      `,
      [condominioId]
    );

    let nextId = gapRow?.next_id;

    // 2️⃣ If no gap, fallback to MAX + 1 (ATTIVA only)
    if (!nextId) {
      const [[maxRow]] = await conn.execute(
        `
        SELECT COALESCE(MAX(id_user), 0) + 1 AS next_id
        FROM utenze_v2
        WHERE condominio_id = ?
        AND stato = 'ATTIVA'
        `,
        [condominioId]
      );

      nextId = maxRow.next_id;
    }

    const newId = uuid();

    await conn.execute(
      `
      INSERT INTO utenze_v2 (
        id,
        condominio_id,
        id_user,
        Nome,
        Cognome,
        Interno,
        stato,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'ATTIVA', NOW(), NOW())
      `,
      [
        newId,
        condominioId,
        nextId,
        data.Nome || "",
        data.Cognome || "",
        data.Interno || ""
      ]
    );

    await conn.commit();
    return newId;

  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

exports.getNextIdUser = async (condominioId) => {
  const conn = await db.getConnection();

  try {
    // Try find first gap
    const [[gapRow]] = await conn.execute(
      `
      SELECT MIN(t1.id_user + 1) AS next_id
      FROM utenze_v2 t1
      LEFT JOIN utenze_v2 t2
        ON t1.condominio_id = t2.condominio_id
        AND t2.id_user = t1.id_user + 1
        AND t2.stato = 'ATTIVA'
      WHERE t1.condominio_id = ?
        AND t1.stato = 'ATTIVA'
        AND t2.id IS NULL
      `,
      [condominioId]
    );

    let nextId = gapRow?.next_id;

    if (!nextId) {
      const [[maxRow]] = await conn.execute(
        `
        SELECT COALESCE(MAX(id_user), 0) + 1 AS next_id
        FROM utenze_v2
        WHERE condominio_id = ?
        AND stato = 'ATTIVA'
        `,
        [condominioId]
      );

      nextId = maxRow.next_id;
    }

    return nextId;

  } finally {
    conn.release();
  }
};

exports.batchUpdate = async (condominioId, rows) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    for (const r of rows) {
      await conn.execute(
        `
        UPDATE utenze_v2
        SET
          id_user = ?,
          Nome = ?,
          Cognome = ?,
          Interno = ?,
          Scala = ?,
          Isolato = ?,
          Piano = ?,
          Mobile = ?,
          Nucleo = ?,
          Matricola_Contatore = ?,
          Doppio_Contatore = ?,
          Contatore_Inverso = ?,
          Bonus_Idrico = ?,
          Tipo = ?,
          Palazzina = ?,
          Domestico = ?,
          Artigianale = ?,
          updated_at = NOW()
        WHERE id = ?
        AND condominio_id = ?
        `,
        [
          r.id_user,
          r.Nome,
          r.Cognome,
          r.Interno,
          r.Scala,
          r.Isolato,
          r.Piano,
          r.Mobile,
          r.Nucleo,
          r.Matricola_Contatore,
          r.Doppio_Contatore,
          r.Contatore_Inverso,
          r.Bonus_Idrico,
          r.Tipo,
          r.Palazzina,
          r.Domestico,
          r.Artigianale,
          r.id,
          condominioId
        ]
      );
    }

    await conn.commit();

  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

exports.remove = async (utenzaId, resequence) => {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1️⃣ Get condominio_id (and lock row)
    const [[row]] = await conn.execute(
      `
      SELECT condominio_id
      FROM utenze_v2
      WHERE id = ?
      FOR UPDATE
      `,
      [utenzaId]
    );

    if (!row) {
      throw new Error("Utenza non trovata");
    }

    // 2️⃣ Soft delete
    await conn.execute(
      `
      UPDATE utenze_v2
      SET stato = 'CHIUSA',
          updated_at = NOW()
      WHERE id = ?
      `,
      [utenzaId]
    );

    // 3️⃣ Optional resequence
    if (resequence) {
      const [activeRows] = await conn.execute(
        `
        SELECT id
        FROM utenze_v2
        WHERE condominio_id = ?
        AND stato = 'ATTIVA'
        ORDER BY id_user
        FOR UPDATE
        `,
        [row.condominio_id]
      );

      let counter = 1;

      for (const u of activeRows) {
        await conn.execute(
          `
          UPDATE utenze_v2
          SET id_user = ?,
              updated_at = NOW()
          WHERE id = ?
          `,
          [counter, u.id]
        );
        counter++;
      }
    }

    await conn.commit();

  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

