const crypto = require("crypto");
const db = require("../../config/db");
const { getReadingPhoto, saveReadingPhoto } = require("../../utils/readingPhotos");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINAL_SUBMISSION_STATUSES = new Set(["ACCEPTED", "REJECTED"]);

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function assertUuid(value, name) {
  if (!UUID_PATTERN.test(String(value || ""))) {
    throw httpError(400, `${name} non valido`, "INVALID_UUID");
  }
  return String(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mysqlDateTime(value, name) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw httpError(400, `${name} non valida`, "INVALID_DATE");
  }
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function monthBounds(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end };
}

function actorRole(actor) {
  return String(actor?.role || (actor?.username === "admin" ? "ADMIN" : "")).toUpperCase();
}

function canAccessOperatorData(actor, operatorId) {
  return (
    new Set(["ADMIN", "REVIEWER"]).has(actorRole(actor)) ||
    String(actor?.sub) === String(operatorId)
  );
}

function criticalContext({ sessionId, condominioId, utenzaId, meterSerial }) {
  return sha256(
    stableStringify({
      sessionId,
      condominioId,
      utenzaId,
      meterSerial: String(meterSerial || "").trim(),
    })
  );
}

function submissionFingerprint(payload) {
  return sha256(
    stableStringify({
      assignmentId: payload.assignmentId,
      utenzaId: payload.utenzaId,
      deviceId: payload.deviceId,
      captureSequence: payload.captureSequence,
      source: payload.source,
      readingValue: payload.readingValue,
      readingState: payload.readingState,
      capturedAt: payload.capturedAt,
      timezoneOffsetMinutes: payload.timezoneOffsetMinutes,
      contextHash: payload.contextHash,
      operatorNote: payload.operatorNote,
      ocrSuggestedValue: payload.ocrSuggestedValue,
      ocrRaw: payload.ocrRaw,
      ocrConfirmed: payload.ocrConfirmed,
      expectedPhotoSha256: payload.expectedPhotoSha256,
    })
  );
}

function normalizeSubmission(input) {
  const source = String(input.source || "").toUpperCase();
  const readingValue = Number(input.readingValue);
  const readingState = String(input.readingState || "").trim().toUpperCase();
  const timezoneOffsetMinutes = Number(input.timezoneOffsetMinutes || 0);
  const captureSequence =
    input.captureSequence === null || input.captureSequence === undefined
      ? null
      : Number(input.captureSequence);
  const ocrSuggestedValue =
    input.ocrSuggestedValue === null || input.ocrSuggestedValue === undefined
      ? null
      : Number(input.ocrSuggestedValue);

  if (!new Set(["MANUAL", "PHOTO"]).has(source)) {
    throw httpError(400, "Sorgente lettura non valida", "INVALID_SOURCE");
  }
  if (!Number.isSafeInteger(readingValue) || readingValue < 0 || readingValue > 4294967295) {
    throw httpError(400, "Valore lettura non valido", "INVALID_READING_VALUE");
  }
  if (!/^[A-Z0-9]$/.test(readingState)) {
    throw httpError(400, "Stato lettura non valido", "INVALID_READING_STATE");
  }
  if (!Number.isInteger(timezoneOffsetMinutes) || Math.abs(timezoneOffsetMinutes) > 840) {
    throw httpError(400, "Fuso orario non valido", "INVALID_TIMEZONE");
  }
  if (captureSequence !== null && (!Number.isSafeInteger(captureSequence) || captureSequence < 0)) {
    throw httpError(400, "Sequenza acquisizione non valida", "INVALID_SEQUENCE");
  }
  if (
    ocrSuggestedValue !== null &&
    (!Number.isSafeInteger(ocrSuggestedValue) || ocrSuggestedValue < 0)
  ) {
    throw httpError(400, "Valore OCR non valido", "INVALID_OCR_VALUE");
  }

  const expectedPhotoSha256 = input.expectedPhotoSha256
    ? String(input.expectedPhotoSha256).toLowerCase()
    : null;
  if (expectedPhotoSha256 && !/^[a-f0-9]{64}$/.test(expectedPhotoSha256)) {
    throw httpError(400, "Checksum foto non valido", "INVALID_PHOTO_HASH");
  }

  return {
    id: assertUuid(input.id, "id submission"),
    assignmentId: assertUuid(input.assignmentId, "assignmentId"),
    utenzaId: assertUuid(input.utenzaId, "utenzaId"),
    deviceId: String(input.deviceId || "").trim().slice(0, 128),
    captureSequence,
    source,
    readingValue,
    readingState,
    capturedAt: mysqlDateTime(input.capturedAt, "Data acquisizione"),
    timezoneOffsetMinutes,
    contextHash: String(input.contextHash || "").toLowerCase(),
    operatorNote: input.operatorNote ? String(input.operatorNote).trim().slice(0, 500) : null,
    ocrSuggestedValue,
    ocrRaw: input.ocrRaw || null,
    ocrConfirmed: Boolean(input.ocrConfirmed),
    expectedPhotoSha256,
  };
}

