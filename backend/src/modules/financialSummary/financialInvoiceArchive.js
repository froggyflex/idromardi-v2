function safePdfFilenamePart(value, fallback = "documento") {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || fallback;
}

async function archiveIssuedInvoice({
  financialInvoiceId,
  billingSessionId,
  condominioId,
  documentNumber,
  progressive,
  periodLabel,
  generatePdf,
  saveDocument,
  logger = console,
}) {
  if (!billingSessionId) {
    return { archivedDocument: null, archiveWarning: null };
  }

  try {
    const buffer = Buffer.from(await generatePdf());
    const filename = `fattura_${safePdfFilenamePart(
      documentNumber || progressive,
      financialInvoiceId
    )}.pdf`;
    const saved = await saveDocument({
      condominioId,
      // generated_documents.fattura_id scopes documents to the billing
      // snapshot displayed in Fatturazione, not the accounting invoice UUID.
      fatturaId: billingSessionId,
      documentType: "fattura_emessa",
      filename,
      periodLabel,
      buffer,
      replace: true,
      metadata: {
        financialInvoiceId,
        documentNumber,
        periodLabel,
      },
    });

    return {
      archivedDocument: {
        id: saved.id,
        document_type: saved.document_type,
        filename: saved.filename,
      },
      archiveWarning: null,
    };
  } catch (error) {
    logger.error?.("Archiviazione PDF fattura non riuscita:", error);
    return {
      archivedDocument: null,
      archiveWarning:
        "La fattura è stata registrata correttamente, ma il PDF non è stato archiviato nel pannello. È ancora disponibile in Contabilità.",
    };
  }
}

module.exports = { archiveIssuedInvoice, safePdfFilenamePart };
