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

function requireRole(...allowedRoles) {
  const allowed = new Set(allowedRoles.map((role) => String(role).toUpperCase()));
  return (req, res, next) => {
    const fallbackRole = req.user?.username === "admin" ? "ADMIN" : null;
    const role = String(req.user?.role || fallbackRole || "").toUpperCase();
    if (!allowed.has(role)) {
      return res.status(403).json({ error: "Permessi insufficienti" });
    }
    return next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
};
