const express = require("express");
const router = express.Router();
const controller = require("./fatture.controller");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(process.cwd(), "..", "runtime_uploads", "fatture-import");

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

router.post("/sessioni", controller.createOrLoadSession);
router.get( "/condomini/:condominioId/fatture/:id", controller.getSessionDetail);
router.put("/sessioni/:id/parametri", controller.updateSessionParams);
router.post("/sessioni/:id/calcola", controller.calculateSession);
router.get("/condominio/:id", controller.getByCondominio);
router.get("/periodi/:condominioId", controller.getAvailablePeriods);
router.get("/providers", controller.getProviders);
router.put("/sessioni/:id/contatore-generale",controller.updateContatoreGenerale);
router.delete("/sessioni/:id", controller.deleteSession);
 

router.post("/imported-documents/upload", upload.single("file"), controller.uploadImportedDocument);

router.post("/imported-documents", controller.createImportedDocument);
router.get("/imported-documents/condominio/:condominioId", controller.listImportedDocumentsByCondominio);
router.get("/imported-documents/:id", controller.getImportedDocumentById);

router.post("/imported-documents/:id/parse", controller.parseImportedDocument);
router.put("/imported-documents/:id/parsed-result", controller.updateImportedDocumentParsedResult);
router.post("/imported-documents/:id/link-session", controller.linkImportedDocumentToSession);
router.post("/export-ripartizione-pdf",controller.exportRipartizionePdf);
router.get("/ripartizione-pdfs", controller.listRipartizionePdfs);

router.get(
  "/ripartizione-pdfs/:id/view",
  controller.viewRipartizionePdf
)
router.get(
  "/ripartizione-pdfs/period/:periodKey/view-all",
  controller.viewRipartizionePdfPeriod
);



module.exports = router;
