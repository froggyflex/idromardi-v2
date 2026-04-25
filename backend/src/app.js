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

const app = express();

const allowedOrigins = [
  "https://idromardi-v2.vercel.app",
  "http://localhost:5173",
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
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(express.json());
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

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.use("/api/condomini", condominiRoutes);
app.use("/api", utenzeRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/letture", lettureRoutes);
app.use("/api/tariffe", tariffeRoutes);
app.use("/api", billingGroupsRoutes);
app.use("/api", prospettoRoutes);
app.use("/api/fatture", fattureRoutes);
app.use("/api/financial-summary", financialSummaryRoutes);
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

  return res.status(err.status || 500).json({
    message: err.message || "Internal server error",
  });
});

module.exports = app;