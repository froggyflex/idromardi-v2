const utenzeService = require("./utenze.service");

exports.getByCondominio = async (req, res) => {
  try {
    const data = await utenzeService.getByCondominio(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const id = await utenzeService.create(req.params.id, req.body);
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.batchUpdate = async (req, res) => {
  try {
    await utenzeService.batchUpdate(req.params.id, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await utenzeService.remove(req.params.id, req.body.resequence);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.getNextIdUser = async (req, res) => {
  try {
    const condominioId = req.params.id;
    const nextId = await utenzeService.getNextIdUser(condominioId);
    res.json({ nextId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
