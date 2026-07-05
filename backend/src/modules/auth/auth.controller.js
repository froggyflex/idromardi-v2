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
    },
  });
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
