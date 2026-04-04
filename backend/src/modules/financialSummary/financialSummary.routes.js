const express = require("express");
const router = express.Router();
const controller = require("./financialSummary.controller");
const uploadPdf = require("../../config/multerPdf");

console.log("UPLOAD TYPE:", typeof uploadPdf);
console.log("UPLOAD VALUE:", uploadPdf);
router.get("/", controller.getSummary);
router.get("/recent", controller.getRecentRows);

router.get("/imported-documents", controller.listImportedDocuments);
router.get("/imported-documents/:id", controller.getImportedDocumentDetail);
router.post(
  "/imported-documents/upload",
  uploadPdf.array("files", 20),
  controller.uploadImportedDocuments
);
router.post("/imported-documents/:fileId/parse", controller.parseImportedDocument);
router.post("/imported-documents/:fileId/promote", controller.promoteImportedDocumentToProforma);
router.get("/search", controller.searchCondomini);
router.get("/list", controller.listCondominiSimple);

router.post("/:id/collega-fattura", controller.collegaProformaAFattura);
router.get("/proformas", controller.listProformas);
router.get("/fatture", controller.listFattureSimple);

router.post("/:id/annulla", controller.annullaProforma);
router.delete("/:id", controller.deleteProforma);

module.exports = router;