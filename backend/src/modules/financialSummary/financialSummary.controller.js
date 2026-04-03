const service = require("./financialSummary.service");

async function getSummary(req, res) {
  try {
    const summary = await service.getSummary();
    return res.json({ summary });
  } catch (err) {
    console.error("financialSummary.getSummary error:", err);
    return res.status(500).json({ error: "Errore nel caricamento del riepilogo." });
  }
}

async function getRecentRows(req, res) {
  try {
    const rows = await service.getRecentRows();
    return res.json({ rows });
  } catch (err) {
    console.error("financialSummary.getRecentRows error:", err);
    return res.status(500).json({ error: "Errore nel caricamento dei movimenti recenti." });
  }
}

async function listImportedDocuments(req, res) {
  try {
    const rows = await service.listImportedDocuments();
    return res.json(rows);
  } catch (err) {
    console.error("listImportedDocuments error:", err);
    return res.status(500).json({ error: "Errore nel caricamento dei documenti importati." });
  }
}

async function getImportedDocumentDetail(req, res) {
  try {
    const row = await service.getImportedDocumentDetail(req.params.id);
    if (!row) {
      return res.status(404).json({ error: "Documento non trovato." });
    }
    return res.json(row);
  } catch (err) {
    console.error("getImportedDocumentDetail error:", err);
    return res.status(500).json({ error: "Errore nel caricamento del dettaglio documento." });
  }
}

async function uploadImportedDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "File mancante." });
    }

    const row = await service.uploadImportedDocument(req.file);
    return res.status(201).json(row);
  } catch (err) {
    console.error("uploadImportedDocument error:", err);
    return res.status(500).json({ error: "Errore durante il caricamento del file." });
  }
}
 
 async function searchCondomini(req, res){
  try {
    const rows = await service.searchCondomini(req.query.q || "");
    return res.json(rows);
  } catch (err) {
    console.error("searchCondomini error:", err);
    return res.status(500).json({ error: "Errore nella ricerca condomini." });
  }
}
async function listCondominiSimple(req, res) {
  try {
    const rows = await service.listCondominiSimple();
    return res.json(rows);
  } catch (err) {
    console.error("listCondominiSimple error:", err);
    return res.status(500).json({ error: "Errore nel caricamento dei condomini." });
  }
}

async function uploadImportedDocuments(req, res) {
  try {
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: "Nessun file ricevuto." });
    }

    const result = await service.uploadImportedDocuments(req.files);
    return res.status(201).json(result);
  } catch (err) {
    console.error("uploadImportedDocuments error:", err);
    return res.status(500).json({ error: "Errore durante il caricamento dei file." });
  }
}

async function parseImportedDocument(req, res) {
  try {
    const row = await service.parseImportedDocument(req.params.fileId);
    return res.json(row);
  } catch (err) {
    console.error("parseImportedDocument error:", err);
    return res.status(500).json({ error: err.message || "Errore parsing proforma." });
  }
}

async function promoteImportedDocumentToProforma(req, res) {
  try {
    const result = await service.promoteImportedDocumentToProforma(
      req.params.fileId,
      req.body?.condominioIds || []
    );

    return res.status(201).json(result);
  } catch (err) {
    console.error("promoteImportedDocumentToProforma error:", err);
    return res.status(500).json({
      error: err.message || "Errore durante la creazione delle proforme.",
    });
  }
}

module.exports = {
  getSummary,
  getRecentRows,
  listImportedDocuments,
  getImportedDocumentDetail,
  uploadImportedDocument,
  parseImportedDocument,
  uploadImportedDocuments,
  promoteImportedDocumentToProforma,
  searchCondomini,
  listCondominiSimple,
};