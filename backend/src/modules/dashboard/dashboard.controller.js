const pool = require("../../config/db");

exports.getStats = async (req, res) => {
  const [[condomini]] = await pool.query(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN stato='ATTIVO' THEN 1 ELSE 0 END) as active
    FROM condomini_v2
  `);

  const [activeUtenze] = await pool.query(`
    SELECT
      ls.period_year AS anno,
      COUNT(DISTINCT fr.id_utenza) AS utenti_attivi
    FROM fatture_righe fr
    JOIN fatture_sessioni fs ON fs.id = fr.id_fattura
    JOIN letture_sessioni ls ON ls.id = fs.id_periodo_attuale
    WHERE fr.totale > 0
    GROUP BY ls.period_year
    ORDER BY ls.period_year
  `);


  const [[utenze]] = await pool.query(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN active_flag=1 THEN 1 ELSE 0 END) as active
    FROM utenze_v2
  `);

  res.json({
    condomini,
    utenze, activeUtenze
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
