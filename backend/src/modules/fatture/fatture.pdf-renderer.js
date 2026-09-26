const { PDFDocument } = require("pdf-lib");
const { buildRipartizionePdfHtml } = require("./fatture.pdf");
const { preparePrintLogo } = require("../../utils/pdf-logo");

function getRipartizionePdfChunkSize() {
  const configured = Number(process.env.RIPARTIZIONE_PDF_CHUNK_SIZE);
  return Number.isFinite(configured) && configured >= 1
    ? Math.min(Math.floor(configured), 100)
    : 35;
}

async function generateRipartizioneCompletePdfBuffer({
  browser, righe, dettaglioByUtenza, trimestreLabel, dataLettura, logoUrl, condominio,
  onChunkComplete,
}) {
  const rows = Array.isArray(righe) ? righe : [];
  if (!rows.length) throw new Error("Nessuna riga disponibile per generare i PDF");
  const chunkSize = getRipartizionePdfChunkSize();
  const totalChunks = Math.ceil(rows.length / chunkSize);
  const mergedPdf = totalChunks > 1 ? await PDFDocument.create() : null;
  // Reuse one page, keeping only a bounded group of invoices in the DOM.
  const page = await browser.newPage();
  try {
    page.setDefaultNavigationTimeout(120000);
    page.setDefaultTimeout(120000);
    await page.emulateMediaType("print");
    const printLogo = await preparePrintLogo(page, logoUrl);
    for (let index = 0; index < totalChunks; index += 1) {
      const html = buildRipartizionePdfHtml({
        righe: rows.slice(index * chunkSize, (index + 1) * chunkSize),
        dettaglioByUtenza,
        trimestreLabel: trimestreLabel || "",
        dataLettura: dataLettura || "",
        logoUrl: printLogo,
        condominio,
      });
      await page.setContent(html, { waitUntil: "load", timeout: 120000 });
      const buffer = Buffer.from(await page.pdf({
        format: "A4", landscape: false, preferCSSPageSize: true,
        printBackground: true,
        margin: { top: "6mm", right: "6mm", bottom: "6mm", left: "6mm" },
      }));
      if (mergedPdf) {
        const source = await PDFDocument.load(buffer);
        const pages = await mergedPdf.copyPages(source, source.getPageIndices());
        pages.forEach((item) => mergedPdf.addPage(item));
      }
      if (onChunkComplete) await onChunkComplete(index, totalChunks);
      // Preserve shared fonts/images and avoid rewriting a single-chunk PDF.
      if (!mergedPdf) return buffer;
    }
    return Buffer.from(await mergedPdf.save({ useObjectStreams: true }));
  } finally {
    await page.close();
  }
}

module.exports = { getRipartizionePdfChunkSize, generateRipartizioneCompletePdfBuffer };
