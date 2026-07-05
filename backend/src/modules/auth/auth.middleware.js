const { verifyToken } = require("./auth.service");

function extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }

  return req.query?.authToken || null;
}

function requireAuth(req, res, next) {
  if (req.method === "OPTIONS") return next();

  const token = extractToken(req);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: "Accesso non autorizzato" });
  }

  req.user = payload;
  return next();
}

module.exports = {
  requireAuth,
};
