const service = require("./fatture.service");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { PDFDocument } = require("pdf-lib");


exports.viewRipartizionePdfPeriod = async (req, res, next) => {
  try {
    const { periodKey } = req.params;

    const pdfs = await service.getRipartizionePdfsByPeriod(periodKey);

    if (!pdfs.length) {
      return res.status(404).json({ error: "Nessun PDF trovato per questo periodo." });
    }

    const mergedPdf = await PDFDocument.create();

    for (const pdf of pdfs) {
      const absolutePath = path.join(
        process.cwd(),
        pdf.filepath.replace(/^\/+/, "")
      );

      const fileBuffer = await fsp.readFile(absolutePath);
      const sourcePdf = await PDFDocument.load(fileBuffer);
      const copiedPages = await mergedPdf.copyPages(
        sourcePdf,
        sourcePdf.getPageIndices()
      );

      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    const mergedBytes = await mergedPdf.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="ripartizioni_${periodKey}.pdf"`
    );

    return res.send(Buffer.from(mergedBytes));
  } catch (error) {
    next(error);
  }
};


exports.createOrLoadSession = async (req, res) => {
  try {
    const result = await service.createOrLoadSession(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.calculateGenerale = async (req, res) => {
  try {
    const sessionId = req.params.id;
    const out = await service.calculateGenerale({ sessionId });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message || "Errore" });
  }
};

exports.getSessionDetail = async (req, res) => {
 
  try {
    const { condominioId, id } = req.params;

    const result = await service.getSessionDetail({
      sessionId: id,
      condominioId,
    });

     
    res.json(result);
  } catch (err) {
    if (err.message === "Session not found") {
      return res.status(404).json({ error: "Session not found" });
    }
    res.status(500).json({ error: err.message });
  }
};
 
exports.updateSessionParams = async (req, res) => {
  try {
    console.log("updateSessionParams", { sessionId: req.params.id, body: req.body });
    const result = await service.updateSessionParams({
      sessionId: req.params.id,
      ...req.body,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.calculateSession = async (req, res) => {
  try {
   
    const result = await service.calculateSession({ sessionId: req.params.id, 
      tfCode: req.body?.tfCode, 
      annoAtt: req.body?.annoTariffa,
      eurStorno: req.body?.eurStorno,
      parsedQF: req.body?.parsedQF,
      totaleParsedWithOneri: req.body?.totaleParsedWithOneri
     });
        
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
exports.getByCondominio = async (req, res) => {
  try {
    const result = await service.getByCondominio({
      condominioId: req.params.id,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
exports.getAvailablePeriods = async (req, res) => {
  try {
    const result = await service.getAvailablePeriods({
      condominioId: req.params.condominioId,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
exports.getProviders = async (req, res) => {
  try {
    const result = await service.getProviders();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.updateContatoreGenerale = async (req, res) => {
  try {
    const result = await service.updateContatoreGenerale({
      sessionId: req.params.id,
      precedente: req.body.precedente,
      attuale: req.body.attuale,
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
exports.deleteSession = async (req, res) => {
  try {
    const result = await service.deleteSession({
      sessionId: req.params.id,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};


exports.uploadImportedDocument = async (req, res) => {
  try {
   
    const result = await service.uploadImportedDocument({
      file: req.file,
      body: req.body,
    });

    res.status(201).json(result);
  } catch (err) {
    console.error("uploadImportedDocument error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.listRipartizionePdfs = async (req, res, next) => {
  try {
    const rows = await service.listRipartizionePdfs();

    const grouped = rows.reduce((acc, row) => {
      const period = row.period_key || "senza-periodo";

      if (!acc[period]) {
        acc[period] = [];
      }

      acc[period].push(row);

      return acc;
    }, {});

    return res.json({
      success: true,
      periods: grouped,
    });
  } catch (error) {
    next(error);
  }
};

exports.viewRipartizionePdf = async (req, res, next) => {
  try {
    const { id } = req.params;

    const pdf = await service.getRipartizionePdfById(id);

    if (!pdf) {
      return res.status(404).json({ error: "PDF non trovato." });
    }

    const absolutePath = path.join(
      process.cwd(),
      pdf.filepath.replace(/^\/+/, "")
    );

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({
        error: "File PDF non trovato nello storage.",
      });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${pdf.filename}"`
    );

    return res.sendFile(absolutePath);
  } catch (error) {
    next(error);
  }
};

exports.getRipartizionePdfJob = async (req, res, next) => {
  try {
    const { jobId } = req.params;

    const job = await service.getRipartizionePdfJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: "Job non trovato.",
      });
    }

    return res.json(job);
  } catch (error) {
    next(error);
  }
};

exports.startRipartizionePdfJob = async (req, res, next) => {
  try {
    const {
      righe,
      dettaglioByUtenza,
      trimestreLabel,
      dataLettura,
      logoUrl,
      condominioId,
    } = req.body;

    const job = await service.startRipartizionePdfJob({
      righe,
      dettaglioByUtenza,
      trimestreLabel,
      dataLettura,
      logoUrl,
      condominioId,
    });

    return res.json({
      success: true,
      jobId: job.id,
      total: job.total,
      status: job.status,
    });
  } catch (error) {
    next(error);
  }
};

exports.exportRipartizionePdf = async (req, res, next) => {
  try {
    const {
      righe,
      dettaglioByUtenza,
      trimestreLabel,
      dataLettura,
      logoUrl,
      condominioId,
    } = req.body;

    const result = await service.exportRipartizioniPerUtenza({
      righe,
      dettaglioByUtenza,
      trimestreLabel,
      dataLettura,
      logoUrl,
      condominioId,
    });

    return res.json({
      success: true,
      total: result.total,
      saved: result.saved,
      failed: result.failed,
      count: result.saved,
      files: result.savedFiles,
      errors: result.failedFiles,
    });
  } catch (error) {
    next(error);
  }
};

exports.parseImportedDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await service.parseImportedDocument(id);
    res.json(result);
  } catch (err) {
    console.error("parseImportedDocument error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.createImportedDocument = async (req, res) => {
  try {
    const result = await service.createImportedDocument(req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error("createImportedDocument error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.listImportedDocumentsByCondominio = async (req, res) => {
  try {
    const { condominioId } = req.params;
    const result = await service.listImportedDocumentsByCondominio(condominioId);
    res.json(result);
  } catch (err) {
    console.error("listImportedDocumentsByCondominio error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.getImportedDocumentById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await service.getImportedDocumentById(id);
    res.json(result);
  } catch (err) {
    console.error("getImportedDocumentById error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.updateImportedDocumentParsedResult = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await service.updateImportedDocumentParsedResult(id, req.body);
    res.json(result);
  } catch (err) {
    console.error("updateImportedDocumentParsedResult error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.linkImportedDocumentToSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { sessionId } = req.body;
    const result = await service.linkImportedDocumentToSession(id, sessionId);
    res.json(result);
  } catch (err) {
    console.error("linkImportedDocumentToSession error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};