-- Private, durable attachments. No public URLs or ephemeral Render filesystem.
CREATE TABLE IF NOT EXISTS meta_attachments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  channel_id CHAR(36) NOT NULL,
  message_id CHAR(36) DEFAULT NULL,
  created_by CHAR(36) DEFAULT NULL,
  filename VARCHAR(200) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  media_type VARCHAR(20) NOT NULL,
  content MEDIUMBLOB NOT NULL,
  byte_length INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_meta_attachment_expiry (message_id, created_at),
  FOREIGN KEY (channel_id) REFERENCES meta_channels(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES meta_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
