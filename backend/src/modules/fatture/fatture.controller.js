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
   
    const result = await service.calculateSession({ sessionId: req.params.id });
        
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
