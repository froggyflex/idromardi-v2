const express = require("express");
const cors = require("cors");
const path = require("path");

const lettureRoutes = require("./modules/letture/letture.routes");
const condominiRoutes = require("./modules/condomini/condomini.routes");
const utenzeRoutes = require("./modules/utenze/utenze.routes");
const tariffeRoutes = require("./modules/tariffe/tariffe.routes");
const fattureRoutes = require("./modules/fatture/fatture.routes");
const billingGroupsRoutes = require("./modules/billingGroups/billingGroups.routes");
const prospettoRoutes = require("./modules/prospetti/prospetti.routes");
const financialSummaryRoutes = require("./modules/financialSummary/financialSummary.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");
const adminRoutes = require("./modules/admin/admin.routes");
const authRoutes = require("./modules/auth/auth.routes");
const mobileReadingsRoutes = require("./modules/mobileReadings/mobileReadings.routes");
const metaRoutes = require("./modules/meta/meta.routes");
const { requireAuth } = require("./modules/auth/auth.middleware");

const app = express();

const allowedOrigins = [
  "https://idromardi-v2.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "https://manage.idromardi.it"
];

const corsOptions = {
  origin(origin, callback) {
    // Allow requests with no origin (Postman, curl, server-to-server, direct browser hits)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Photo-Sha256", "X-Hub-Signature-256"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(
  express.json({
    verify(req, res, buffer) {
      // Meta signs the exact bytes sent. Preserve them before JSON parsing.
      if (req.originalUrl.startsWith("/api/meta/webhook")) {
        req.rawBody = Buffer.from(buffer);
      }
    },
  })
);
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    message: "Idromardi v2 API is running",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "idromardi-v2-api",
  });
});

// Keep any legacy meter-photo paths private even if an older deployment wrote
// files below the otherwise public uploads directory.
app.use("/uploads/mobile-readings", (req, res) => res.status(404).end());
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/meta", (req,res,next) => {
  if (app.locals.metaReady === false) return res.status(503).set("Retry-After","30").json({error:"Area Meta in avvio. Riprova tra poco.",code:"META_STARTING"});
  next();
});
// Public only for Meta's challenge and signed webhook delivery. The controller
// rejects unsigned POST requests before any payload is persisted.
app.use("/api/meta", metaRoutes.publicRouter);
app.use("/api", requireAuth);

app.use("/api/condomini", condominiRoutes);
app.use("/api", utenzeRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/letture", lettureRoutes);
app.use("/api/mobile-readings", mobileReadingsRoutes);
app.use("/api/tariffe", tariffeRoutes);
app.use("/api", billingGroupsRoutes);
app.use("/api", prospettoRoutes);
app.use("/api/fatture", fattureRoutes);
app.use("/api/financial-summary", financialSummaryRoutes);
app.use("/api/meta", metaRoutes.protectedRouter);
app.use("/images", express.static(path.join(__dirname, "../public/images")));
// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  if (err.message && err.message.startsWith("CORS blocked")) {
    return res.status(403).json({
      message: err.message,
    });
  }

  return res.status(err.statusCode || err.status || 500).json({
    error: err.message || "Internal server error",
  });
});

module.exports = app;