async function recordEvent(conn, submissionId, eventType, actorId, fromStatus, toStatus, details) {
  await conn.query(
    `INSERT INTO mobile_reading_submission_events
       (submission_id, event_type, actor_id, from_status, to_status, details_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      submissionId,
      eventType,
      actorId || null,
      fromStatus || null,
      toStatus || null,
      details ? JSON.stringify(details) : null,
    ]
  );
}

async function getAssignmentPackage(assignmentId, actor, { markDownloaded = false } = {}) {
  assertUuid(assignmentId, "assignmentId");
  const [assignments] = await db.query(
    `SELECT a.*, s.period_year, s.period_month, s.data_lettura_operatore,
            s.stato AS session_status, c.nome AS condominio_nome,
            c.indirizzo AS condominio_indirizzo
     FROM mobile_reading_assignments a
     JOIN letture_sessioni s ON s.id = a.session_id
     JOIN condomini_v2 c ON c.id = a.condominio_id
     WHERE a.id = ? LIMIT 1`,
    [assignmentId]
  );
  const assignment = assignments[0];
  if (!assignment) throw httpError(404, "Assegnazione non trovata", "ASSIGNMENT_NOT_FOUND");
  if (!canAccessOperatorData(actor, assignment.operator_id)) {
    throw httpError(403, "Assegnazione non autorizzata", "ASSIGNMENT_FORBIDDEN");
  }

  const [items] = await db.query(
    `SELECT assignment_id, utenza_id, position, context_hash,
            meter_serial_snapshot, previous_value, previous_state, snapshot_json
     FROM mobile_reading_assignment_items
     WHERE assignment_id = ? ORDER BY position`,
    [assignmentId]
  );
  const [readingStates] = await db.query(
    `SELECT codice, descrizione, richiede_valore FROM letture_stati ORDER BY codice`
  );

  if (markDownloaded) {
    await db.query(
      `UPDATE mobile_reading_assignments
       SET downloaded_at = COALESCE(downloaded_at, CURRENT_TIMESTAMP(3))
       WHERE id = ?`,
      [assignmentId]
    );
  }

  return {
    assignment,
    items: items.map((item) => ({ ...item, snapshot: parseJson(item.snapshot_json) })),
    readingStates,
  };
}

async function createAssignment({ sessionId, operatorId }, actor) {
  assertUuid(sessionId, "sessionId");
  assertUuid(operatorId, "operatorId");
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();
    const [existing] = await conn.query(
      `SELECT id FROM mobile_reading_assignments
       WHERE session_id = ? AND operator_id = ? LIMIT 1 FOR UPDATE`,
      [sessionId, operatorId]
    );
    if (existing.length) {
      await conn.commit();
      return getAssignmentPackage(existing[0].id, actor);
    }

    const [sessions] = await conn.query(
      `SELECT s.*, c.nome AS condominio_nome, c.indirizzo AS condominio_indirizzo
       FROM letture_sessioni s
       JOIN condomini_v2 c ON c.id = s.id_condominio
       WHERE s.id = ? LIMIT 1 FOR UPDATE`,
      [sessionId]
    );
    const session = sessions[0];
    if (!session) throw httpError(404, "Sessione letture non trovata", "SESSION_NOT_FOUND");
    if (session.stato !== "BOZZA") {
      throw httpError(409, "La sessione letture è chiusa", "SESSION_CLOSED");
    }

    const [operators] = await conn.query(
      `SELECT id, role FROM app_auth_users WHERE id = ? LIMIT 1`,
      [operatorId]
    );
    if (!operators.length || !new Set(["METER_READER", "ADMIN"]).has(operators[0].role)) {
      throw httpError(400, "Operatore mobile non valido", "INVALID_OPERATOR");
    }

    const { start, end } = monthBounds(session.period_year, session.period_month);
    const [utenze] = await conn.query(
      `SELECT u.id, u.id_user, u.Nome, u.Cognome, u.Interno, u.Scala, u.Isolato,
              u.Piano, u.stato,
              COALESCE(p.matricola_contatore, u.Matricola_Contatore, '0000') AS meter_serial,
              (
                SELECT lr.valore_lettura
                FROM letture_righe lr
                JOIN letture_sessioni previous_session ON previous_session.id = lr.id_sessione
                WHERE lr.id_utenza = u.id
                  AND (
                    previous_session.period_year < s.period_year OR
                    (previous_session.period_year = s.period_year AND previous_session.period_month < s.period_month)
                  )
                ORDER BY previous_session.period_year DESC, previous_session.period_month DESC
                LIMIT 1
              ) AS previous_value,
              (
                SELECT lr.stato_lettura
                FROM letture_righe lr
                JOIN letture_sessioni previous_session ON previous_session.id = lr.id_sessione
                WHERE lr.id_utenza = u.id
                  AND (
                    previous_session.period_year < s.period_year OR
                    (previous_session.period_year = s.period_year AND previous_session.period_month < s.period_month)
                  )
                ORDER BY previous_session.period_year DESC, previous_session.period_month DESC
                LIMIT 1
              ) AS previous_state
       FROM utenze_v2 u
       CROSS JOIN letture_sessioni s
       LEFT JOIN utenza_profili_v2 p ON p.utenza_id = u.id AND p.valid_to IS NULL
       WHERE s.id = ?
         AND u.condominio_id = s.id_condominio
         AND (u.stato = 'ATTIVA' OR (u.data_chiusura IS NOT NULL AND u.data_chiusura >= ?))
         AND (u.data_attivazione IS NULL OR u.data_attivazione <= ?)
         AND (u.data_chiusura IS NULL OR u.data_chiusura >= ?)
       ORDER BY u.id_user`,
      [sessionId, start, end, start]
    );
    if (!utenze.length) {
      throw httpError(409, "Nessuna utenza disponibile per la sessione", "NO_ASSIGNMENT_ITEMS");
    }

    const assignmentId = crypto.randomUUID();
    const items = utenze.map((utenza, index) => {
      const snapshot = {
        idUser: utenza.id_user,
        nome: utenza.Nome,
        cognome: utenza.Cognome,
        interno: utenza.Interno,
        scala: utenza.Scala,
        isolato: utenza.Isolato,
        piano: utenza.Piano,
        meterSerial: utenza.meter_serial,
      };
      return {
        position: index + 1,
        utenzaId: utenza.id,
        meterSerial: utenza.meter_serial,
        previousValue: utenza.previous_value,
        previousState: utenza.previous_state,
        snapshot,
        contextHash: criticalContext({
          sessionId,
          condominioId: session.id_condominio,
          utenzaId: utenza.id,
          meterSerial: utenza.meter_serial,
        }),
      };
    });
    const contextVersion = sha256(
      stableStringify(items.map(({ utenzaId, contextHash, position }) => ({ utenzaId, contextHash, position })))
    );

    await conn.query(
      `INSERT INTO mobile_reading_assignments
         (id, session_id, condominio_id, operator_id, created_by, context_version)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [assignmentId, sessionId, session.id_condominio, operatorId, actor.sub, contextVersion]
    );
    for (const item of items) {
      await conn.query(
        `INSERT INTO mobile_reading_assignment_items
           (assignment_id, utenza_id, position, context_hash, meter_serial_snapshot,
            previous_value, previous_state, snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assignmentId,
          item.utenzaId,
          item.position,
          item.contextHash,
          item.meterSerial,
          item.previousValue,
          item.previousState,
          JSON.stringify(item.snapshot),
        ]
      );
    }

    await conn.commit();
    return getAssignmentPackage(assignmentId, actor);
  } catch (error) {
    await conn.rollback();
    if (error?.code === "ER_DUP_ENTRY") {
      const [existing] = await db.query(
        `SELECT id FROM mobile_reading_assignments
         WHERE session_id = ? AND operator_id = ? LIMIT 1`,
        [sessionId, operatorId]
      );
      if (existing.length) return getAssignmentPackage(existing[0].id, actor);
    }
    throw error;
  } finally {
    conn.release();
  }
}

async function listAssignments(actor) {
  const role = actorRole(actor);
  const params = [];
  const operatorFilter = role === "ADMIN" ? "" : "WHERE a.operator_id = ?";
  if (operatorFilter) params.push(actor.sub);
  const [rows] = await db.query(
    `SELECT a.*, s.period_year, s.period_month, s.data_lettura_operatore,
            c.nome AS condominio_nome, c.indirizzo AS condominio_indirizzo,
            COUNT(DISTINCT i.utenza_id) AS item_count,
            COUNT(DISTINCT CASE WHEN ms.workflow_status = 'ACCEPTED' THEN i.utenza_id END) AS accepted_count
     FROM mobile_reading_assignments a
     JOIN letture_sessioni s ON s.id = a.session_id
     JOIN condomini_v2 c ON c.id = a.condominio_id
     LEFT JOIN mobile_reading_assignment_items i ON i.assignment_id = a.id
     LEFT JOIN mobile_reading_submissions ms
       ON ms.assignment_id = a.id AND ms.utenza_id = i.utenza_id
     ${operatorFilter}
     GROUP BY a.id
     ORDER BY a.created_at DESC`,
    params
  );
  return { assignments: rows };
}

async function createSubmission(input, actor) {
  const payload = normalizeSubmission(input);
  if (!payload.deviceId) throw httpError(400, "deviceId obbligatorio", "DEVICE_REQUIRED");
  if (!/^[a-f0-9]{64}$/.test(payload.contextHash)) {
    throw httpError(400, "Context hash non valido", "INVALID_CONTEXT_HASH");
  }
  if (payload.source === "PHOTO" && !payload.ocrConfirmed) {
    throw httpError(400, "Il valore OCR deve essere confermato", "OCR_CONFIRMATION_REQUIRED");
  }

  const payloadHash = submissionFingerprint(payload);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [existingRows] = await conn.query(
      `SELECT * FROM mobile_reading_submissions WHERE id = ? LIMIT 1 FOR UPDATE`,
      [payload.id]
    );
    if (existingRows.length) {
      const existing = existingRows[0];
      if (!canAccessOperatorData(actor, existing.operator_id)) {
        throw httpError(403, "Submission non autorizzata", "SUBMISSION_FORBIDDEN");
      }
      if (existing.payload_hash !== payloadHash) {
        throw httpError(
          409,
          "Lo stesso submission ID è stato riutilizzato con dati differenti",
          "SUBMISSION_MISMATCH"
        );
      }
      await conn.commit();
      return { submission: existing, idempotentReplay: true };
    }

    const [contexts] = await conn.query(
      `SELECT a.session_id, a.condominio_id, a.operator_id, a.status AS assignment_status,
              i.context_hash, s.stato AS session_status
       FROM mobile_reading_assignments a
       JOIN mobile_reading_assignment_items i
         ON i.assignment_id = a.id AND i.utenza_id = ?
       JOIN letture_sessioni s ON s.id = a.session_id
       WHERE a.id = ? LIMIT 1 FOR UPDATE`,
      [payload.utenzaId, payload.assignmentId]
    );
    const context = contexts[0];
    if (!context) throw httpError(404, "Contesto assegnazione non trovato", "CONTEXT_NOT_FOUND");
    if (!canAccessOperatorData(actor, context.operator_id)) {
      throw httpError(403, "Assegnazione non autorizzata", "ASSIGNMENT_FORBIDDEN");
    }
    if (context.assignment_status === "CANCELLED") {
      throw httpError(409, "Assegnazione annullata", "ASSIGNMENT_CANCELLED");
    }

    const [readingStates] = await conn.query(
      `SELECT codice FROM letture_stati WHERE codice = ? LIMIT 1`,
      [payload.readingState]
    );
    if (!readingStates.length) {
      throw httpError(400, "Stato lettura non riconosciuto", "INVALID_READING_STATE");
    }

    let workflowStatus = payload.source === "PHOTO" ? "UPLOAD_INCOMPLETE" : "TO_BE_ACCEPTED";
    let conflictReason = null;
    if (context.session_status !== "BOZZA") {
      workflowStatus = "CONTEXT_CONFLICT";
      conflictReason = "La sessione letture è stata chiusa prima della sincronizzazione";
    } else if (context.assignment_status === "COMPLETED") {
      workflowStatus = "CONTEXT_CONFLICT";
      conflictReason = "L'assegnazione risulta già completata";
    } else if (context.context_hash !== payload.contextHash) {
      workflowStatus = "CONTEXT_CONFLICT";
      conflictReason = "Il contesto del contatore non corrisponde all'assegnazione scaricata";
    }

    const [otherSubmissions] = await conn.query(
      `SELECT id FROM mobile_reading_submissions
       WHERE assignment_id = ? AND utenza_id = ?
         AND workflow_status NOT IN ('REJECTED')
       LIMIT 1`,
      [payload.assignmentId, payload.utenzaId]
    );
    if (otherSubmissions.length) {
      workflowStatus = "CONTEXT_CONFLICT";
      conflictReason = `Esiste già una submission per questa utenza: ${otherSubmissions[0].id}`;
    }

    await conn.query(
      `INSERT INTO mobile_reading_submissions
       (id, assignment_id, session_id, condominio_id, utenza_id, operator_id,
        device_id, capture_sequence, source, reading_value, reading_state,
        captured_at, timezone_offset_minutes, context_hash, payload_hash,
        operator_note, ocr_suggested_value, ocr_raw_json, ocr_confirmed,
        photo_sha256, workflow_status, conflict_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.id,
        payload.assignmentId,
        context.session_id,
        context.condominio_id,
        payload.utenzaId,
        context.operator_id,
        payload.deviceId,
        payload.captureSequence,
        payload.source,
        payload.readingValue,
        payload.readingState,
        payload.capturedAt,
        payload.timezoneOffsetMinutes,
        payload.contextHash,
        payloadHash,
        payload.operatorNote,
        payload.ocrSuggestedValue,
        payload.ocrRaw ? JSON.stringify(payload.ocrRaw) : null,
        payload.ocrConfirmed ? 1 : 0,
        payload.expectedPhotoSha256,
        workflowStatus,
        conflictReason,
      ]
    );
    await recordEvent(
      conn,
      payload.id,
      "SUBMITTED",
      actor.sub,
      null,
      workflowStatus,
      { payloadHash }
    );
    await conn.query(
      `UPDATE mobile_reading_assignments
       SET status = CASE WHEN status = 'READY' THEN 'IN_PROGRESS' ELSE status END
       WHERE id = ?`,
      [payload.assignmentId]
    );
    await conn.commit();

    const [created] = await db.query(
      `SELECT * FROM mobile_reading_submissions WHERE id = ? LIMIT 1`,
      [payload.id]
    );
    return { submission: created[0], idempotentReplay: false };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function attachPhoto({ submissionId, buffer, mimeType, expectedSha256 }, actor) {
  assertUuid(submissionId, "submissionId");
  if (!buffer?.length) throw httpError(400, "Foto mancante", "PHOTO_REQUIRED");
  const actualSha256 = sha256(buffer);
  if (expectedSha256 && String(expectedSha256).toLowerCase() !== actualSha256) {
    throw httpError(422, "Checksum foto non corrispondente", "PHOTO_HASH_MISMATCH");
  }

  const [rows] = await db.query(
    `SELECT * FROM mobile_reading_submissions WHERE id = ? LIMIT 1`,
    [submissionId]
  );
  const submission = rows[0];
  if (!submission) throw httpError(404, "Submission non trovata", "SUBMISSION_NOT_FOUND");
  if (!canAccessOperatorData(actor, submission.operator_id)) {
    throw httpError(403, "Submission non autorizzata", "SUBMISSION_FORBIDDEN");
  }
  if (submission.source !== "PHOTO") {
    throw httpError(409, "La submission non richiede una foto", "PHOTO_NOT_EXPECTED");
  }
  if (FINAL_SUBMISSION_STATUSES.has(submission.workflow_status)) {
    throw httpError(409, "Submission già finalizzata", "SUBMISSION_FINALIZED");
  }
  if (submission.photo_object_key) {
    if (submission.photo_sha256 !== actualSha256) {
      throw httpError(409, "Una foto differente è già associata", "PHOTO_ALREADY_EXISTS");
    }
    return { submission, idempotentReplay: true };
  }
  if (submission.photo_sha256 && submission.photo_sha256 !== actualSha256) {
    throw httpError(422, "La foto non corrisponde al checksum dichiarato", "PHOTO_HASH_MISMATCH");
  }

  const objectKey = await saveReadingPhoto({
    submissionId,
    buffer,
    mimeType,
    sha256: actualSha256,
  });
  const nextStatus =
    submission.workflow_status === "CONTEXT_CONFLICT" ? "CONTEXT_CONFLICT" : "TO_BE_ACCEPTED";
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [lockedRows] = await conn.query(
      `SELECT * FROM mobile_reading_submissions WHERE id = ? LIMIT 1 FOR UPDATE`,
      [submissionId]
    );
    const locked = lockedRows[0];
    if (locked.photo_object_key) {
      if (locked.photo_sha256 !== actualSha256) {
        throw httpError(409, "Una foto differente è già associata", "PHOTO_ALREADY_EXISTS");
      }
      await conn.commit();
      return { submission: locked, idempotentReplay: true };
    }
    await conn.query(
      `UPDATE mobile_reading_submissions
       SET photo_object_key = ?, photo_sha256 = ?, photo_mime_type = ?,
           photo_size_bytes = ?, workflow_status = ?, version = version + 1
       WHERE id = ?`,
      [objectKey, actualSha256, mimeType, buffer.length, nextStatus, submissionId]
    );
    await recordEvent(
      conn,
      submissionId,
      "PHOTO_UPLOADED",
      actor.sub,
      locked.workflow_status,
      nextStatus,
      { sha256: actualSha256, size: buffer.length }
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  const [updated] = await db.query(
    `SELECT * FROM mobile_reading_submissions WHERE id = ? LIMIT 1`,
    [submissionId]
  );
  return { submission: updated[0], idempotentReplay: false };
}

async function reconcileSubmissionStatuses(ids, actor) {
  const normalizedIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => assertUuid(id, "id")))];
  if (!normalizedIds.length) return { submissions: [] };
  if (normalizedIds.length > 100) {
    throw httpError(400, "Massimo 100 submission per richiesta", "TOO_MANY_IDS");
  }
  const placeholders = normalizedIds.map(() => "?").join(",");
  const params = [...normalizedIds];
  const filter = actorRole(actor) === "ADMIN" ? "" : "AND operator_id = ?";
  if (filter) params.push(actor.sub);
  const [rows] = await db.query(
    `SELECT id, workflow_status, conflict_reason, accepted_reading_id,
            version, updated_at, photo_sha256
     FROM mobile_reading_submissions
     WHERE id IN (${placeholders}) ${filter}`,
    params
  );
  return { submissions: rows };
}

