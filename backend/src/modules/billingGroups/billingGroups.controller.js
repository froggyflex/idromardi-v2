const service = require("./billingGroups.service");

async function getByCondominio(req, res) {
  try {
    const { condominioId } = req.params;

    if (!condominioId) {
      return res.status(400).json({ error: "Missing condominioId" });
    }

    const data = await service.getByCondominio(condominioId);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}

async function create(req, res) {
  try {
    const { condominioId } = req.params;
    const { nome } = req.body;

    if (!nome || !nome.trim()) {
      return res.status(400).json({ error: "Nome required" });
    }

    const data = await service.create(condominioId, nome.trim());
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}

async function remove(req, res) {
  try {
    const { id } = req.params;

    await service.remove(id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);

    if (err.message.includes("used")) {
      return res.status(400).json({ error: err.message });
    }

    res.status(500).json({ error: "Server error" });
  }
}

module.exports = {
  getByCondominio,
  create,
  remove,
};