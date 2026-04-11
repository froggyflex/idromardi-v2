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

async function uploadImportedDocumentsF(req, res) {
  try {
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: "Nessun file ricevuto." });
    }

    const result = await service.uploadImportedDocumentsF(req.files);
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
async function parseImportedDocumentF(req, res) {
  try {
    const row = await service.parseImportedDocumentF(req.params.fileId);
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

async function annullaProforma(req, res) {
  try {
    const result = await service.annullaProforma(
      req.params.id,
      req.body?.reason || "",
      null // replace with user id later
    );
    return res.json(result);
  } catch (err) {
    console.error("annullaProforma error:", err);
    return res.status(500).json({ error: err.message || "Errore durante l'annullamento della proforma." });
  }
}

async function deleteProforma(req, res) {
  try {
    const result = await service.deleteProforma(req.params.id);
    return res.json(result);
  } catch (err) {
    console.error("deleteProforma error:", err);
    return res.status(500).json({ error: err.message || "Errore durante l'eliminazione della proforma." });
  }
}

async function deleteImportedDocument(req, res) {
  try {
    const result = await service.deleteImportedDocument(req.params.id, "proforma");
    return res.json(result);
  } catch (err) {
    console.error("deleteImportedDocument error:", err);
    return res.status(500).json({ error: err.message || "Errore durante l'eliminazione del documento importato." });
  }
}

async function deleteImportedDocumentF(req, res) {
  try {
    const result = await service.deleteImportedDocumentF(req.params.id, "fattura");
    return res.json(result);
  } catch (err) {
    console.error("deleteImportedDocument error:", err);
    return res.status(500).json({ error: err.message || "Errore durante l'eliminazione del documento importato." });
  }
}


async function listProformas(req, res) {
  try {
    const rows = await service.listProformas();
    return res.json(rows);
  } catch (err) {
    console.error("listProformas error:", err);
    return res.status(500).json({ error: "Errore nel caricamento delle proforme." });
  }
}

async function collegaProformaAFattura(req, res) {
  try {
    const { id } = req.params;
    const { fatturaId } = req.body;

    if (!id) {
      return res.status(400).json({ error: "id proforma mancante" });
    }

    if (!fatturaId) {
      return res.status(400).json({ error: "fatturaId mancante" });
    }

    const result = await service.collegaSingolaProformaAFattura(id, fatturaId);

    return res.json(result);
  } catch (err) {
    console.error("❌ collegaProformaAFattura:", err);
    return res.status(500).json({
      error: err.message || "Errore durante il collegamento della proforma.",
    });
  }
}

async function collegaProformeAFattura(req, res) {
  try {
    const { id } = req.params;
    const { proformaIds } = req.body;

    if (!id) {
      return res.status(400).json({ error: "id fattura mancante" });
    }

    if (!Array.isArray(proformaIds) || proformaIds.length === 0) {
      return res.status(400).json({ error: "Seleziona almeno una proforma." });
    }

    const result = await service.collegaProformeAFatturaEsistente(
      id,
      proformaIds
    );

    return res.json(result);
  } catch (err) {
    console.error("❌ collegaProformeAFattura:", err);
    return res.status(500).json({
      error: err.message || "Errore durante il collegamento delle proforme.",
    });
  }
}

async function listFattureSimple(req, res) {
  try {
    const rows = await service.listFattureSimple();
    return res.json(rows);
  } catch (err) {
    console.error("listFattureSimple error:", err);
    return res.status(500).json({ error: "Errore nel caricamento delle fatture." });
  }
}

async function getFatturaDetail(req, res) {
  try {
    const row = await service.getFatturaDetail(req.params.id);

    if (!row) {
      return res.status(404).json({ error: "Fattura non trovata." });
    }

    return res.json(row);
  } catch (err) {
    console.error("getFatturaDetail error:", err);
    return res.status(500).json({ error: "Errore nel caricamento della fattura." });
  }
}

async function annullaFattura(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!id) {
      return res.status(400).json({ error: "id fattura mancante" });
    }

    const result = await service.annullaFattura(id, reason || "", null);

    return res.json(result);
  } catch (err) {
    console.error("annullaFattura error:", err);
    return res.status(500).json({
      error: err.message || "Errore durante l'annullamento della fattura.",
    });
  }
}

async function promoteImportedDocumentToFattura(req, res) {
  try {
    const { fileId } = req.params;
    const { condominioId, proformaIds } = req.body;

    if (!fileId) {
      return res.status(400).json({ error: "fileId mancante" });
    }

    if (!condominioId) {
      return res.status(400).json({ error: "condominioId mancante" });
    }

    const result = await service.promoteImportedDocumentToFattura(
      fileId,
      condominioId,
      proformaIds || []
    );

    return res.status(201).json(result);
  } catch (err) {
    console.error("promoteImportedDocumentToFattura:", err);

    return res.status(500).json({
      error: err.message || "Errore creazione fattura",
    });
  }
}


async function listFattureWithProforme(req, res) {
  try {
    const rows = await service.listFattureWithProforme();
    return res.json(rows);
  } catch (err) {
    console.error("listFattureWithProforme error:", err);
    return res.status(500).json({ error: "Errore nel caricamento dettaglio fatture." });
  }
}

async function getFatturaProforme(req, res) {
  try {
    const rows = await service.getFatturaProforme(req.params.id);
    return res.json(rows);
  } catch (err) {
    console.error("getFatturaProforme error:", err);
    return res.status(500).json({ error: "Errore nel caricamento delle proforme associate." });
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
  annullaProforma,
  deleteProforma,
  deleteImportedDocument,
  deleteImportedDocumentF,
  listProformas,
  collegaProformaAFattura,
  collegaProformeAFattura,
  listFattureSimple,
  promoteImportedDocumentToFattura,
  listFattureWithProforme,
  getFatturaProforme,
  uploadImportedDocumentsF,
  parseImportedDocumentF,
  annullaFattura,
  getFatturaDetail

};