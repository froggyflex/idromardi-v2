const { authenticateToken } = require("./auth.service");

function extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }

  return req.query?.authToken || null;
}

async function requireAuth(req, res, next) {
  if (req.method === "OPTIONS") return next();

  const token = extractToken(req);
  let payload;
  try { payload = await authenticateToken(token); } catch (error) { return next(error); }

  if (!payload) {
    return res.status(401).json({ error: "Accesso non autorizzato" });
  }

  req.user = payload;
  const route = req.originalUrl.split("?")[0].replace(/\/$/, "");
  if (payload.mustChangePassword && !payload.impersonation && !["/api/auth/me", "/api/auth/change-password"].includes(route)) {
    return res.status(403).json({ error: "Cambia la password temporanea per continuare", code: "PASSWORD_CHANGE_REQUIRED" });
  }
  return next();
}

function restrictAmministratore(req, res, next) {
  if (req.user?.role === "AMMINISTRATORE" && !req.path.startsWith("/amministratore/")) {
    return res.status(403).json({ error: "Accesso riservato agli operatori" });
  }
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

function protectUploadedDocuments(req, res, next) {
  // Public building images/logos can still be embedded without a session.
  // Financial files must use operator access or a scoped portal PDF endpoint.
  if (/\.(?:png|jpe?g|gif|webp|svg|ico|avif)$/i.test(req.path)) return next();
  return requireAuth(req, res, () => requireRole("ADMIN", "REVIEWER")(req, res, next));
}

module.exports = {
  requireAuth,
  requireRole,
  restrictAmministratore,
  protectUploadedDocuments,
};
