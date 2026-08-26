ALTER TABLE meta_channels
  ADD COLUMN credential_mode VARCHAR(32) DEFAULT NULL AFTER token_expires_at,
  ADD COLUMN api_sender_id VARCHAR(160) DEFAULT NULL AFTER credential_mode;