async function listReviewQueue({ status = "TO_BE_ACCEPTED", limit = 100 } = {}) {
  const allowedStatuses = new Set([
    "UPLOAD_INCOMPLETE",
    "TO_BE_ACCEPTED",
    "ACCEPTED",
    "REJECTED",
    "CONTEXT_CONFLICT",
  ]);
  const normalizedStatus = String(status).toUpperCase();
  if (!allowedStatuses.has(normalizedStatus)) {
    throw httpError(400, "Stato revisione non valido", "INVALID_REVIEW_STATUS");
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);
  const [rows] = await db.query(
    `SELECT ms.*, a.context_version, s.period_year, s.period_month, s.stato AS session_status,
            c.nome AS condominio_nome, c.indirizzo AS condominio_indirizzo,
            u.id_user, u.Nome, u.Cognome, u.Interno, u.Scala, u.Isolato, u.Piano,
            ai.meter_serial_snapshot, ai.previous_value, ai.previous_state,
            operator.username AS operator_username,
            reviewer.username AS reviewer_username
     FROM mobile_reading_submissions ms
     JOIN mobile_reading_assignments a ON a.id = ms.assignment_id
     JOIN mobile_reading_assignment_items ai
       ON ai.assignment_id = ms.assignment_id AND ai.utenza_id = ms.utenza_id
     JOIN letture_sessioni s ON s.id = ms.session_id
     JOIN condomini_v2 c ON c.id = ms.condominio_id
     JOIN utenze_v2 u ON u.id = ms.utenza_id
     JOIN app_auth_users operator ON operator.id = ms.operator_id
     LEFT JOIN app_auth_users reviewer ON reviewer.id = ms.reviewed_by
     WHERE ms.workflow_status = ?
     ORDER BY ms.received_at ASC
     LIMIT ?`,
    [normalizedStatus, safeLimit]
  );
  return { submissions: rows };
}

