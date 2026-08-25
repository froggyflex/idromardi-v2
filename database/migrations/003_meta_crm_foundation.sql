-- Unified Meta CRM foundation: leads, conversations, audited messaging and AI approval.
-- MySQL 8+. Credentials are encrypted by the application before storage.

CREATE TABLE IF NOT EXISTS meta_integrations (
  id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  business_account_id VARCHAR(100) DEFAULT NULL,
  app_id VARCHAR(100) DEFAULT NULL,
  graph_api_version VARCHAR(20) DEFAULT NULL,
  encrypted_access_token TEXT DEFAULT NULL,
  token_iv CHAR(24) DEFAULT NULL,
  token_auth_tag CHAR(32) DEFAULT NULL,
  token_expires_at DATETIME(3) DEFAULT NULL,
  status ENUM('PENDING', 'CONNECTED', 'PAUSED', 'ERROR') NOT NULL DEFAULT 'PENDING',
  ai_mode ENUM('OFF', 'DRAFT', 'APPROVAL', 'AUTO') NOT NULL DEFAULT 'OFF',
  last_error VARCHAR(1000) DEFAULT NULL,
  created_by CHAR(36) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_meta_integrations_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS meta_channels (
  id CHAR(36) NOT NULL,
  integration_id CHAR(36) NOT NULL,
  channel_type ENUM('WHATSAPP', 'MESSENGER', 'INSTAGRAM') NOT NULL,
  external_account_id VARCHAR(160) NOT NULL,
  display_name VARCHAR(160) DEFAULT NULL,
  status ENUM('PENDING', 'ACTIVE', 'PAUSED', 'ERROR') NOT NULL DEFAULT 'PENDING',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_channel_external (integration_id, channel_type, external_account_id),
  KEY idx_meta_channel_lookup (channel_type, external_account_id),
  CONSTRAINT fk_meta_channel_integration
    FOREIGN KEY (integration_id) REFERENCES meta_integrations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS meta_contacts (
  id CHAR(36) NOT NULL,
  integration_id CHAR(36) NOT NULL,
  channel_type ENUM('WHATSAPP', 'MESSENGER', 'INSTAGRAM') NOT NULL,
  external_contact_id VARCHAR(191) NOT NULL,
  display_name VARCHAR(191) DEFAULT NULL,
  phone VARCHAR(60) DEFAULT NULL,
  email VARCHAR(254) DEFAULT NULL,
  profile_json JSON DEFAULT NULL,
  consent_status ENUM('UNKNOWN', 'OPTED_IN', 'OPTED_OUT') NOT NULL DEFAULT 'UNKNOWN',
  consent_updated_at DATETIME(3) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_contact_external (integration_id, channel_type, external_contact_id),
  KEY idx_meta_contact_name (display_name),
  CONSTRAINT fk_meta_contact_integration
    FOREIGN KEY (integration_id) REFERENCES meta_integrations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS meta_leads (
  id CHAR(36) NOT NULL,
  integration_id CHAR(36) NOT NULL,
  channel_id CHAR(36) DEFAULT NULL,
  contact_id CHAR(36) DEFAULT NULL,
  external_lead_id VARCHAR(191) NOT NULL,
  status ENUM('NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST', 'ARCHIVED') NOT NULL DEFAULT 'NEW',
  form_id VARCHAR(191) DEFAULT NULL,
  ad_id VARCHAR(191) DEFAULT NULL,
  campaign_id VARCHAR(191) DEFAULT NULL,
  source_name VARCHAR(191) DEFAULT NULL,
  field_data_json JSON DEFAULT NULL,
  raw_payload_json JSON NOT NULL,
  hydration_status ENUM('PENDING', 'PROCESSING', 'COMPLETE', 'RETRY', 'FAILED') NOT NULL DEFAULT 'PENDING',
  hydration_attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  hydration_last_error VARCHAR(1000) DEFAULT NULL,
  hydration_next_attempt_at DATETIME(3) DEFAULT NULL,
  assigned_to CHAR(36) DEFAULT NULL,
  received_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_lead_external (integration_id, external_lead_id),
  KEY idx_meta_lead_queue (status, received_at),
  KEY idx_meta_lead_hydration (hydration_status, hydration_next_attempt_at),
  KEY idx_meta_lead_assignee (assigned_to, status),
  CONSTRAINT fk_meta_lead_integration
    FOREIGN KEY (integration_id) REFERENCES meta_integrations (id) ON DELETE CASCADE,
  CONSTRAINT fk_meta_lead_channel
    FOREIGN KEY (channel_id) REFERENCES meta_channels (id) ON DELETE SET NULL,
  CONSTRAINT fk_meta_lead_contact
    FOREIGN KEY (contact_id) REFERENCES meta_contacts (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS meta_conversations (
  id CHAR(36) NOT NULL,
  integration_id CHAR(36) NOT NULL,
  channel_id CHAR(36) NOT NULL,
  contact_id CHAR(36) NOT NULL,
  status ENUM('OPEN', 'PENDING', 'CLOSED', 'SPAM') NOT NULL DEFAULT 'OPEN',
  assigned_to CHAR(36) DEFAULT NULL,
  unread_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_message_at DATETIME(3) DEFAULT NULL,
  last_inbound_at DATETIME(3) DEFAULT NULL,
  reply_window_expires_at DATETIME(3) DEFAULT NULL,
  ai_paused TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_conversation_contact_channel (channel_id, contact_id),
  KEY idx_meta_conversation_inbox (status, last_message_at),
  KEY idx_meta_conversation_assignee (assigned_to, status),
  CONSTRAINT fk_meta_conversation_integration
    FOREIGN KEY (integration_id) REFERENCES meta_integrations (id) ON DELETE CASCADE,
  CONSTRAINT fk_meta_conversation_channel
    FOREIGN KEY (channel_id) REFERENCES meta_channels (id) ON DELETE CASCADE,
  CONSTRAINT fk_meta_conversation_contact
    FOREIGN KEY (contact_id) REFERENCES meta_contacts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS meta_messages (
  id CHAR(36) NOT NULL,
  conversation_id CHAR(36) NOT NULL,
  channel_id CHAR(36) NOT NULL,
  external_message_id VARCHAR(191) DEFAULT NULL,
  direction ENUM('INBOUND', 'OUTBOUND') NOT NULL,
  sender_kind ENUM('CONTACT', 'HUMAN', 'AI', 'SYSTEM') NOT NULL,
  sender_user_id CHAR(36) DEFAULT NULL,
  message_type VARCHAR(40) NOT NULL DEFAULT 'TEXT',
  body_text TEXT DEFAULT NULL,
  payload_json JSON DEFAULT NULL,
  status ENUM('RECEIVED', 'DRAFT', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED') NOT NULL,
  error_message VARCHAR(1000) DEFAULT NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_message_external (channel_id, external_message_id),
  KEY idx_meta_message_timeline (conversation_id, occurred_at),
  KEY idx_meta_message_status (status, updated_at),
  CONSTRAINT fk_meta_message_conversation
    FOREIGN KEY (conversation_id) REFERENCES meta_conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_meta_message_channel
    FOREIGN KEY (channel_id) REFERENCES meta_channels (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS meta_webhook_events (
  id CHAR(36) NOT NULL,
  event_key CHAR(64) NOT NULL,
  object_type VARCHAR(80) DEFAULT NULL,
  payload_json JSON NOT NULL,
  processing_status ENUM('RECEIVED', 'PROCESSED', 'UNMATCHED', 'FAILED') NOT NULL DEFAULT 'RECEIVED',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(1000) DEFAULT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_webhook_event_key (event_key),
  KEY idx_meta_webhook_processing (processing_status, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS meta_outbound_jobs (
  id CHAR(36) NOT NULL,
  message_id CHAR(36) NOT NULL,
  integration_id CHAR(36) NOT NULL,
  requested_by CHAR(36) DEFAULT NULL,
  requester_kind ENUM('HUMAN', 'AI', 'SYSTEM') NOT NULL,
  approval_status ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL,
  approved_by CHAR(36) DEFAULT NULL,
  approved_at DATETIME(3) DEFAULT NULL,
  state ENUM('WAITING_APPROVAL', 'READY', 'PROCESSING', 'SENT', 'RETRY', 'FAILED', 'CANCELLED') NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) DEFAULT NULL,
  locked_at DATETIME(3) DEFAULT NULL,
  last_error VARCHAR(1000) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_outbound_message (message_id),
  KEY idx_meta_outbound_worker (state, next_attempt_at, created_at),
  CONSTRAINT fk_meta_outbound_message
    FOREIGN KEY (message_id) REFERENCES meta_messages (id) ON DELETE CASCADE,
  CONSTRAINT fk_meta_outbound_integration
    FOREIGN KEY (integration_id) REFERENCES meta_integrations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS meta_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  integration_id CHAR(36) DEFAULT NULL,
  actor_id CHAR(36) DEFAULT NULL,
  actor_kind ENUM('HUMAN', 'AI', 'SYSTEM', 'META') NOT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(191) DEFAULT NULL,
  details_json JSON DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_meta_audit_entity (entity_type, entity_id, created_at),
  KEY idx_meta_audit_integration (integration_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
