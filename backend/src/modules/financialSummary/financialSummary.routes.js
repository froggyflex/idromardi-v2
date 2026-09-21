const express = require("express");
const router = express.Router();
const controller = require("./financialSummary.controller");
const uploadPdf = require("../../config/multerPdf");

function requireDocumentNumberingReady(req, res, next) {
  if (req.app.locals.documentNumberingReady === false) {
    return res.status(503).json({
      error:
        "Aggiornamento delle numerazioni in corso. Riprova tra qualche secondo.",
      code: "DOCUMENT_NUMBERING_NOT_READY",
    });
  }
  return next();
}

 
router.get("/", controller.getSummary);
router.get("/recent", controller.getRecentRows);
router.get("/document-counters", controller.listDocumentNumberCounters);
router.put(
  "/document-counters/:documentType/:anno",
  requireDocumentNumberingReady,
  controller.updateDocumentNumberCounter
);

router.get("/imported-documents", controller.getImportedDocuments);
router.get("/imported-documents/:id", controller.getImportedDocumentDetail);


router.post(
  "/manual-proforma",
  requireDocumentNumberingReady,
  controller.createManualProforma
);
router.post(
  "/manual-fattura",
  requireDocumentNumberingReady,
  controller.createManualFattura
);
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
router.post(
  "/imported-documents/:fileId/promote",
  requireDocumentNumberingReady,
  controller.promoteImportedDocumentToProforma
);
router.post(
  "/imported-documents/:fileId/promotef",
  requireDocumentNumberingReady,
  controller.promoteImportedDocumentToFattura
);
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
router.delete("/imported-documents/fattura/:id", controller.deleteImportedDocumentF);
router.delete("/imported-documents/proforma/:id", controller.deleteImportedDocument);

 
router.post(
  "/:id/registra-pagamento",
  requireDocumentNumberingReady,
  controller.registraPagamentoFattura
);
router.get("/payments", controller.listPayments);
router.get("/payments/:id", controller.getPaymentDetail);
router.patch("/payments/:id/description", controller.updatePaymentDescription);
router.get("/proforme/:id/print",controller.printProformaPdf);
router.get("/fatture/:id/print",controller.printFatturaPdf);

router.put("/proforme/:id/reset-to-emessa",controller.resetProformaToEmessa);
 


module.exports = router;
