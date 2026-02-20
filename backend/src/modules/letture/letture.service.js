const db = require("../../config/db");
const { v4: uuid } = require("uuid");

/* ------------------ Helpers ------------------ */

function assertUUID(id, name) {
  if (!id || typeof id !== "string" || id.length !== 36) {
    throw new Error(`${name} must be a valid UUID`);
  }
}

function assertMonth(m) {
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error("periodMonth must be between 1 and 12");
  }
}

function assertYear(y) {
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    throw new Error("periodYear not valid");
  }
}

function assertDateStr(s, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`${name} must be YYYY-MM-DD`);
  }
}

function getMonthBounds(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const toISO = (d) => d.toISOString().slice(0, 10);
  return { start: toISO(start), end: toISO(end) };
}

/* ------------------ Create or Load Session ------------------ */

exports.createOrLoadSession = async function ({
  idCondominio,
  periodYear,
  periodMonth,
  dataOperatore,
  dataCasaIdrica,
  note = null,
}) {
  assertUUID(idCondominio, "idCondominio");
  assertYear(Number(periodYear));
  assertMonth(Number(periodMonth));
 

  if (dataCasaIdrica) {
    assertDateStr(dataCasaIdrica, "dataCasaIdrica");
  }

  if (dataOperatore) {
       assertDateStr(dataOperatore, "dataOperatore");
    }
  const conn = await db.getConnection();

  try {
    const [rows] = await conn.query(
      `
      SELECT 
        id,
        id_condominio,
        period_year,
        period_month,
        data_lettura_operatore   AS data_lettura_operatore,
        data_lettura_casa_idrica AS data_lettura_casa_idrica,
        note,
        stato,
        created_at
      FROM letture_sessioni
      WHERE id_condominio = ?
        AND period_year = ?
        AND period_month = ?
      LIMIT 1
      `,
      [idCondominio, periodYear, periodMonth]
    );
     
    if (rows.length > 0) {
      const existing = rows[0];

    if (
      dataOperatore !== undefined ||
      dataCasaIdrica !== undefined
    ) {
      await conn.query(`
        UPDATE letture_sessioni
        SET
          data_lettura_operatore =
            COALESCE(?, data_lettura_operatore),
          data_lettura_casa_idrica =
            COALESCE(?, data_lettura_casa_idrica)
        WHERE id = ?
      `, [
        dataOperatore ?? null,
        dataCasaIdrica ?? null,
        existing.id
      ]);


        const [updatedRows] = await conn.query(
          `
          SELECT 
            id,
            id_condominio,
            period_year,
            period_month,
            data_lettura_operatore   AS data_lettura_operatore,
            data_lettura_casa_idrica AS data_lettura_casa_idrica,
            note,
            stato,
            created_at
          FROM letture_sessioni
          WHERE id = ?
          `,
          [existing.id]
        );

        return { session: updatedRows[0] };
      }

      return { session: existing };
    }

    const id = uuid();

    await conn.query(
      `
      INSERT INTO letture_sessioni
      (id, id_condominio, period_year, period_month,
       data_lettura_operatore, data_lettura_casa_idrica, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        idCondominio,
        periodYear,
        periodMonth,
        dataOperatore,
        dataCasaIdrica || null,
        note,
      ]
    );

    const [sessionRows] = await conn.query(
      `
      SELECT 
        id,
        id_condominio,
        period_year,
        period_month,
        data_lettura_operatore   AS data_lettura_operatore,
        data_lettura_casa_idrica AS data_lettura_casa_idrica,
        note,
        stato,
        created_at
      FROM letture_sessioni
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );

    return { session: sessionRows[0] };
  } finally {
    conn.release();
  }
};


/* ------------------ Get Grid ------------------ */

