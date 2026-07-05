const pool = require("../../config/db");

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function periodLabel(month, year) {
  if (!month || !year) return "Periodo non indicato";
  return `${String(month).padStart(2, "0")}/${year}`;
}

async function safeQuery(sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    console.warn("Dashboard query skipped:", error.message);
    return [];
  }
}

async function getRecentActions() {
  const [letture, condomini, fatture, tariffe] = await Promise.all([
    safeQuery(`
      SELECT
        ls.id,
        COALESCE(ls.updated_at, ls.created_at) AS action_at,
        ls.period_month,
        ls.period_year,
        ls.stato,
        c.codice,
        c.nome,
        c.indirizzo
      FROM letture_sessioni ls
      JOIN condomini_v2 c ON c.id = ls.id_condominio
      WHERE COALESCE(ls.updated_at, ls.created_at) IS NOT NULL
      ORDER BY action_at DESC
      LIMIT 5
    `),
    safeQuery(`
      SELECT
        id,
        COALESCE(updated_at, created_at) AS action_at,
        codice,
        nome,
        indirizzo,
        stato
      FROM condomini_v2
      WHERE COALESCE(updated_at, created_at) IS NOT NULL
      ORDER BY action_at DESC
      LIMIT 5
    `),
    safeQuery(`
      SELECT
        fs.id,
        COALESCE(fs.updated_at, fs.created_at) AS action_at,
        fs.stato,
        fs.grand_total,
        fs.tf_code,
        c.codice,
        c.nome,
        pa.period_month AS mese_attuale,
        pa.period_year AS anno_attuale,
        pp.period_month AS mese_precedente,
        pp.period_year AS anno_precedente
      FROM fatture_sessioni fs
      JOIN condomini_v2 c ON c.id = fs.id_condominio
      LEFT JOIN letture_sessioni pa ON pa.id = fs.id_periodo_attuale
      LEFT JOIN letture_sessioni pp ON pp.id = fs.id_periodo_precedente
      WHERE COALESCE(fs.updated_at, fs.created_at) IS NOT NULL
      ORDER BY action_at DESC
      LIMIT 5
    `),
    safeQuery(`
      SELECT
        t.id,
        t.created_at AS action_at,
        t.anno,
        t.valid_from,
        t.valid_to,
        ci.nome AS provider
      FROM casa_idrica_tariffe t
      LEFT JOIN casa_idrica ci ON ci.id = t.id_casa_idrica
      WHERE t.created_at IS NOT NULL
      ORDER BY t.created_at DESC
      LIMIT 5
    `),
  ]);

  return [
    ...letture.map((row) => ({
      id: `letture-${row.id}`,
      type: "letture",
      label: "Inserimento letture",
      title: `${row.nome || `Condominio ${row.codice}`} - ${periodLabel(row.period_month, row.period_year)}`,
      detail: `Stato ${row.stato || "BOZZA"}`,
      date: row.action_at,
    })),
    ...condomini.map((row) => ({
      id: `condominio-${row.id}`,
      type: "condominio",
      label: "Modifica condominio",
      title: row.nome || `Condominio ${row.codice}`,
      detail: [row.indirizzo, row.stato].filter(Boolean).join(" - "),
      date: row.action_at,
    })),
    ...fatture.map((row) => ({
      id: `fattura-${row.id}`,
      type: "fatturazione",
      label: "Fatturazione",
      title: `${row.nome || `Condominio ${row.codice}`} - ${periodLabel(row.mese_precedente, row.anno_precedente)} -> ${periodLabel(row.mese_attuale, row.anno_attuale)}`,
      detail: `${row.stato || "BOZZA"}${row.tf_code ? ` - ${row.tf_code}` : ""} - EUR ${asNumber(row.grand_total).toFixed(2)}`,
      date: row.action_at,
    })),
    ...tariffe.map((row) => ({
      id: `tariffa-${row.id}`,
      type: "tariffe",
      label: "Tariffe",
      title: `${row.provider || "Casa idrica"} - ${row.anno}`,
      detail: [row.valid_from, row.valid_to].filter(Boolean).join(" -> "),
      date: row.action_at,
    })),
  ]
    .filter((item) => item.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);
}

exports.getStats = async (req, res) => {
  try {
    const [[condomini]] = await pool.query(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN stato='ATTIVO' THEN 1 ELSE 0 END) as active,
             SUM(CASE WHEN stato='ATTIVO'
                       AND latitude IS NOT NULL
                       AND longitude IS NOT NULL
                       AND latitude <> 0
                       AND longitude <> 0
                  THEN 1 ELSE 0 END) as geolocated
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

    const [[fatture]] = await pool.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN stato = 'CALCOLATA' THEN 1 ELSE 0 END) AS calcolate,
        SUM(CASE WHEN stato = 'CONFERMATA' THEN 1 ELSE 0 END) AS confermate,
        COALESCE(SUM(grand_total), 0) AS totale_calcolato
      FROM fatture_sessioni
    `);

    const [[letture]] = await pool.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN stato = 'BOZZA' THEN 1 ELSE 0 END) AS bozze,
        SUM(CASE WHEN stato = 'CHIUSA' THEN 1 ELSE 0 END) AS chiuse
      FROM letture_sessioni
    `);

    const [[tariffe]] = await pool.query(`
      SELECT COUNT(*) AS total
      FROM casa_idrica_tariffe
    `);

    const [latestPeriods] = await pool.query(`
      SELECT
        ls.period_month,
        ls.period_year,
        ls.stato,
        c.nome AS condominio_nome,
        c.codice AS condominio_codice,
        COALESCE(ls.updated_at, ls.created_at) AS updated_at
      FROM letture_sessioni ls
      JOIN condomini_v2 c ON c.id = ls.id_condominio
      ORDER BY ls.period_year DESC, ls.period_month DESC, updated_at DESC
      LIMIT 1
    `);

    const recentActions = await getRecentActions();

    res.json({
      condomini: {
        total: asNumber(condomini.total),
        active: asNumber(condomini.active),
        geolocated: asNumber(condomini.geolocated),
        missingGeo: Math.max(0, asNumber(condomini.active) - asNumber(condomini.geolocated)),
      },
      utenze: {
        total: asNumber(utenze.total),
        active: asNumber(utenze.active),
      },
      activeUtenze: activeUtenze.map((row) => ({
        anno: row.anno,
        utenti_attivi: asNumber(row.utenti_attivi),
      })),
      details: {
        fatture: {
          total: asNumber(fatture.total),
          calcolate: asNumber(fatture.calcolate),
          confermate: asNumber(fatture.confermate),
          totale_calcolato: asNumber(fatture.totale_calcolato),
        },
        letture: {
          total: asNumber(letture.total),
          bozze: asNumber(letture.bozze),
          chiuse: asNumber(letture.chiuse),
        },
        tariffe: {
          total: asNumber(tariffe.total),
        },
        latestPeriod: latestPeriods[0] || null,
      },
      recentActions,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ message: "Errore durante il caricamento dashboard" });
  }
};

exports.getMapData = async (req, res) => {
  const [rows] = await pool.query(`
    SELECT id, codice, nome, indirizzo, citta, latitude, longitude
    FROM condomini_v2
    WHERE stato='ATTIVO'
  `);

  res.json(rows);
};
