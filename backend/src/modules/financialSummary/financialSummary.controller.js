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
    const { condominioId, proformaIds, fatturaDate, totaleOneri, current, previous} = req.body;

  
    if (!fileId) {
      return res.status(400).json({ error: "fileId mancante" });
    }

    if (!condominioId) {
      return res.status(400).json({ error: "condominioId mancante" });
    }

    const result = await service.promoteImportedDocumentToFattura(
      fileId,
      condominioId,
      proformaIds || [],
      fatturaDate || null, 
      totaleOneri || 0,
      current || null,
      previous || null
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
async function registraPagamentoFattura(req, res) {
  try {
    const { id } = req.params;
    const {
      importo,
      paymentMethod,
      dataPagamento,
      descrizione,
    } = req.body;

    if (!id) {
      return res.status(400).json({ error: "id fattura mancante" });
    }

    const result = await service.registraPagamentoFattura(id, {
      importo,
      paymentMethod,
      dataPagamento,
      descrizione,
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error("registraPagamentoFattura error:", err);
    return res.status(500).json({
      error: err.message || "Errore durante la registrazione del pagamento.",
    });
  }
}
async function listPayments(req, res) {
  try {
    const rows = await service.listPayments();
    return res.json(rows);
  } catch (err) {
    console.error("listPayments error:", err);
    return res.status(500).json({ error: "Errore nel caricamento dei pagamenti." });
  }
}

async function getPaymentDetail(req, res) {
  try {
    const row = await service.getPaymentDetail(req.params.id);

    if (!row) {
      return res.status(404).json({ error: "Pagamento non trovato." });
    }

    return res.json(row);
  } catch (err) {
    console.error("getPaymentDetail error:", err);
    return res.status(500).json({ error: "Errore nel caricamento del dettaglio pagamento." });
  }
}

async function getImportedDocuments(req, res) {
  try {
    const result = await service.listImportedDocuments({
      page: req.query.page,
      pageSize: req.query.pageSize,
      documentType: req.query.documentType || null,
      search: req.query.search || "",
    });

    return res.json(result);
  } catch (err) {
    console.error("Errore caricando i documenti importati:", err);
    return res.status(500).json({
      error: "Errore caricando i documenti importati.",
    });
  }
}

async function createManualProforma(req, res) {
  try {
    const {
      condominioId,
      descrizione,
      dataDocumento,
      importo,
    } = req.body;

    const result = await service.createManualProforma({
      condominioId,
      descrizione,
      dataDocumento,
      importo,
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error("createManualProforma error:", err);
    return res.status(500).json({
      error: err.message || "Errore durante la creazione manuale della proforma.",
    });
  }
}

async function createManualFattura(req, res) {
  try {
    const {
      condominioId,
      descrizione,
      dataDocumento,
      importo,
      proformaIds,
    } = req.body;

    const result = await service.createManualFattura({
      condominioId,
      descrizione,
      dataDocumento,
      importo,
      proformaIds: Array.isArray(proformaIds) ? proformaIds : [],
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error("createManualFattura error:", err);
    return res.status(500).json({
      error: err.message || "Errore durante la creazione manuale della fattura.",
    });
  }
}
async function printProformaPdf(req, res) {
  try {
    const { id } = req.params;

    const pdfBuffer = await service.generateProformaPdf(id);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="proforma-${id}.pdf"`
    );

    return res.send(pdfBuffer);
  } catch (err) {
    console.error("Errore generando PDF proforma:", err);
    return res.status(500).json({
      error: err?.message || "Errore generando il PDF della proforma.",
    });
  }
}

async function printFatturaPdf(req, res) {
  try {
    const { id } = req.params;

    const pdfBuffer = await service.generateFatturaPdf(id);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="fattura-${id}.pdf"`
    );

    return res.send(pdfBuffer);
  } catch (err) {
    console.error("Errore generando PDF fattura:", err);
    return res.status(500).json({
      error: err?.message || "Errore generando il PDF della fattura.",
    });
  }
}

async function resetProformaToEmessa(req, res) {
  try {
    const { id } = req.params;

    await service.resetToEmessa(id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      error: "Errore nel reset della proforma a EMESSA",
    });
  }
}


module.exports = {
  resetProformaToEmessa,
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
  getFatturaDetail,
  registraPagamentoFattura,
  listPayments,
  getPaymentDetail,
  getImportedDocuments,
  createManualProforma,
  createManualFattura,
  printProformaPdf,
  printFatturaPdf,

};