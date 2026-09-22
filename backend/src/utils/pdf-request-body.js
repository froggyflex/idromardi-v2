const express = require("express");

const PDF_EXPORT_PATHS = [
  "/api/fatture/export-ripartizione-pdf",
  "/api/fatture/export-ripartizione-pdf/start",
];
const parsePdfExportJson = express.json({ limit: "5mb" });

module.exports = { PDF_EXPORT_PATHS, parsePdfExportJson };
