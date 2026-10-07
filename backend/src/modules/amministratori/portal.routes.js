const express = require("express");
const db = require("../../config/db");
const { requireRole } = require("../auth/auth.middleware");
const fatture = require("../fatture/fatture.controller");
const router = express.Router();
router.use(requireRole("AMMINISTRATORE"));

router.get("/condomini", async (req, res, next) => {
  try {
    const [condomini] = await db.query(`
      SELECT c.id, c.codice, c.nome, c.indirizzo, c.citta, c.cap, c.stato
      FROM condomini_v2 c JOIN app_amministratore_condomini a ON a.condominio_id = c.id
      WHERE a.user_id = ? AND c.deleted_at IS NULL ORDER BY c.nome`, [req.user.sub]);
    res.json({ condomini });
  } catch (error) { next(error); }
});

async function requireAssignedCondominio(req, res, next) {
  try {
    const [[condominio]] = await db.query(`
      SELECT c.id, c.codice, c.nome, c.indirizzo, c.citta, c.cap, c.stato
      FROM condomini_v2 c JOIN app_amministratore_condomini a ON a.condominio_id = c.id
      WHERE a.user_id = ? AND c.id = ? AND c.deleted_at IS NULL`, [req.user.sub, req.params.condominioId]);
    if (!condominio) return res.status(404).json({ error: "Condominio non trovato" });
    req.condominio = condominio;
    next();
  } catch (error) { next(error); }
}

router.get("/condomini/:condominioId/documents", requireAssignedCondominio, async (req, res, next) => {
  try {
    // Older archives do not all have the same optional metadata columns.
    const [columns] = await db.query(`SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('generated_documents', 'ripartizione_pdfs')`);
    const has = (table, column) => columns.some(row => row.TABLE_NAME === table && row.COLUMN_NAME === column);
    const [generated] = await db.query(`SELECT id, fattura_id, document_type, filename, created_at,
      ${has("generated_documents", "period_label") ? "period_label" : "NULL AS period_label"},
      ${has("generated_documents", "metadata_json") ? "metadata_json" : "NULL AS metadata_json"}
      FROM generated_documents WHERE condominio_id = ?
      AND document_type IN ('prospetto', 'prospetto_bw', 'bollette_complete') ORDER BY created_at DESC`, [req.condominio.id]);
    const [bollette] = await db.query(`SELECT r.id, r.filename, r.period_key, r.trimestre_label AS period_label, r.created_at,
      ${has("ripartizione_pdfs", "id_fattura") ? "r.id_fattura AS fattura_id" : "NULL AS fattura_id"},
      NULLIF(CONCAT_WS(' ', NULLIF(TRIM(u.Nome), ''), NULLIF(TRIM(u.Cognome), '')), '') AS recipient_name,
      u.Interno AS interno, u.Scala AS scala
      FROM ripartizione_pdfs r LEFT JOIN utenze_v2 u ON u.id = r.id_utenza AND u.condominio_id = r.condominio_id
      WHERE r.condominio_id = ? ORDER BY r.created_at DESC`, [req.condominio.id]);
    const [periods] = await db.query(`SELECT fs.id, p.period_year, p.period_month
      FROM fatture_sessioni fs LEFT JOIN letture_sessioni p ON p.id = fs.id_periodo_attuale
      WHERE fs.id_condominio = ?`, [req.condominio.id]);
    const withPeriod = doc => {
      const period = periods.find(row => row.id === doc.fattura_id);
      let metadata = doc.metadata_json || {};
      if (typeof metadata === "string") {
        try { metadata = JSON.parse(metadata) || {}; } catch { metadata = {}; }
      }
      const { metadata_json, fattura_id, ...publicDocument } = doc;
      return {
        ...publicDocument,
        period_label: doc.period_label || metadata.periodLabel || metadata.trimestreLabel || null,
        period_key: period?.period_year && period?.period_month
          ? `${period.period_year}-${String(period.period_month).padStart(2, "0")}`
          : doc.period_key || metadata.periodKey || null,
        period_year: period?.period_year || null,
        period_month: period?.period_month || null,
      };
    };
    res.json({ condominio: req.condominio, documents: [
      ...generated.map(doc => ({ ...withPeriod(doc), source: "generated" })),
      ...bollette.map(doc => ({ ...withPeriod(doc), document_type: "bolletta", source: "bolletta" })),
    ] });
  } catch (error) { next(error); }
});

router.get("/condomini/:condominioId/documents/:source/:id/view", requireAssignedCondominio, async (req, res, next) => {
  try {
    const generated = req.params.source === "generated";
    if (!generated && req.params.source !== "bolletta") return res.status(404).json({ error: "Documento non trovato" });
    const [[document]] = await db.query(generated
      ? "SELECT id FROM generated_documents WHERE id = ? AND condominio_id = ? AND document_type IN ('prospetto', 'prospetto_bw', 'bollette_complete')"
      : "SELECT id FROM ripartizione_pdfs WHERE id = ? AND condominio_id = ?", [req.params.id, req.condominio.id]);
    if (!document) return res.status(404).json({ error: "Documento non trovato" });
    // Ignore client filters. Only the assigned condominium can supply this PDF.
    Object.defineProperty(req, "query", { value: { condominioId: req.condominio.id }, configurable: true });
    res.setHeader("Cache-Control", "private, no-store");
    return generated ? fatture.viewGeneratedDocument(req, res, next) : fatture.viewRipartizionePdf(req, res, next);
  } catch (error) { next(error); }
});

module.exports = router;
