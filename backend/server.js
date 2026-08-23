require("dotenv").config();
const app = require("./src/app");
const { runMobileMigrationWithRetry } = require("./scripts/run-mobile-migration");

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

  return server;
}

startServer();
