-- Reading-state vocabulary used by web entry, mobile entry, summaries and bills.
INSERT INTO letture_stati (codice, descrizione, richiede_valore)
VALUES
  ('B', 'Contatore bloccato', 0),
  ('T', 'Telegram', 1)
ON DUPLICATE KEY UPDATE
  descrizione = VALUES(descrizione),
  richiede_valore = VALUES(richiede_valore);
