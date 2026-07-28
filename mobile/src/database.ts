import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import type {
  AssignmentItem,
  AssignmentPackage,
  AssignmentSummary,
  LocalCapture,
  ReadingState,
} from "./types";

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDatabase() {
  databasePromise ??= SQLite.openDatabaseAsync("idromardi-readings.db");
  return databasePromise;
}

export async function initializeDatabase() {
  const database = await getDatabase();
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY NOT NULL,
      operator_id TEXT,
      data_json TEXT NOT NULL,
      reading_states_json TEXT NOT NULL DEFAULT '[]',
      context_version TEXT NOT NULL,
      downloaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assignment_items (
      assignment_id TEXT NOT NULL,
      utenza_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      context_hash TEXT NOT NULL,
      data_json TEXT NOT NULL,
      PRIMARY KEY (assignment_id, utenza_id),
      FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY NOT NULL,
      assignment_id TEXT NOT NULL,
      utenza_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      capture_sequence INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('MANUAL', 'PHOTO')),
      reading_value INTEGER NOT NULL,
      reading_state TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      timezone_offset_minutes INTEGER NOT NULL,
      context_hash TEXT NOT NULL,
      operator_note TEXT,
      ocr_suggested_value INTEGER,
      ocr_raw_json TEXT,
      ocr_confirmed INTEGER NOT NULL DEFAULT 0,
      photo_uri TEXT,
      photo_sha256 TEXT,
      photo_mime_type TEXT,
      local_status TEXT NOT NULL,
      server_status TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE (assignment_id, utenza_id),
      FOREIGN KEY (assignment_id, utenza_id)
        REFERENCES assignment_items(assignment_id, utenza_id)
    );

    CREATE INDEX IF NOT EXISTS idx_captures_outbox
      ON captures(local_status, next_retry_at);
  `);

  const assignmentColumns = await database.getAllAsync<{ name: string }>(
    "PRAGMA table_info(assignments)"
  );
  if (!assignmentColumns.some((column) => column.name === "operator_id")) {
    await database.execAsync("ALTER TABLE assignments ADD COLUMN operator_id TEXT");
  }
  if (!assignmentColumns.some((column) => column.name === "reading_states_json")) {
    await database.execAsync(
      "ALTER TABLE assignments ADD COLUMN reading_states_json TEXT NOT NULL DEFAULT '[]'"
    );
  }
  const legacyAssignments = await database.getAllAsync<{ id: string; data_json: string }>(
    "SELECT id, data_json FROM assignments WHERE operator_id IS NULL"
  );
  for (const row of legacyAssignments) {
    try {
      const operatorId = JSON.parse(row.data_json)?.operator_id;
      if (operatorId) {
        await database.runAsync(
          "UPDATE assignments SET operator_id = ? WHERE id = ?",
          operatorId,
          row.id
        );
      }
    } catch {
      // A malformed legacy snapshot stays hidden and can be safely downloaded again.
    }
  }
}

export async function saveAssignmentPackage(
  payload: AssignmentPackage,
  localOperatorId = payload.assignment.operator_id
) {
  const database = await getDatabase();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO assignments
         (id, operator_id, data_json, reading_states_json, context_version, downloaded_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         operator_id = excluded.operator_id,
         data_json = excluded.data_json,
         reading_states_json = excluded.reading_states_json,
         context_version = excluded.context_version,
         downloaded_at = excluded.downloaded_at`,
      payload.assignment.id,
      localOperatorId,
      JSON.stringify(payload.assignment),
      JSON.stringify(payload.readingStates || []),
      payload.assignment.context_version,
      new Date().toISOString()
    );
    for (const item of payload.items) {
      await database.runAsync(
        `INSERT INTO assignment_items
           (assignment_id, utenza_id, position, context_hash, data_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(assignment_id, utenza_id) DO UPDATE SET
           position = excluded.position,
           context_hash = excluded.context_hash,
           data_json = excluded.data_json`,
        payload.assignment.id,
        item.utenza_id,
        item.position,
        item.context_hash,
        JSON.stringify(item)
      );
    }
  });
}

export async function listReadingStates(assignmentId: string): Promise<ReadingState[]> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ reading_states_json: string }>(
    "SELECT reading_states_json FROM assignments WHERE id = ?",
    assignmentId
  );
  try {
    return JSON.parse(row?.reading_states_json || "[]") as ReadingState[];
  } catch {
    return [];
  }
}

export async function listLocalAssignments(operatorId: string): Promise<AssignmentSummary[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<{ data_json: string }>(
    `SELECT data_json FROM assignments
     WHERE operator_id = ?
     ORDER BY downloaded_at DESC`,
    operatorId
  );
  return rows.map((row) => JSON.parse(row.data_json) as AssignmentSummary);
}

export async function listAssignmentItems(
  assignmentId: string,
  operatorId: string
): Promise<AssignmentItem[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<{
    data_json: string;
    reading_value: number | null;
    reading_state: string | null;
    local_status: AssignmentItem["local_status"];
    server_status: AssignmentItem["server_status"];
  }>(
    `SELECT ai.data_json, c.reading_value, c.reading_state,
            c.local_status, c.server_status
     FROM assignment_items ai
     LEFT JOIN captures c
       ON c.assignment_id = ai.assignment_id AND c.utenza_id = ai.utenza_id
     JOIN assignments a ON a.id = ai.assignment_id
     WHERE ai.assignment_id = ? AND a.operator_id = ?
     ORDER BY ai.position`,
    assignmentId,
    operatorId
  );
  return rows.map((row) => ({
    ...(JSON.parse(row.data_json) as AssignmentItem),
    reading_value: row.reading_value,
    reading_state: row.reading_state,
    local_status: row.local_status,
    server_status: row.server_status,
  }));
}

