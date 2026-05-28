const service = require("./prospetti.service");
const {
  getPdfFromR2,
  saveGeneratedDocument,
} = require("../../utils/generatedDocuments");

async function downloadPdf(req, res) {
  try {
    const fatturaId = req.params.fatturaId || req.params.periodoId;

    const { buffer, filename, condominioId, periodLabel } = await service.buildPdf(fatturaId);

    await saveGeneratedDocument({
      condominioId,
      fatturaId,
      documentType: "prospetto",
      filename,
      periodLabel,
      buffer,
      replace: true,
      metadata: { periodLabel },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || "Server error" });
  }
}

async function viewGeneratedDocument(req, res) {
  try {
    const { id } = req.params;
    const [[doc]] = await require("../../config/db").query(
      `SELECT * FROM generated_documents WHERE id = ? LIMIT 1`,
      [id]
    );

    if (!doc) {
      return res.status(404).json({ error: "Documento non trovato" });
    }

    const buffer = await getPdfFromR2(doc.r2_key);

    res.setHeader("Content-Type", doc.mime_type || "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${doc.filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || "Server error" });
  }
}

module.exports = { downloadPdf, viewGeneratedDocument };
