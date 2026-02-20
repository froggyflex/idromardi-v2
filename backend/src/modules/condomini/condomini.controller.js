const service = require("./condomini.service");
const pool = require("../../config/db");

exports.getAll = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || "";

    const result = await service.getAll(page, limit, search);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.checkCodice = async (req, res) => {
  const codice = parseInt(req.params.codice);

  const [[row]] = await pool.query(
    "SELECT COUNT(*) as count FROM condomini_v2 WHERE codice = ?",
    [codice]
  );

  res.json({ exists: row.count > 0 });
};

exports.getNextCodice = async (req, res) => {
  const [[row]] = await pool.query(
    "SELECT MAX(codice) as last FROM condomini_v2"
  );

  const nextCodice = (row.last || 0) + 1;

  res.json({ nextCodice });
};

exports.create = async (req, res) => {
  try {
    const result = await service.create(req.body);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore creazione condominio" });
  }
};

exports.uploadImage = async (req, res) => {
  const condominioId = req.params.id;

  if (!req.file) {
    return res.status(400).json({ error: "Nessun file caricato" });
  }

  const imagePath = `/uploads/condomini/${req.file.filename}`;

  await service.updateImage(condominioId, imagePath);

  res.json({ success: true, image_url: imagePath });
};

exports.getContatti = async (req, res) => {
  const data = await service.getContatti(req.params.id);
  res.json(data);
};

exports.createContatto = async (req, res) => {
  const result = await service.createContatto(req.params.id, req.body);
  res.json(result);
};

exports.updateContatto = async (req, res) => {
  const result = await service.updateContatto(
    req.params.contattoId,
    req.body
  );
  res.json(result);
};

exports.deleteContatto = async (req, res) => {
  await service.deleteContatto(req.params.contattoId);
  res.json({ success: true });
};


exports.getById = async (req, res) => {
  try {
    const data = await service.getById(req.params.id);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const result = await service.update(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};
