const pool = require("../../config/db");
const { geocodeAddress } = require("../geocoding/geocoding.services");
const { v4: uuidv4 } = require("uuid");

exports.create = async (data) => {
  const {
    nome,
    indirizzo,
    cap,
    citta,
    isolato,
    scala,
    iva,
    sezione,
    ruolo,
    nuae,
    categoria,
    contratto,
    totale_residenti,
    potenza_contatore,
    oneri,
    oneri_doppio,
    annotazione,
    fatturazione,
    registro_pagamenti,
    periodo_letture_utenti,
    arco_temporale,
    stato = "ATTIVO",
  } = data;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 🔹 Lock table row to prevent race conditions
    const [[row]] = await connection.query(
      "SELECT MAX(codice) as last FROM condomini_v2 FOR UPDATE"
    );

    let codice = data.codice;

    if (!codice) {
      const [[row]] = await connection.query(
        "SELECT MAX(codice) as last FROM condomini_v2 FOR UPDATE"
      );
      codice = (row.last || 0) + 1;
    }

    const geo = await geocodeAddress(indirizzo, citta);
    const latitude = geo?.latitude || null;
    const longitude = geo?.longitude || null;

    const id = uuidv4();

    await connection.query(
      `
      INSERT INTO condomini_v2
      (
        id, codice, nome, indirizzo, cap, citta,
        isolato, scala, iva, sezione, ruolo, nuae,
        categoria, contratto, totale_residenti, potenza_contatore,
        oneri, oneri_doppio, annotazione, fatturazione,
        registro_pagamenti, periodo_letture_utenti, arco_temporale,
        stato, latitude, longitude, created_at, updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, NOW(), NOW()
      )
      `,
      [
        id,
        codice,
        nome,
        indirizzo,
        cap,
        citta,
        isolato,
        scala,
        iva,
        sezione,
        ruolo,
        nuae,
        categoria,
        contratto,
        totale_residenti,
        potenza_contatore,
        oneri,
        oneri_doppio,
        annotazione,
        fatturazione,
        registro_pagamenti,
        periodo_letture_utenti,
        arco_temporale,
        stato,
        latitude,
        longitude,
      ]
    );

    await connection.commit();
    connection.release();

    return { id };

  } catch (err) {
    await connection.rollback();
    connection.release();
    throw err;
  }
};




exports.getAll = async (page = 1, limit = 20, search = "") => {
  const offset = (page - 1) * limit;

  const searchTerm = `%${search}%`;

  const [[{ total }]] = await pool.query(
    `
    SELECT COUNT(*) as total
    FROM condomini_v2 c
    LEFT JOIN condominio_contatti_v2 cc
      ON cc.condominio_id = c.id
    WHERE
      c.codice LIKE ?
      OR c.indirizzo LIKE ?
      OR cc.nome LIKE ?
    `,
    [searchTerm, searchTerm, searchTerm]
  );

  const [rows] = await pool.query(
    `
    SELECT DISTINCT
      c.id,
      c.codice,
      c.nome,
      c.indirizzo,
      c.citta,
      (
        SELECT cc2.nome 
        FROM condominio_contatti_v2 cc2
        WHERE cc2.condominio_id = c.id
        LIMIT 1
      ) AS amministratore
    FROM condomini_v2 c
    LEFT JOIN condominio_contatti_v2 cc
      ON cc.condominio_id = c.id
    WHERE
      c.codice LIKE ?
      OR c.indirizzo LIKE ?
      OR cc.nome LIKE ?
    ORDER BY c.codice ASC
    LIMIT ? OFFSET ?
    `,
    [searchTerm, searchTerm, searchTerm, limit, offset]
  );

  return {
    data: rows,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
};


exports.getContatti = async (condominioId) => {
  const [rows] = await pool.query(
    "SELECT * FROM condominio_contatti_v2 WHERE condominio_id = ?",
    [condominioId]
  );
  return rows;
};

exports.createContatto = async (condominioId, data) => {

    const [[condominio]] = await pool.query(
    `SELECT id FROM condomini_v2 WHERE id = ?`,
      [condominioId]
    );

    if (!condominio) {
      throw new Error("Condominio not found. Cannot create utenza.");
    }

  const { nome, ruolo, telefono, email } = data;

  await pool.query(
    `
    INSERT INTO condominio_contatti_v2
    (id, condominio_id, nome, ruolo, telefono, email, created_at, updated_at)
    VALUES (UUID(), ?, ?, ?, ?, ?, NOW(), NOW())
    `,
    [condominioId, nome, ruolo, telefono, email]
  );

  return { success: true };
};

exports.updateContatto = async (id, data) => {
  const { nome, ruolo, telefono, email } = data;

  await pool.query(
    `
    UPDATE condominio_contatti_v2
    SET nome=?, ruolo=?, telefono=?, email=?, updated_at=NOW()
    WHERE id=?
    `,
    [nome, ruolo, telefono, email, id]
  );

  return { success: true };
};

exports.deleteContatto = async (id) => {
  await pool.query(
    "DELETE FROM condominio_contatti_v2 WHERE id=?",
    [id]
  );
};


exports.getById = async (id) => {
  const [rows] = await pool.query(
    "SELECT * FROM condomini_v2 WHERE id = ?",
    [id]
  );
  return rows[0];
};

exports.update = async (id, data) => {
  const {
    codice,
    nome,
    indirizzo,
    cap,
    citta,
    isolato,
    scala,
    iva,
    sezione,
    ruolo,
    nuae,
    categoria,
    totale_residenti,
    potenza_contatore,
    oneri,
    oneri_doppio,
    annotazione,
    fatturazione,
    registro_pagamenti,
    periodo_letture_utenti,
    arco_temporale,
    contratto,
    stato,
  } = data;


  let latitude = data.latitude;
  let longitude = data.longitude;

  if (data.indirizzo || data.citta) {
    const geo = await geocodeAddress(data.indirizzo, data.citta);
    latitude = geo?.latitude || null;
    longitude = geo?.longitude || null;
  }

  await pool.query(
    `
    UPDATE condomini_v2 SET
      codice=?, nome=?, indirizzo=?, cap=?, citta=?,
      isolato=?, scala=?, iva=?, sezione=?, ruolo=?, nuae=?, categoria=?,
      totale_residenti=?, potenza_contatore=?,
      oneri=?, oneri_doppio=?, annotazione=?, fatturazione=?,
      registro_pagamenti=?, periodo_letture_utenti=?, arco_temporale=?,
      contratto=?, stato=?, updated_at=NOW()
    WHERE id=?
    `,
    [
      codice, nome, indirizzo, cap, citta,
      isolato, scala, iva, sezione, ruolo, nuae, categoria,
      totale_residenti, potenza_contatore,
      oneri, oneri_doppio, annotazione, fatturazione,
      registro_pagamenti, periodo_letture_utenti, arco_temporale,
      contratto, stato,
      id
    ]
  );
};

exports.updateImage = async (id, imageUrl) => {
  await pool.query(
    "UPDATE condomini_v2 SET image_url=?, updated_at=NOW() WHERE id=?",
    [imageUrl, id]
  );
};

