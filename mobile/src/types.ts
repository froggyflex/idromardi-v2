export type ServerWorkflowStatus =
  | "UPLOAD_INCOMPLETE"
  | "TO_BE_ACCEPTED"
  | "ACCEPTED"
  | "REJECTED"
  | "CONTEXT_CONFLICT";

export type LocalCaptureStatus =
  | "READY_TO_SYNC"
  | "UPLOADING"
  | "SERVER_CONFIRMED"
  | "RETRY"
  | "AUTH_REQUIRED";

export type AssignmentSummary = {
  id: string;
  operator_id: string;
  session_id: string;
  condominio_id: string;
  status: string;
  context_version: string;
  period_year: number;
  period_month: number;
  data_lettura_operatore?: string | null;
  condominio_nome: string;
  condominio_indirizzo?: string | null;
  item_count?: number;
  accepted_count?: number;
};

export type AssignmentItem = {
  assignment_id: string;
  utenza_id: string;
  position: number;
  context_hash: string;
  meter_serial_snapshot?: string | null;
  previous_value?: number | null;
  previous_state?: string | null;
  snapshot: {
    idUser?: number;
    nome?: string;
    cognome?: string;
    interno?: string;
    scala?: string;
    isolato?: string;
    piano?: number;
    meterSerial?: string;
  };
  reading_value?: number | null;
  local_status?: LocalCaptureStatus | null;
  server_status?: ServerWorkflowStatus | null;
};

export type AssignmentPackage = {
  assignment: AssignmentSummary;
  items: AssignmentItem[];
  readingStates: Array<{
    codice: string;
    descrizione: string;
    richiede_valore: number;
  }>;
};

export type LocalCapture = {
  id: string;
  assignment_id: string;
  utenza_id: string;
  device_id: string;
  capture_sequence: number;
  source: "MANUAL" | "PHOTO";
  reading_value: number;
  reading_state: string;
  captured_at: string;
  timezone_offset_minutes: number;
  context_hash: string;
  operator_note: string | null;
  ocr_suggested_value: number | null;
  ocr_raw_json: string | null;
  ocr_confirmed: number;
  photo_uri: string | null;
  photo_sha256: string | null;
  photo_mime_type: string | null;
  local_status: LocalCaptureStatus;
  server_status: ServerWorkflowStatus | null;
  attempts: number;
  next_retry_at: number;
  last_error: string | null;
};
