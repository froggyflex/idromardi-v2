const service = require("./prospetti.service");
const {
  getPdfFromR2,
  getGeneratedDocumentById,
  saveGeneratedDocument,
} = require("../../utils/generatedDocuments");

async function generatePdf(req, res) {
  try {
    const fatturaId = req.params.fatturaId;
    const result = await service.buildPdf(fatturaId, { mode: "color", includeMonochrome: true });
    const common = {
      condominioId: result.condominioId, fatturaId,
      periodLabel: result.periodLabel, replace: true,
    };
    const monochrome = await saveGeneratedDocument({
      ...common, documentType: "prospetto_bw",
      filename: result.filename.replace(/\.pdf$/i, "_bianco_nero.pdf"),
      buffer: result.monochromeBuffer,
    });
    const document = await saveGeneratedDocument({
      ...common, documentType: "prospetto", filename: result.filename,
      buffer: result.buffer,
      metadata: { periodLabel: result.periodLabel, printMode: "color", monochromeDocumentId: monochrome.id },
    });
    res.json({ document });
  } catch (err) {
    console.error("Generazione prospetto:", err);
    res.status(err.statusCode || 500).json({ error: err.message || "Errore generazione prospetto" });
  }
}

async function printGeneratedPdf(req, res) {
  try {
    const mode = req.query.mode || "color";
    if (!["color", "bw"].includes(mode)) {
      return res.status(400).json({ error: "Modalita di stampa non valida" });
    }
    const doc = await getGeneratedDocumentById(req.params.id, { condominioId: req.query.condominioId });
    if (!doc || doc.document_type !== "prospetto") {
      return res.status(404).json({ error: "Prospetto non trovato" });
    }
    let metadata = doc.metadata_json || {};
    if (typeof metadata === "string") {
      try { metadata = JSON.parse(metadata) || {}; } catch { metadata = {}; }
    }
    let printable = metadata.printMode === "color" && mode === "color" ? doc : null;
    if (mode === "bw" && metadata.monochromeDocumentId) {
      const variant = await getGeneratedDocumentById(metadata.monochromeDocumentId, { condominioId: doc.condominio_id });
      if (variant?.document_type === "prospetto_bw" && variant.fattura_id === doc.fattura_id) printable = variant;
    }
    // Older archives have no variants. Render the selected saved billing period
    // without replacing its archived PDF or changing any accounting data.
    if (!printable && !doc.fattura_id) {
      return res.status(409).json({ error: "Rigenera il prospetto per scegliere la modalita di stampa." });
    }
    const result = printable
      ? { buffer: await getPdfFromR2(printable.r2_key), filename: printable.filename }
      : await service.buildPdf(doc.fattura_id, { mode });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${result.filename}"`);
    res.send(result.buffer);
  } catch (err) {
    console.error("Stampa prospetto:", err);
    res.status(err.statusCode || 500).json({ error: err.message || "Errore stampa prospetto" });
  }
}

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

module.exports = { downloadPdf, viewGeneratedDocument, generatePdf, printGeneratedPdf };
