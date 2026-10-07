require("dotenv").config();
const db = require("../src/config/db");
const { ensureAuthTable } = require("../src/modules/auth/auth.service");

ensureAuthTable()
  .then(() => console.log("Amministratore account schema is ready."))
  .catch(error => { console.error("Amministratore migration failed:", error.message); process.exitCode = 1; })
  .finally(() => db.end());
