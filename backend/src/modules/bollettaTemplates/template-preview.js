const fs = require("fs");
const path = require("path");
const { buildRipartizionePdfHtml } = require("../fatture/fatture.pdf");
let logoUrl;

function previewHtml(template, condominio) {
  if (!logoUrl) logoUrl = `data:image/png;base64,${fs.readFileSync(path.resolve(__dirname, "../../../public/images/logo_colorato.png")).toString("base64")}`;
  return buildRipartizionePdfHtml({
    template, preview: true, logoUrl,
    trimestreLabel: "11/03/2026 - 18/06/2026", dataLettura: "18/06/2026",
    condominio: condominio || { nome: "Condominio Parco dei Fiori", indirizzo: "Via Roma, 121", citta: "Napoli" },
    righe: [{ utenza: { id: "preview", id_user: 42, Nome: "Maria Grazia", Cognome: "Rossi De Luca", Scala: "A", Interno: "12", Isolato: "101" },
      riga: { lettura_precedente: 500, lettura_attuale: 574, stato_attuale: "K", consumo_totale: 74,
        imp_acquedotto: 70.3, imp_fognatura: 23.17, imp_depurazione: 22.91, imp_qf: 4.43,
        conguaglio: 5.2, imp_oneri: 2.2, imp_oneri_perequazione_display: 6.4, imp_iva: 13.46,
        consumo_acconto: 20, imp_acconto: 19, depfog_acconto: 12, acconto: 36,
        storno_acconto: -45, storno_txt_aggiuntivo: -10, storno_legacy: -10, storno_legacy_periodo: "12/2025",
        minimum_payable_credit_euro: 10, imp_arr: .03, totale: 139.1 } }],
    dettaglioByUtenza: { preview: Array.from({ length: 6 }, (_, i) => ({ label: ["agevolata", "base", "fascia1", "fascia2", "fascia3", "bonus"][i], mc_allocati: 12, importo: 12.3 })) },
  });
}

// Uses physical A4 dimensions even on screens where the preview is scaled.
async function inspectA4(page) {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;width:198mm;height:285mm;visibility:hidden";
    document.body.appendChild(probe);
    const bounds = probe.getBoundingClientRect();
    document.body.style.width = "198mm";
    const overflow = [...document.querySelectorAll(".invoice-sheet")].map((sheet, index) => {
      const box = sheet.getBoundingClientRect();
      const horizontal = [...sheet.querySelectorAll("*")].some(el => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).display !== "inline");
      return { index: index + 1, heightMm: Math.round(box.height / bounds.height * 285), overflow: box.height > bounds.height + 1 || horizontal };
    }).filter(item => item.overflow);
    probe.remove();
    return overflow;
  });
}
function layoutError(overflow) {
  const error = new Error(`Il modello supera lo spazio A4 o contiene testo troppo largo (bolletta ${overflow[0].index}). Riduci spaziatura o caratteri, oppure sposta una sezione.`);
  error.statusCode = 422;
  error.code = "TEMPLATE_A4_OVERFLOW";
  return error;
}
module.exports = { previewHtml, inspectA4, layoutError };
