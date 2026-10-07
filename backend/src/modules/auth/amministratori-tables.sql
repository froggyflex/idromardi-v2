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
