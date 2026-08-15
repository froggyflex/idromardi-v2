-- Transitional acconto/storno snapshots for legacy-software reconciliation.
-- MySQL 8+. Idempotent and safe to run before deploying the matching backend.

CREATE TABLE IF NOT EXISTS fatture_acconti_movimenti (
  id CHAR(36) NOT NULL PRIMARY KEY,
  id_utenza CHAR(36) NOT NULL,
  id_fattura CHAR(36) NOT NULL,
  id_riga_fattura CHAR(36) DEFAULT NULL,
  tipo_movimento ENUM('ACCONTO_CARICATO', 'STORNO_APPLICATO', 'RETTIFICA_POS') NOT NULL,
  importo_euro DECIMAL(10,2) NOT NULL DEFAULT 0,
  importo_mc DECIMAL(12,3) NOT NULL DEFAULT 0,
  source_movimento_id CHAR(36) DEFAULT NULL,
  origine_credito VARCHAR(20) DEFAULT NULL,
  periodo_origine VARCHAR(100) DEFAULT NULL,
  note VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_acconti_utenza_created (id_utenza, created_at),
  KEY idx_acconti_fattura (id_fattura),
  KEY idx_acconti_source (source_movimento_id),
  KEY idx_acconti_riga (id_riga_fattura)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DELIMITER $$

DROP PROCEDURE IF EXISTS add_storno_transition_columns$$
CREATE PROCEDURE add_storno_transition_columns()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_acconti_movimenti' AND COLUMN_NAME = 'origine_credito') THEN
    ALTER TABLE fatture_acconti_movimenti ADD COLUMN origine_credito VARCHAR(20) NULL AFTER source_movimento_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_acconti_movimenti' AND COLUMN_NAME = 'periodo_origine') THEN
    ALTER TABLE fatture_acconti_movimenti ADD COLUMN periodo_origine VARCHAR(100) NULL AFTER origine_credito;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_righe' AND COLUMN_NAME = 'storno_legacy') THEN
    ALTER TABLE fatture_righe ADD COLUMN storno_legacy DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER storno_acconto;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_righe' AND COLUMN_NAME = 'storno_txt_aggiuntivo') THEN
    ALTER TABLE fatture_righe ADD COLUMN storno_txt_aggiuntivo DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER storno_legacy;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_righe' AND COLUMN_NAME = 'credito_storno_residuo') THEN
    ALTER TABLE fatture_righe ADD COLUMN credito_storno_residuo DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER storno_txt_aggiuntivo;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_righe' AND COLUMN_NAME = 'storno_legacy_periodo') THEN
    ALTER TABLE fatture_righe ADD COLUMN storno_legacy_periodo VARCHAR(100) NULL AFTER credito_storno_residuo;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_righe' AND COLUMN_NAME = 'storno_mc_applicato') THEN
    ALTER TABLE fatture_righe ADD COLUMN storno_mc_applicato DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER storno_acconto;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_righe' AND COLUMN_NAME = 'storno_pregresso') THEN
    ALTER TABLE fatture_righe ADD COLUMN storno_pregresso DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER storno_legacy;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_righe' AND COLUMN_NAME = 'storno_txt_richiesto') THEN
    ALTER TABLE fatture_righe ADD COLUMN storno_txt_richiesto DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER storno_txt_aggiuntivo;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_righe' AND COLUMN_NAME = 'storno_txt_compensato_legacy') THEN
    ALTER TABLE fatture_righe ADD COLUMN storno_txt_compensato_legacy DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER storno_txt_richiesto;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_righe' AND COLUMN_NAME = 'storno_carenza_assorbita') THEN
    ALTER TABLE fatture_righe ADD COLUMN storno_carenza_assorbita DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER storno_txt_compensato_legacy;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_righe' AND COLUMN_NAME = 'credito_storno_residuo_mc') THEN
    ALTER TABLE fatture_righe ADD COLUMN credito_storno_residuo_mc DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER credito_storno_residuo;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_righe' AND COLUMN_NAME = 'credito_storno_ingresso') THEN
    ALTER TABLE fatture_righe ADD COLUMN credito_storno_ingresso DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER credito_storno_residuo_mc;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_righe' AND COLUMN_NAME = 'credito_storno_assorbito') THEN
    ALTER TABLE fatture_righe ADD COLUMN credito_storno_assorbito DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER credito_storno_ingresso;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_righe' AND COLUMN_NAME = 'credito_storno_differito') THEN
    ALTER TABLE fatture_righe ADD COLUMN credito_storno_differito DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER credito_storno_assorbito;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fatture_righe' AND COLUMN_NAME = 'storno_transition_status') THEN
    ALTER TABLE fatture_righe ADD COLUMN storno_transition_status VARCHAR(50) NULL AFTER storno_legacy_periodo;
  END IF;
END$$

CALL add_storno_transition_columns()$$
DROP PROCEDURE add_storno_transition_columns$$

DELIMITER ;
