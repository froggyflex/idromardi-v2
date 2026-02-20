const pool = require("../../config/db");
const { geocodeAddress } = require("../geocoding/geocoding.services");

const delay = (ms) => new Promise(res => setTimeout(res, ms));

exports.batchGeocodeCondomini = async (req, res) => {
  const [rows] = await pool.query(`
    SELECT id, indirizzo, citta
    FROM condomini_v2
    WHERE (latitude IS NULL OR longitude IS NULL)
      AND stato = 'ATTIVO'
  `);

  let updated = 0;
  let failed = 0;

  for (const c of rows) {
    try {
      const geo = await geocodeAddress(c.indirizzo, c.citta);

      if (geo) {
        await pool.query(
          `UPDATE condomini_v2 SET latitude=?, longitude=?, updated_at=NOW() WHERE id=?`,
          [geo.latitude, geo.longitude, c.id]
        );
        updated++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    await delay(400);
  }

  res.json({ totalMissing: rows.length, updated, failed });
};
