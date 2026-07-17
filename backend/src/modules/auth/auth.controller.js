const service = require("./auth.service");

exports.login = async (req, res) => {
  try {
    const result = await service.login(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || "Errore login" });
  }
};

exports.me = async (req, res) => {
  res.json({
    user: {
      username: req.user?.username || "admin",
      id: req.user?.sub || null,
      role: req.user?.role || (req.user?.username === "admin" ? "ADMIN" : null),
    },
  });
};

exports.listUsers = async (req, res) => {
  try {
    res.json(await service.listUsers());
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || "Errore utenti" });
  }
};

exports.createUser = async (req, res) => {
  try {
    const result = await service.createUser(req.body || {});
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || "Errore creazione utente" });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const result = await service.changePassword({
      username: req.user?.username || "admin",
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword,
    });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || "Errore cambio password" });
  }
};
