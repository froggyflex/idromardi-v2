const express = require("express");
const router = express.Router();
const controller = require("./prospetti.controller");

// PDF for a condominio + periodo/sessione
router.get(
  "/condomini/:condominioId/prospetto/:periodoId/pdf",
  controller.downloadPdf
);

// GET PDF for session (fattura)
router.get("/fatture/:fatturaId/prospetto.pdf", controller.downloadPdf);
router.post("/fatture/:fatturaId/prospetto/generate", controller.generatePdf);
router.get("/prospetti/documents/:id/print", controller.printGeneratedPdf);

module.exports = router;
