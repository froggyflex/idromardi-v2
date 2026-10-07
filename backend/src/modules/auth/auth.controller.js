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
      mustChangePassword: Boolean(req.user?.mustChangePassword),
      ...(req.user?.impersonation ? { impersonation: req.user.impersonation } : {}),
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
  if (req.user?.impersonation) return res.status(403).json({ error: "Il cambio password non è disponibile durante l'assistenza" });
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

exports.updateAssignments = async (req, res, next) => {
  try { res.json(await service.updateAssignments(req.params.id, req.body?.condominioIds)); } catch (error) { next(error); }
};
exports.listAssignableCondomini = async (req, res, next) => {
  try { res.json(await service.listAssignableCondomini()); } catch (error) { next(error); }
};
exports.startImpersonation = async (req, res, next) => {
  try { res.json(await service.startImpersonation(req.user, req.params.id)); } catch (error) { next(error); }
};
exports.endImpersonation = async (req, res, next) => {
  try { res.json(await service.endImpersonation(req.user)); } catch (error) { next(error); }
};
