ALTER TABLE meta_channels
  ADD COLUMN encrypted_access_token TEXT DEFAULT NULL AFTER status,
  ADD COLUMN token_iv CHAR(24) DEFAULT NULL AFTER encrypted_access_token,
  ADD COLUMN token_auth_tag CHAR(32) DEFAULT NULL AFTER token_iv,
  ADD COLUMN token_expires_at DATETIME(3) DEFAULT NULL AFTER token_auth_tag,
  ADD COLUMN last_verified_at DATETIME(3) DEFAULT NULL AFTER token_expires_at,
  ADD COLUMN last_error VARCHAR(1000) DEFAULT NULL AFTER last_verified_at;

UPDATE meta_channels ch
JOIN meta_integrations i ON i.id = ch.integration_id
SET ch.encrypted_access_token = i.encrypted_access_token,
    ch.token_iv = i.token_iv,
    ch.token_auth_tag = i.token_auth_tag,
    ch.token_expires_at = i.token_expires_at
WHERE ch.encrypted_access_token IS NULL
  AND i.encrypted_access_token IS NOT NULL;
