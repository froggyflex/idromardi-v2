-- Amministratore portal: apply after 001_mobile_readings.sql.
-- Existing user passwords and assignments to meter readers are preserved.
ALTER TABLE app_auth_users MODIFY COLUMN role
  ENUM('ADMIN', 'REVIEWER', 'METER_READER', 'AMMINISTRATORE') NOT NULL DEFAULT 'METER_READER';

SET @amministratore_column_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'app_auth_users' AND COLUMN_NAME = 'must_change_password') = 0,
  'ALTER TABLE app_auth_users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE',
  'SELECT 1'
);
PREPARE amministratore_statement FROM @amministratore_column_sql;
EXECUTE amministratore_statement;
DEALLOCATE PREPARE amministratore_statement;

SET @amministratore_column_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'app_auth_users' AND COLUMN_NAME = 'token_version') = 0,
  'ALTER TABLE app_auth_users ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE amministratore_statement FROM @amministratore_column_sql;
EXECUTE amministratore_statement;
DEALLOCATE PREPARE amministratore_statement;

CREATE TABLE IF NOT EXISTS app_amministratore_condomini (
  user_id CHAR(36) NOT NULL,
  condominio_id CHAR(36) NOT NULL,
  PRIMARY KEY (user_id, condominio_id),
  INDEX idx_amministratore_condominio (condominio_id)
);
CREATE TABLE IF NOT EXISTS app_auth_impersonations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  actor_id CHAR(36) NOT NULL,
  target_id CHAR(36) NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_impersonation_actor (actor_id, started_at),
  INDEX idx_impersonation_target (target_id, started_at)
);
