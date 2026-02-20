const pool = require("../../config/db");

exports.getStats = async (req, res) => {
  const [[condomini]] = await pool.query(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN stato='ATTIVO' THEN 1 ELSE 0 END) as active
    FROM condomini_v2
  `);

  const [[utenze]] = await pool.query(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN active_flag=1 THEN 1 ELSE 0 END) as active
    FROM utenze_v2
  `);

  res.json({
    condomini,
    utenze
  });
};
exports.getMapData = async (req, res) => {
  const [rows] = await pool.query(`
    SELECT id, codice, indirizzo, citta, latitude, longitude
    FROM condomini_v2
    WHERE stato='ATTIVO'
  `);

  res.json(rows);
};