async function acceptSubmission({ submissionId, replaceExisting = false, reviewNote = null }, actor) {
  assertUuid(submissionId, "submissionId");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT ms.*, s.stato AS session_status, u.condominio_id AS current_condominio_id,
              COALESCE(p.matricola_contatore, u.Matricola_Contatore, '0000') AS current_meter_serial
       FROM mobile_reading_submissions ms
       JOIN letture_sessioni s ON s.id = ms.session_id
       JOIN utenze_v2 u ON u.id = ms.utenza_id
       LEFT JOIN utenza_profili_v2 p ON p.utenza_id = u.id AND p.valid_to IS NULL
       WHERE ms.id = ? LIMIT 1 FOR UPDATE`,
      [submissionId]
    );
    const submission = rows[0];
    if (!submission) throw httpError(404, "Submission non trovata", "SUBMISSION_NOT_FOUND");
    if (submission.workflow_status === "ACCEPTED") {
      await conn.commit();
      return { submission, idempotentReplay: true };
    }
    if (submission.workflow_status !== "TO_BE_ACCEPTED") {
      throw httpError(409, "Submission non accettabile nello stato corrente", "INVALID_TRANSITION");
    }
    if (submission.session_status !== "BOZZA") {
      await conn.query(
        `UPDATE mobile_reading_submissions
         SET workflow_status = 'CONTEXT_CONFLICT', conflict_reason = ?, version = version + 1
         WHERE id = ?`,
        ["La sessione letture è chiusa", submissionId]
      );
      await recordEvent(
        conn,
        submissionId,
        "CONTEXT_INVALIDATED",
        actor.sub,
        "TO_BE_ACCEPTED",
        "CONTEXT_CONFLICT",
        { reason: "SESSION_CLOSED" }
      );
      await conn.commit();
      throw httpError(409, "La sessione letture è chiusa", "SESSION_CLOSED");
    }

    const currentContextHash = criticalContext({
      sessionId: submission.session_id,
      condominioId: submission.current_condominio_id,
      utenzaId: submission.utenza_id,
      meterSerial: submission.current_meter_serial,
    });
    if (
      submission.current_condominio_id !== submission.condominio_id ||
      currentContextHash !== submission.context_hash
    ) {
      await conn.query(
        `UPDATE mobile_reading_submissions
         SET workflow_status = 'CONTEXT_CONFLICT', conflict_reason = ?, version = version + 1
         WHERE id = ?`,
        ["Associazione o matricola contatore modificata dopo il download", submissionId]
      );
      await recordEvent(
        conn,
        submissionId,
        "CONTEXT_INVALIDATED",
        actor.sub,
        "TO_BE_ACCEPTED",
        "CONTEXT_CONFLICT",
        { reason: "METER_CONTEXT_CHANGED" }
      );
      await conn.commit();
      throw httpError(409, "Il contesto del contatore è cambiato", "CONTEXT_CHANGED");
    }
    if (submission.source === "PHOTO" && !submission.photo_object_key) {
      throw httpError(409, "Foto non ancora caricata", "PHOTO_INCOMPLETE");
    }

    const [existingReadings] = await conn.query(
      `SELECT * FROM letture_righe
       WHERE id_sessione = ? AND id_utenza = ? LIMIT 1 FOR UPDATE`,
      [submission.session_id, submission.utenza_id]
    );
    let readingId;
    let replacementDetails = null;
    if (existingReadings.length) {
      const existing = existingReadings[0];
      if (!replaceExisting) {
        throw httpError(
          409,
          "Esiste già una lettura. È richiesta la conferma esplicita di sostituzione",
          "READING_ALREADY_EXISTS"
        );
      }
      readingId = existing.id;
      replacementDetails = {
        previousValue: existing.valore_lettura,
        previousState: existing.stato_lettura,
      };
      await conn.query(
        `UPDATE letture_righe
         SET valore_lettura = ?, stato_lettura = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [submission.reading_value, submission.reading_state, readingId]
      );
    } else {
      readingId = crypto.randomUUID();
      await conn.query(
        `INSERT INTO letture_righe
           (id, id_sessione, id_utenza, valore_lettura, stato_lettura)
         VALUES (?, ?, ?, ?, ?)`,
        [
          readingId,
          submission.session_id,
          submission.utenza_id,
          submission.reading_value,
          submission.reading_state,
        ]
      );
    }

    await conn.query(
      `UPDATE mobile_reading_submissions
       SET workflow_status = 'ACCEPTED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3),
           review_note = ?, accepted_reading_id = ?, version = version + 1
       WHERE id = ?`,
      [actor.sub, reviewNote ? String(reviewNote).slice(0, 500) : null, readingId, submissionId]
    );
    await recordEvent(
      conn,
      submissionId,
      replacementDetails ? "ACCEPTED_REPLACING_READING" : "ACCEPTED",
      actor.sub,
      "TO_BE_ACCEPTED",
      "ACCEPTED",
      { readingId, ...replacementDetails }
    );

    const [remaining] = await conn.query(
      `SELECT COUNT(*) AS remaining
       FROM mobile_reading_assignment_items ai
       WHERE ai.assignment_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM mobile_reading_submissions completed
           WHERE completed.assignment_id = ai.assignment_id
             AND completed.utenza_id = ai.utenza_id
             AND completed.workflow_status = 'ACCEPTED'
         )`,
      [submission.assignment_id]
    );
    if (Number(remaining[0]?.remaining || 0) === 0) {
      await conn.query(
        `UPDATE mobile_reading_assignments
         SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [submission.assignment_id]
      );
    }
    await conn.commit();

    const [updated] = await db.query(
      `SELECT * FROM mobile_reading_submissions WHERE id = ? LIMIT 1`,
      [submissionId]
    );
    return { submission: updated[0], idempotentReplay: false };
  } catch (error) {
    await conn.rollback();
    if (error?.code === "ER_DUP_ENTRY") {
      throw httpError(
        409,
        "Una lettura è stata inserita contemporaneamente per la stessa sessione e utenza",
        "READING_ALREADY_EXISTS"
      );
    }
    throw error;
  } finally {
    conn.release();
  }
}

async function rejectSubmission({ submissionId, reviewNote }, actor) {
  assertUuid(submissionId, "submissionId");
  if (!String(reviewNote || "").trim()) {
    throw httpError(400, "Motivo del rifiuto obbligatorio", "REJECTION_REASON_REQUIRED");
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM mobile_reading_submissions WHERE id = ? LIMIT 1 FOR UPDATE`,
      [submissionId]
    );
    const submission = rows[0];
    if (!submission) throw httpError(404, "Submission non trovata", "SUBMISSION_NOT_FOUND");
    if (submission.workflow_status === "REJECTED") {
      await conn.commit();
      return { submission, idempotentReplay: true };
    }
    if (submission.workflow_status === "ACCEPTED") {
      throw httpError(409, "Una lettura accettata non può essere rifiutata", "INVALID_TRANSITION");
    }
    await conn.query(
      `UPDATE mobile_reading_submissions
       SET workflow_status = 'REJECTED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3),
           review_note = ?, version = version + 1
       WHERE id = ?`,
      [actor.sub, String(reviewNote).trim().slice(0, 500), submissionId]
    );
    await recordEvent(
      conn,
      submissionId,
      "REJECTED",
      actor.sub,
      submission.workflow_status,
      "REJECTED",
      { reason: String(reviewNote).trim().slice(0, 500) }
    );
    await conn.commit();
    const [updated] = await db.query(
      `SELECT * FROM mobile_reading_submissions WHERE id = ? LIMIT 1`,
      [submissionId]
    );
    return { submission: updated[0], idempotentReplay: false };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function readSubmissionPhoto(submissionId) {
  assertUuid(submissionId, "submissionId");
  const [rows] = await db.query(
    `SELECT photo_object_key, photo_mime_type FROM mobile_reading_submissions
     WHERE id = ? LIMIT 1`,
    [submissionId]
  );
  if (!rows.length || !rows[0].photo_object_key) {
    throw httpError(404, "Foto non trovata", "PHOTO_NOT_FOUND");
  }
  const photo = await getReadingPhoto(rows[0].photo_object_key);
  return { ...photo, mimeType: rows[0].photo_mime_type || photo.mimeType || "image/jpeg" };
}

module.exports = {
  acceptSubmission,
  attachPhoto,
  createAssignment,
  createSubmission,
  getAssignmentPackage,
  listAssignments,
  listReviewQueue,
  readSubmissionPhoto,
  reconcileSubmissionStatuses,
  rejectSubmission,
};