exports.getSessionGrid = async function ({ sessionId }) {
  assertUUID(sessionId, "sessionId");

  const conn = await db.getConnection();

  try {
    const [sessionRows] = await conn.query(
      `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
      [sessionId]
    );

    if (sessionRows.length === 0) {
      throw new Error("Session not found");
    }

    const session = sessionRows[0];

    const { start, end } = getMonthBounds(
      session.period_year,
      session.period_month
    );

    const [states] = await conn.query(
      `SELECT codice, descrizione FROM letture_stati ORDER BY codice`
    );

    const [utenze] = await conn.query(
      `
        SELECT *
        FROM utenze_v2
        WHERE  condominio_id = ?
        AND stato = 'ATTIVA'
        AND (data_attivazione IS NULL OR data_attivazione <= ?)
        AND (data_chiusura IS NULL OR data_chiusura >= ?)
        ORDER BY id_user ASC
      `,
      [session.id_condominio, end, start]
    );

    const [righe] = await conn.query(
      `SELECT * FROM letture_righe WHERE id_sessione = ?`,
      [sessionId]
    );

    const righeMap = new Map(
      righe.map((r) => [r.id_utenza, r])
    );

    const utenzaIds = utenze.map((u) => u.id);
    let historyMap = new Map();
    const inList = utenzaIds.map(() => "?").join(",");

    if (utenzaIds.length > 0) {
        const [history] = await conn.query(
        `
        SELECT *
        FROM (
            SELECT
                l.id_utenza,
                l.valore_lettura,
                l.stato_lettura,
                s.period_year,
                s.period_month,
                ROW_NUMBER() OVER (
                    PARTITION BY l.id_utenza
                    ORDER BY s.period_year DESC, s.period_month DESC
                ) AS rn
            FROM letture_righe l
            JOIN letture_sessioni s ON s.id = l.id_sessione
            WHERE l.id_utenza IN (${inList})
                AND (
                    s.period_year < ?
                    OR (s.period_year = ? AND s.period_month < ?)
                )
        ) t
        WHERE t.rn <= 4
        ORDER BY t.id_utenza, t.period_year DESC, t.period_month DESC
        `,
        [
            ...utenzaIds,
            session.period_year,
            session.period_year,
            session.period_month,
        ]
        );

      for (const row of history) {
        if (!historyMap.has(row.id_utenza)) {
          historyMap.set(row.id_utenza, []);
        }
        const arr = historyMap.get(row.id_utenza);
        if (arr.length < 4) arr.push(row);
      }
    }

    const grid = utenze.map((u) => ({
      utenza: u,
      current: righeMap.get(u.id)
        ? {
            valore: righeMap.get(u.id).valore_lettura,
            stato: righeMap.get(u.id).stato_lettura,
          }
        : { valore: null, stato: "C" },
      history: historyMap.get(u.id) || [],
    }));

    return { session, states, grid };
  } finally {
    conn.release();
  }
};

/* ------------------ Bulk Save ------------------ */

exports.upsertSessionRowsBulk = async function ({
  sessionId,
  rows,
}) {
  assertUUID(sessionId, "sessionId");
  if (!Array.isArray(rows))
    throw new Error("rows must be an array");

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [sessionRows] = await conn.query(
      `SELECT stato FROM letture_sessioni WHERE id = ? FOR UPDATE`,
      [sessionId]
    );

    if (sessionRows.length === 0)
      throw new Error("Session not found");

    const session = sessionRows[0];

    if (session.stato === "CHIUSA")
      throw new Error("Session is closed");

    const [stati] = await conn.query(
      `SELECT codice, richiede_valore FROM letture_stati`
    );

    const reqMap = new Map(
      stati.map((s) => [s.codice, !!s.richiede_valore])
    );

    for (const r of rows) {
      assertUUID(r.idUtenza, "idUtenza");

      const stato = (r.stato || "").toUpperCase();

      if (!reqMap.has(stato)) {
        throw new Error(`Invalid stato: ${stato}`);
      }

      const requiresValue = reqMap.get(stato);

      const valore =
        r.valore === null || r.valore === ""
          ? null
          : Number(r.valore);

      if (requiresValue && (valore === null || isNaN(valore))) {
        throw new Error(
          `Valore required for stato ${stato}`
        );
      }

      await conn.query(
        `
        INSERT INTO letture_righe
        (id, id_sessione, id_utenza, valore_lettura, stato_lettura)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          valore_lettura = VALUES(valore_lettura),
          stato_lettura = VALUES(stato_lettura),
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          uuid(),
          sessionId,
          r.idUtenza,
          valore,
          stato,
        ]
      );
    }

    await conn.commit();
    return { ok: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

/* ------------------ Close Session ------------------ */

exports.closeSession = async function ({ sessionId }) {
  assertUUID(sessionId, "sessionId");

  const conn = await db.getConnection();

  try {
    const [result] = await conn.query(
      `
      UPDATE letture_sessioni
      SET stato = 'CHIUSA'
      WHERE id = ? AND stato = 'BOZZA'
      `,
      [sessionId]
    );

    return {
      ok: true,
      affectedRows: result.affectedRows,
    };
  } finally {
    conn.release();
  }
};
