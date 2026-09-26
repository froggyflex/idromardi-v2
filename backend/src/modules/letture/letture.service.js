const db = require("../../config/db");
const { v4: uuid } = require("uuid");
const {
  followsPreviousExceptionalState,
  resolveReadingValue,
} = require("./reading-policy");

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

function httpError(statusCode, message, code, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

async function tableExists(conn, tableName) {
  const [rows] = await conn.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function loadBillingDependencies(conn, sessionId) {
  const [billingRows] = await conn.query(
    `SELECT id, stato
     FROM fatture_sessioni
     WHERE id_periodo_attuale = ? OR id_periodo_precedente = ?
     ORDER BY created_at DESC
     FOR UPDATE`,
    [sessionId, sessionId]
  );
  const [advanceRows] = await conn.query(
    `SELECT id
     FROM fatture_acconti
     WHERE id_periodo_storno = ?
     FOR UPDATE`,
    [sessionId]
  );
  return {
    billingSessions: billingRows,
    advances: advanceRows.length,
  };
}

async function loadMobileDependencies(conn, sessionId) {
  if (!(await tableExists(conn, "mobile_reading_assignments"))) {
    return { assignments: 0, submissions: 0 };
  }

  const [[assignmentRow]] = await conn.query(
    `SELECT COUNT(*) AS total FROM mobile_reading_assignments WHERE session_id = ?`,
    [sessionId]
  );
  let submissions = 0;
  if (await tableExists(conn, "mobile_reading_submissions")) {
    const [[submissionRow]] = await conn.query(
      `SELECT COUNT(*) AS total FROM mobile_reading_submissions WHERE session_id = ?`,
      [sessionId]
    );
    submissions = Number(submissionRow?.total || 0);
  }
  return {
    assignments: Number(assignmentRow?.total || 0),
    submissions,
  };
}

async function loadMobileReadingDependencies(conn, sessionId, idUtenza) {
  if (!(await tableExists(conn, "mobile_reading_submissions"))) return 0;
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS total
     FROM mobile_reading_submissions
     WHERE session_id = ? AND utenza_id = ?`,
    [sessionId, idUtenza]
  );
  return Number(row?.total || 0);
}

function assertNoBillingDependencies(dependencies, actionLabel) {
  if (dependencies.billingSessions.length || dependencies.advances) {
    throw httpError(
      409,
      `Impossibile ${actionLabel}: il periodo è già collegato alla fatturazione. Annulla prima le fatture e gli acconti collegati.`,
      "READING_PERIOD_IN_USE",
      dependencies
    );
  }
}

async function loadPreviousReading(conn, session, idUtenza) {
  const [rows] = await conn.query(
    `SELECT r.valore_lettura
     FROM letture_righe r
     JOIN letture_sessioni previous_session ON previous_session.id = r.id_sessione
     WHERE r.id_utenza = ?
       AND previous_session.id_condominio = ?
       AND (
         previous_session.period_year < ?
         OR (previous_session.period_year = ? AND previous_session.period_month < ?)
       )
       AND r.valore_lettura IS NOT NULL
     ORDER BY previous_session.period_year DESC, previous_session.period_month DESC
     LIMIT 1`,
    [
      idUtenza,
      session.id_condominio,
      session.period_year,
      session.period_year,
      session.period_month,
    ]
  );
  return rows[0]?.valore_lettura ?? null;
}

function calculateReadingConsumption(currentValue, previousValue, state, inverse = false) {
  if (
    currentValue === null ||
    currentValue === undefined ||
    previousValue === null ||
    previousValue === undefined
  ) {
    return null;
  }

  const current = Number(currentValue);
  const previous = Number(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;

  const normalizedState = String(state || "").trim().toUpperCase();

  if (inverse) {
    if (normalizedState === "S") return Math.max(0, current);
    return previous >= current ? previous - current : 0;
  }

  if (current < previous) {
    return normalizedState === "S"
      ? Math.max(0, current)
      : 0;
  }

  return current - previous;
}

exports.listSessionsByCondominio = async function ({ idCondominio }) {
  assertUUID(idCondominio, "idCondominio");

  const [rows] = await db.query(
    `
    SELECT
      s.id,
      s.period_year,
      s.period_month,
      s.data_lettura_operatore,
      s.data_lettura_casa_idrica,
      s.stato,
      s.created_at,
      s.updated_at,
      COALESCE(r.registered_rows, 0) AS registered_rows,
      COALESCE(r.registered_values, 0) AS registered_values,
      r.last_reading_update
    FROM letture_sessioni s
    LEFT JOIN (
      SELECT
        id_sessione,
        COUNT(*) AS registered_rows,
        SUM(CASE WHEN valore_lettura IS NOT NULL THEN 1 ELSE 0 END) AS registered_values,
        MAX(COALESCE(updated_at, created_at)) AS last_reading_update
      FROM letture_righe
      GROUP BY id_sessione
    ) r ON r.id_sessione = s.id
    WHERE s.id_condominio = ?
    ORDER BY s.period_year DESC, s.period_month DESC
    `,
    [idCondominio]
  );

  return { items: rows };
};

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

    const [righe] = await conn.query(
      `SELECT * FROM letture_righe WHERE id_sessione = ?`,
      [sessionId]
    );

    const righeMap = new Map(
      righe.map((r) => [r.id_utenza, r])
    );

    const utenzaIds = utenze.map((u) => u.id);
    const utenzeMap = new Map(utenze.map((utenza) => [utenza.id, utenza]));
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
                s.data_lettura_operatore,
                s.data_lettura_casa_idrica,
                (
                  SELECT fr.consumo_totale
                  FROM fatture_sessioni fs
                  JOIN fatture_righe fr ON fr.id_fattura = fs.id
                  WHERE fs.id_periodo_attuale = s.id
                    AND fr.id_utenza = l.id_utenza
                  ORDER BY fs.updated_at DESC, fs.created_at DESC
                  LIMIT 1
                ) AS consumo_fatturato,
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
        WHERE t.rn <= 5
        ORDER BY t.id_utenza, t.period_year DESC, t.period_month DESC
        `,
        [
            ...utenzaIds,
            session.period_year,
            session.period_year,
            session.period_month,
        ]
        );

      const rawHistoryMap = new Map();

      for (const row of history) {
        if (!historyMap.has(row.id_utenza)) {
          historyMap.set(row.id_utenza, []);
        }

        if (!rawHistoryMap.has(row.id_utenza)) {
          rawHistoryMap.set(row.id_utenza, []);
        }

        rawHistoryMap.get(row.id_utenza).push(row);
      }

      for (const [idUtenza, rows] of rawHistoryMap.entries()) {
        const displayRows = historyMap.get(idUtenza);

        for (let i = 0; i < Math.min(4, rows.length); i++) {
          const row = rows[i];
          const previousRow = rows[i + 1] || null;
          const invoicedConsumption =
            row.consumo_fatturato === null || row.consumo_fatturato === undefined
              ? null
              : Number(row.consumo_fatturato);

          const calculatedConsumption = previousRow
            ? calculateReadingConsumption(
                row.valore_lettura,
                previousRow.valore_lettura,
                row.stato_lettura,
                String(utenzeMap.get(idUtenza)?.Contatore_Inverso || "")
                  .trim()
                  .toUpperCase() === "SI"
              )
            : null;

          const hasInvoicedConsumption =
            invoicedConsumption !== null && Number.isFinite(invoicedConsumption);

          displayRows.push({
            ...row,
            consumo_calcolato:
              calculatedConsumption !== null && Number.isFinite(calculatedConsumption)
                ? calculatedConsumption
                : null,
            consumo_storico: hasInvoicedConsumption
              ? invoicedConsumption
              : calculatedConsumption,
            consumo_source: hasInvoicedConsumption
              ? "fatturato"
              : calculatedConsumption !== null
              ? "calcolato"
              : null,
          });
        }
      }
    }

    const grid = utenze.map((u) => {
      const currentRow = righeMap.get(u.id);
      const historyRows = historyMap.get(u.id) || [];
      const latestPreviousState = String(historyRows[0]?.stato_lettura || "").trim().toUpperCase();
      const defaultState = followsPreviousExceptionalState(latestPreviousState)
        ? latestPreviousState
        : "C";

      return {
        utenza: u,
        current: currentRow
          ? {
              valore: currentRow.valore_lettura,
              stato: currentRow.stato_lettura,
              persisted: true,
            }
          : {
              valore:
                defaultState === "B"
                  ? historyRows[0]?.valore_lettura ?? null
                  : null,
              stato: defaultState,
              persisted: false,
            },
        history: historyRows,
      };
    });
      console.log( "Grid data:",  utenze);
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
      `SELECT stato, id_condominio, period_year, period_month
       FROM letture_sessioni WHERE id = ? FOR UPDATE`,
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

      const previousValue = stato === "B"
        ? await loadPreviousReading(conn, session, r.idUtenza)
        : null;
      const valore = resolveReadingValue({
        state: stato,
        submittedValue: r.valore,
        previousValue,
      });

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

/* ------------------ Safe cancellation ------------------ */

exports.cancelReading = async function ({ sessionId, idUtenza }) {
  assertUUID(sessionId, "sessionId");
  assertUUID(idUtenza, "idUtenza");
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();
    const [sessions] = await conn.query(
      `SELECT id FROM letture_sessioni WHERE id = ? LIMIT 1 FOR UPDATE`,
      [sessionId]
    );
    if (!sessions.length) {
      throw httpError(404, "Periodo letture non trovato.", "READING_PERIOD_NOT_FOUND");
    }

    const dependencies = await loadBillingDependencies(conn, sessionId);
    assertNoBillingDependencies(dependencies, "annullare la lettura");
    const mobileSubmissions = await loadMobileReadingDependencies(
      conn,
      sessionId,
      idUtenza
    );
    if (mobileSubmissions) {
      throw httpError(
        409,
        "Impossibile annullare la lettura: esiste un invio mobile collegato. Gestisci prima l'invio dalla coda di revisione.",
        "READING_HAS_MOBILE_SUBMISSION",
        { mobileSubmissions }
      );
    }

    const [result] = await conn.query(
      `DELETE FROM letture_righe WHERE id_sessione = ? AND id_utenza = ?`,
      [sessionId, idUtenza]
    );
    await conn.query(
      `UPDATE letture_sessioni SET stato = 'BOZZA' WHERE id = ?`,
      [sessionId]
    );
    await conn.commit();
    return { ok: true, deletedRows: result.affectedRows, sessionStatus: "BOZZA" };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

exports.cancelSession = async function ({ sessionId }) {
  assertUUID(sessionId, "sessionId");
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();
    const [sessions] = await conn.query(
      `SELECT id FROM letture_sessioni WHERE id = ? LIMIT 1 FOR UPDATE`,
      [sessionId]
    );
    if (!sessions.length) {
      throw httpError(404, "Periodo letture non trovato.", "READING_PERIOD_NOT_FOUND");
    }

    const billing = await loadBillingDependencies(conn, sessionId);
    assertNoBillingDependencies(billing, "annullare il periodo");
    const mobile = await loadMobileDependencies(conn, sessionId);
    if (mobile.submissions) {
      throw httpError(
        409,
        "Impossibile annullare il periodo: esistono giri mobile o invii collegati. Annulla prima il lavoro mobile associato.",
        "READING_PERIOD_HAS_MOBILE_WORK",
        mobile
      );
    }
    if (mobile.assignments) {
      await conn.query(
        `DELETE FROM mobile_reading_assignments WHERE session_id = ?`,
        [sessionId]
      );
    }

    const [[readingCount]] = await conn.query(
      `SELECT COUNT(*) AS total FROM letture_righe WHERE id_sessione = ?`,
      [sessionId]
    );
    await conn.query(`DELETE FROM letture_sessioni WHERE id = ?`, [sessionId]);
    await conn.commit();
    return { ok: true, deletedRows: Number(readingCount?.total || 0) };
  } catch (error) {
    await conn.rollback();
    throw error;
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