export async function saveManualCapture({
  assignmentId,
  utenzaId,
  contextHash,
  readingValue,
  readingState,
  deviceId,
  operatorId,
}: {
  assignmentId: string;
  utenzaId: string;
  contextHash: string;
  readingValue: number;
  readingState: string;
  deviceId: string;
  operatorId: string;
}) {
  const database = await getDatabase();
  const ownedAssignment = await database.getFirstAsync<{ id: string }>(
    "SELECT id FROM assignments WHERE id = ? AND operator_id = ?",
    assignmentId,
    operatorId
  );
  if (!ownedAssignment) {
    throw new Error("Il giro non appartiene all'operatore autenticato");
  }
  const existing = await database.getFirstAsync<{
    id: string;
    server_status: string | null;
    attempts: number;
  }>(
    `SELECT id, server_status, attempts FROM captures WHERE assignment_id = ? AND utenza_id = ?`,
    assignmentId,
    utenzaId
  );
  if (existing?.server_status) {
    throw new Error("La lettura è già stata ricevuta dal server e non può essere modificata");
  }
  if (Number(existing?.attempts || 0) > 0) {
    throw new Error(
      "La sincronizzazione è già stata tentata. Sincronizza o verifica lo stato prima di modificare la lettura"
    );
  }
  const id = existing?.id || Crypto.randomUUID();
  const now = new Date();
  await database.runAsync(
    `INSERT INTO captures
       (id, assignment_id, utenza_id, device_id, capture_sequence, source,
        reading_value, reading_state, captured_at, timezone_offset_minutes,
        context_hash, ocr_confirmed, local_status, updated_at)
     VALUES (?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, 0, 'READY_TO_SYNC', ?)
     ON CONFLICT(assignment_id, utenza_id) DO UPDATE SET
       reading_value = excluded.reading_value,
       reading_state = excluded.reading_state,
       captured_at = excluded.captured_at,
       timezone_offset_minutes = excluded.timezone_offset_minutes,
       local_status = 'READY_TO_SYNC',
       server_status = NULL,
       attempts = 0,
       next_retry_at = 0,
       last_error = NULL,
       updated_at = excluded.updated_at`,
    id,
    assignmentId,
    utenzaId,
    deviceId,
    Date.now(),
    readingValue,
    readingState,
    now.toISOString(),
    -now.getTimezoneOffset(),
    contextHash,
    now.toISOString()
  );
  return id;
}

export async function getPendingCaptures(operatorId: string): Promise<LocalCapture[]> {
  const database = await getDatabase();
  return database.getAllAsync<LocalCapture>(
    `SELECT c.* FROM captures c
     JOIN assignments a ON a.id = c.assignment_id
     WHERE a.operator_id = ?
       AND c.local_status IN ('READY_TO_SYNC', 'RETRY', 'UPLOADING', 'AUTH_REQUIRED')
       AND c.next_retry_at <= ?
     ORDER BY c.capture_sequence
     LIMIT 100`,
    operatorId,
    Date.now()
  );
}

export async function getReconcileCandidates(operatorId: string): Promise<LocalCapture[]> {
  const database = await getDatabase();
  return database.getAllAsync<LocalCapture>(
    `SELECT c.* FROM captures c
     JOIN assignments a ON a.id = c.assignment_id
     WHERE a.operator_id = ? AND c.local_status = 'SERVER_CONFIRMED'
     LIMIT 100`,
    operatorId
  );
}

export async function markUploading(id: string) {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE captures SET local_status = 'UPLOADING', attempts = attempts + 1,
       updated_at = ? WHERE id = ?`,
    new Date().toISOString(),
    id
  );
}

export async function markServerConfirmed(id: string, serverStatus: string) {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE captures SET local_status = 'SERVER_CONFIRMED', server_status = ?,
       last_error = NULL, next_retry_at = 0, updated_at = ? WHERE id = ?`,
    serverStatus,
    new Date().toISOString(),
    id
  );
}

export async function markRetry(id: string, attempts: number, message: string, authRequired: boolean) {
  const database = await getDatabase();
  const delay = Math.min(5 * 60_000, 2 ** Math.min(attempts, 8) * 1_000);
  await database.runAsync(
    `UPDATE captures SET local_status = ?, last_error = ?, next_retry_at = ?,
       updated_at = ? WHERE id = ?`,
    authRequired ? "AUTH_REQUIRED" : "RETRY",
    message.slice(0, 500),
    authRequired ? 0 : Date.now() + delay,
    new Date().toISOString(),
    id
  );
}

export async function updateReconciledStatus(id: string, serverStatus: string) {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE captures SET server_status = ?, updated_at = ? WHERE id = ?`,
    serverStatus,
    new Date().toISOString(),
    id
  );
}

export async function countUnsynchronized(operatorId: string) {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM captures c
     JOIN assignments a ON a.id = c.assignment_id
     WHERE a.operator_id = ? AND c.local_status != 'SERVER_CONFIRMED'`,
    operatorId
  );
  return Number(row?.count || 0);
}
