const service = require("./fatture.service");

exports.createOrLoadSession = async (req, res) => {
  try {
    const result = await service.createOrLoadSession(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.calculateGenerale = async (req, res) => {
  try {
    const sessionId = req.params.id;
    const out = await service.calculateGenerale({ sessionId });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message || "Errore" });
  }
};

exports.getSessionDetail = async (req, res) => {
 
  try {
    const { condominioId, id } = req.params;

    const result = await service.getSessionDetail({
      sessionId: id,
      condominioId,
    });

     
    res.json(result);
  } catch (err) {
    if (err.message === "Session not found") {
      return res.status(404).json({ error: "Session not found" });
    }
    res.status(500).json({ error: err.message });
  }
};
exports.recalculate = async (req, res) => {
  try {
    const { fatturaId } = req.params;
    const { giorniAcconto, mcAcconto } = req.body;

    const result = await service.recalculateSession(
      fatturaId,
      { giorniAcconto, mcAcconto }
    );

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
exports.updateSessionParams = async (req, res) => {
  try {
    console.log("updateSessionParams", { sessionId: req.params.id, body: req.body });
    const result = await service.updateSessionParams({
      sessionId: req.params.id,
      ...req.body,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.calculateSession = async (req, res) => {
  try {
   
    const result = await service.calculateSession({ sessionId: req.params.id, tfCode: req.body?.tfCode });
        
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
exports.getByCondominio = async (req, res) => {
  try {
    const result = await service.getByCondominio({
      condominioId: req.params.id,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
exports.getAvailablePeriods = async (req, res) => {
  try {
    const result = await service.getAvailablePeriods({
      condominioId: req.params.condominioId,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
exports.getProviders = async (req, res) => {
  try {
    const result = await service.getProviders();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.updateContatoreGenerale = async (req, res) => {
  try {
    const result = await service.updateContatoreGenerale({
      sessionId: req.params.id,
      precedente: req.body.precedente,
      attuale: req.body.attuale,
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
exports.deleteSession = async (req, res) => {
  try {
    const result = await service.deleteSession({
      sessionId: req.params.id,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};


exports.uploadImportedDocument = async (req, res) => {
  try {
    console.log("uploadImportedDocument start");
    console.log("file =", req.file ? {
      originalname: req.file.originalname,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
    } : null);
    console.log("body =", req.body);

    const result = await service.uploadImportedDocument({
      file: req.file,
      body: req.body,
    });

    res.status(201).json(result);
  } catch (err) {
    console.error("uploadImportedDocument error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.parseImportedDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await service.parseImportedDocument(id);
    res.json(result);
  } catch (err) {
    console.error("parseImportedDocument error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.createImportedDocument = async (req, res) => {
  try {
    const result = await service.createImportedDocument(req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error("createImportedDocument error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.listImportedDocumentsByCondominio = async (req, res) => {
  try {
    const { condominioId } = req.params;
    const result = await service.listImportedDocumentsByCondominio(condominioId);
    res.json(result);
  } catch (err) {
    console.error("listImportedDocumentsByCondominio error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.getImportedDocumentById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await service.getImportedDocumentById(id);
    res.json(result);
  } catch (err) {
    console.error("getImportedDocumentById error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.updateImportedDocumentParsedResult = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await service.updateImportedDocumentParsedResult(id, req.body);
    res.json(result);
  } catch (err) {
    console.error("updateImportedDocumentParsedResult error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.linkImportedDocumentToSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { sessionId } = req.body;
    const result = await service.linkImportedDocumentToSession(id, sessionId);
    res.json(result);
  } catch (err) {
    console.error("linkImportedDocumentToSession error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};