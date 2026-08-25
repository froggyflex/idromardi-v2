require("dotenv").config();
const app = require("./src/app");
const { runMobileMigrationWithRetry } = require("./scripts/run-mobile-migration");
const { runMetaMigrationWithRetry } = require("./scripts/run-meta-migration");
const metaService = require("./src/modules/meta/meta.service");

const PORT = process.env.PORT || 4000;

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
  process.exit(1);
});

function startServer() {
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });

  if (String(process.env.RUN_MOBILE_MIGRATION_ON_STARTUP || "true").toLowerCase() !== "false") {
    runMobileMigrationWithRetry().catch((error) => {
      console.error(
        "MOBILE MIGRATION FAILED AFTER RETRIES; SERVER REMAINS ONLINE:",
        error
      );
    });
  } else {
    console.log("Mobile migration on startup disabled by configuration.");
  }

  if (String(process.env.RUN_META_MIGRATION_ON_STARTUP || "true").toLowerCase() !== "false") {
    runMetaMigrationWithRetry().catch((error) => {
      console.error("META MIGRATION FAILED AFTER RETRIES; SERVER REMAINS ONLINE:", error);
    });
  } else {
    console.log("Meta migration on startup disabled by configuration.");
  }

  if (String(process.env.META_OUTBOX_WORKER_ENABLED || "false").toLowerCase() === "true") {
    let workerRunning = false;
    const intervalMs = Math.max(1000, Number(process.env.META_OUTBOX_INTERVAL_MS || 5000));
    const timer = setInterval(async () => {
      if (workerRunning) return;
      workerRunning = true;
      try {
        await Promise.all([
          metaService.processNextOutbound(),
          metaService.processNextLead(),
        ]);
      } catch (error) {
        console.error("META OUTBOX WORKER ERROR:", error.message || error);
      } finally {
        workerRunning = false;
      }
    }, intervalMs);
    timer.unref();
    console.log(`Meta outbox worker enabled (${intervalMs}ms).`);
  }

  return server;
}

startServer();
