-- Idromardi mobile readings: offline assignments, idempotent staging and review.
-- MySQL 8+. Apply once before enabling /api/mobile-readings.

CREATE TABLE IF NOT EXISTS app_auth_users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('ADMIN', 'REVIEWER', 'METER_READER') NOT NULL DEFAULT 'METER_READER',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Existing installations may have app_auth_users without roles.
SET @role_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'app_auth_users'
    AND COLUMN_NAME = 'role'
);
SET @role_migration_sql = IF(
  @role_column_exists = 0,
  'ALTER TABLE app_auth_users ADD COLUMN role ENUM(''ADMIN'', ''REVIEWER'', ''METER_READER'') NOT NULL DEFAULT ''METER_READER'' AFTER password_hash',
  'SELECT 1'
);
PREPARE role_migration_statement FROM @role_migration_sql;
EXECUTE role_migration_statement;
DEALLOCATE PREPARE role_migration_statement;

UPDATE app_auth_users SET role = 'ADMIN' WHERE username = 'admin';

CREATE TABLE IF NOT EXISTS mobile_reading_assignments (
  id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  condominio_id CHAR(36) NOT NULL,
  operator_id CHAR(36) NOT NULL,
  created_by CHAR(36) NOT NULL,
  status ENUM('READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'READY',
  context_version CHAR(64) NOT NULL,
  downloaded_at DATETIME(3) DEFAULT NULL,
  completed_at DATETIME(3) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mobile_assignment_session_operator (session_id, operator_id),
  KEY idx_mobile_assignment_operator_status (operator_id, status),
  KEY idx_mobile_assignment_condominio (condominio_id),
  CONSTRAINT fk_mobile_assignment_session
    FOREIGN KEY (session_id) REFERENCES letture_sessioni (id),
  CONSTRAINT fk_mobile_assignment_condominio
    FOREIGN KEY (condominio_id) REFERENCES condomini_v2 (id),
  CONSTRAINT fk_mobile_assignment_operator
    FOREIGN KEY (operator_id) REFERENCES app_auth_users (id),
  CONSTRAINT fk_mobile_assignment_creator
    FOREIGN KEY (created_by) REFERENCES app_auth_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS mobile_reading_assignment_items (
  assignment_id CHAR(36) NOT NULL,
  utenza_id CHAR(36) NOT NULL,
  position INT UNSIGNED NOT NULL,
  context_hash CHAR(64) NOT NULL,
  meter_serial_snapshot VARCHAR(125) DEFAULT NULL,
  previous_value BIGINT UNSIGNED DEFAULT NULL,
  previous_state VARCHAR(10) DEFAULT NULL,
  snapshot_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (assignment_id, utenza_id),
  UNIQUE KEY uq_mobile_assignment_position (assignment_id, position),
  KEY idx_mobile_assignment_item_utenza (utenza_id),
  CONSTRAINT fk_mobile_assignment_item_assignment
    FOREIGN KEY (assignment_id) REFERENCES mobile_reading_assignments (id) ON DELETE CASCADE,
  CONSTRAINT fk_mobile_assignment_item_utenza
    FOREIGN KEY (utenza_id) REFERENCES utenze_v2 (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS mobile_reading_submissions (
  id CHAR(36) NOT NULL,
  assignment_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  condominio_id CHAR(36) NOT NULL,
  utenza_id CHAR(36) NOT NULL,
  operator_id CHAR(36) NOT NULL,
  device_id VARCHAR(128) NOT NULL,
  capture_sequence BIGINT UNSIGNED DEFAULT NULL,
  source ENUM('MANUAL', 'PHOTO') NOT NULL,
  reading_value BIGINT UNSIGNED NOT NULL,
  reading_state CHAR(1) NOT NULL,
  captured_at DATETIME(3) NOT NULL,
  timezone_offset_minutes SMALLINT NOT NULL DEFAULT 0,
  context_hash CHAR(64) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  operator_note VARCHAR(500) DEFAULT NULL,
  ocr_suggested_value BIGINT UNSIGNED DEFAULT NULL,
  ocr_raw_json JSON DEFAULT NULL,
  ocr_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  photo_object_key VARCHAR(512) DEFAULT NULL,
  photo_sha256 CHAR(64) DEFAULT NULL,
  photo_mime_type VARCHAR(80) DEFAULT NULL,
  photo_size_bytes BIGINT UNSIGNED DEFAULT NULL,
  workflow_status ENUM(
    'UPLOAD_INCOMPLETE',
    'TO_BE_ACCEPTED',
    'ACCEPTED',
    'REJECTED',
    'CONTEXT_CONFLICT'
  ) NOT NULL,
  conflict_reason VARCHAR(500) DEFAULT NULL,
  reviewed_by CHAR(36) DEFAULT NULL,
  reviewed_at DATETIME(3) DEFAULT NULL,
  review_note VARCHAR(500) DEFAULT NULL,
  accepted_reading_id CHAR(36) DEFAULT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mobile_submission_review (workflow_status, received_at),
  KEY idx_mobile_submission_assignment (assignment_id, utenza_id),
  KEY idx_mobile_submission_operator (operator_id, received_at),
  KEY idx_mobile_submission_session (session_id, utenza_id),
  CONSTRAINT fk_mobile_submission_assignment
    FOREIGN KEY (assignment_id) REFERENCES mobile_reading_assignments (id),
  CONSTRAINT fk_mobile_submission_session
    FOREIGN KEY (session_id) REFERENCES letture_sessioni (id),
  CONSTRAINT fk_mobile_submission_condominio
    FOREIGN KEY (condominio_id) REFERENCES condomini_v2 (id),
  CONSTRAINT fk_mobile_submission_utenza
    FOREIGN KEY (utenza_id) REFERENCES utenze_v2 (id),
  CONSTRAINT fk_mobile_submission_operator
    FOREIGN KEY (operator_id) REFERENCES app_auth_users (id),
  CONSTRAINT fk_mobile_submission_reviewer
    FOREIGN KEY (reviewed_by) REFERENCES app_auth_users (id),
  CONSTRAINT fk_mobile_submission_accepted_reading
    FOREIGN KEY (accepted_reading_id) REFERENCES letture_righe (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS mobile_reading_submission_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id CHAR(36) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  actor_id CHAR(36) DEFAULT NULL,
  from_status VARCHAR(32) DEFAULT NULL,
  to_status VARCHAR(32) DEFAULT NULL,
  details_json JSON DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mobile_submission_event (submission_id, created_at),
  CONSTRAINT fk_mobile_submission_event_submission
    FOREIGN KEY (submission_id) REFERENCES mobile_reading_submissions (id) ON DELETE CASCADE,
  CONSTRAINT fk_mobile_submission_event_actor
    FOREIGN KEY (actor_id) REFERENCES app_auth_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
