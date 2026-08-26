ALTER TABLE meta_conversations
  MODIFY COLUMN status ENUM('OPEN', 'PENDING', 'CLOSED', 'SPAM', 'ARCHIVED')
    NOT NULL DEFAULT 'OPEN',
  ADD COLUMN archived_at DATETIME(3) DEFAULT NULL AFTER status,
  ADD KEY idx_meta_conversation_archive (status, archived_at);

ALTER TABLE meta_messages
  ADD COLUMN deleted_at DATETIME(3) DEFAULT NULL AFTER error_message,
  ADD COLUMN deleted_by CHAR(36) DEFAULT NULL AFTER deleted_at,
  ADD KEY idx_meta_message_deleted (conversation_id, deleted_at);
