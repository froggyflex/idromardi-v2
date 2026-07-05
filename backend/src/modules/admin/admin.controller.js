const pool = require("../../config/db");
const { geocodeAddress } = require("../geocoding/geocoding.services");

const delay = (ms) => new Promise(res => setTimeout(res, ms));

exports.listGeocodeMissingCondomini = async (req, res) => {
  const [rows] = await pool.query(`
    SELECT id, codice, nome, indirizzo, cap, citta, latitude, longitude, updated_at
    FROM condomini_v2
    WHERE (latitude IS NULL OR longitude IS NULL OR latitude = 0 OR longitude = 0)
      AND stato = 'ATTIVO'
    ORDER BY codice ASC
  `);

  res.json({
    total: rows.length,
    rows,
  });
};

exports.batchGeocodeCondomini = async (req, res) => {
  const [rows] = await pool.query(`
    SELECT id, codice, nome, indirizzo, cap, citta
    FROM condomini_v2
    WHERE (latitude IS NULL OR longitude IS NULL OR latitude = 0 OR longitude = 0)
      AND stato = 'ATTIVO'
    ORDER BY codice ASC
  `);

  let updated = 0;
  let failed = 0;
  const failures = [];

  for (const c of rows) {
    try {
      const geo = await geocodeAddress(c.indirizzo, c.citta, c.cap);

      if (geo) {
        await pool.query(
          `UPDATE condomini_v2 SET latitude=?, longitude=?, updated_at=NOW() WHERE id=?`,
          [geo.latitude, geo.longitude, c.id]
        );
        updated++;
      } else {
        failed++;
        failures.push({
          codice: c.codice,
          nome: c.nome,
          indirizzo: c.indirizzo,
          citta: c.citta,
          reason: "Nessun risultato",
        });
      }
    } catch (error) {
      failed++;
      failures.push({
        codice: c.codice,
        nome: c.nome,
        indirizzo: c.indirizzo,
        citta: c.citta,
        reason: error.message || error.code || "Errore geocoding",
      });
    }

    await delay(1100);
  }

  res.json({
    totalMissing: rows.length,
    updated,
    failed,
    failures: failures.slice(0, 20),
  });
};
