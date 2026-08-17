require("dotenv").config();
const app = require("./src/app");
const { runMobileMigration } = require("./scripts/run-mobile-migration");

const PORT = process.env.PORT || 4000;

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
  process.exit(1);
});

async function startServer() {
  await runMobileMigration();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("SERVER STARTUP FAILED:", error);
  process.exit(1);
});
