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
    const [generated] = await db.query(`SELECT id, document_type, filename, created_at
      FROM generated_documents WHERE condominio_id = ?
      AND document_type IN ('prospetto', 'prospetto_bw', 'bollette_complete') ORDER BY created_at DESC`, [req.condominio.id]);
    const [bollette] = await db.query(`SELECT id, filename, trimestre_label AS period_label, created_at
      FROM ripartizione_pdfs WHERE condominio_id = ? ORDER BY created_at DESC`, [req.condominio.id]);
    res.json({ condominio: req.condominio, documents: [
      ...generated.map(doc => ({ ...doc, source: "generated" })),
      ...bollette.map(doc => ({ ...doc, document_type: "bolletta", source: "bolletta" })),
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
