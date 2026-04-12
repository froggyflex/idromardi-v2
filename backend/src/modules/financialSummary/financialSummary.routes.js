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
router.delete("/imported-documents/fattura/:id", controller.deleteImportedDocumentF);
router.delete("/imported-documents/proforma/:id", controller.deleteImportedDocument);

router.post(
  "/imported-documents/upload",
  uploadPdf.array("files", 20),
  
  controller.uploadImportedDocuments
);
router.post(
  "/imported-documents/uploadf",
  uploadPdf.array("files", 20),
  
  controller.uploadImportedDocumentsF
);
router.post("/imported-documents/:fileId/parse", controller.parseImportedDocument);

router.post("/imported-documents/:fileId/parsef", controller.parseImportedDocumentF);
router.post("/imported-documents/:fileId/promote", controller.promoteImportedDocumentToProforma);
router.post("/imported-documents/:fileId/promotef", controller.promoteImportedDocumentToFattura);
router.get("/fatture/:id", controller.getFatturaDetail);

router.get("/search", controller.searchCondomini);
router.get("/list", controller.listCondominiSimple);

router.post("/:id/collega-fattura", controller.collegaProformaAFattura);
router.post("/:id/collega-proforme", controller.collegaProformeAFattura);

router.get("/proformas", controller.listProformas);
router.get("/fatture", controller.listFattureSimple);


router.post("/:id/annulla", controller.annullaProforma);
router.post("/:id/annullaF", controller.annullaFattura);
router.delete("/:id", controller.deleteProforma);

 
router.post("/:id/registra-pagamento", controller.registraPagamentoFattura);
router.get("/payments", controller.listPayments);
router.get("/payments/:id", controller.getPaymentDetail);


module.exports = router;