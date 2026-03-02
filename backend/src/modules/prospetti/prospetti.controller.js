const service = require("./prospetti.service");

async function downloadPdf(req, res) {
  try {
    const { condominioId, periodoId } = req.params;

    const { buffer, filename } = await service.buildPdf(condominioId, periodoId);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}

module.exports = { downloadPdf };