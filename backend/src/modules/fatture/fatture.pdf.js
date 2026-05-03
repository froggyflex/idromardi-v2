function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function n(v) {
  const num = Number(v ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function euro(v) {
  return n(v).toFixed(2);
}

function intVal(v, fallback = "-") {
  const num = Number(v);
  return Number.isFinite(num) ? String(Math.round(num)) : fallback;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function row(label, value, extraClass = "") {
  return `
    <div class="info-row ${extraClass}">
      <div class="info-label">${esc(label)}</div>
      <div class="info-value">${value}</div>
    </div>
  `;
}

function moneyRow(label, amount, extraClass = "") {

   
    return `
      <tr class="${extraClass}">
        <td>${esc(label)}</td>
        <td class="amount">€ ${euro(amount)}</td>
      </tr>
    `;
  
}

function getTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return "";

  const labelMap = {
    agev: "Agevolata",
    agevolata: "Agevolata",
    "1a": "1ª Fascia",
    base: "Base",
    "2a": "2ª Fascia",
    "3a": "3ª Fascia",
    "1": "1ª Fascia",
    "2": "2ª Fascia",
    "3": "3ª Fascia",
    fascia1: "1ª Fascia",
    fascia2: "2ª Fascia",
    fascia3: "3ª Fascia",
    ecc: "Eccedenza",
    eccedenza: "Eccedenza",
    bonus: "Bonus Idrico",
    bonus_idrico: "Bonus Idrico",
  };

  
  return tiers
    .map((tier, i) => {
      const raw = String(tier.label ?? "").trim().toLowerCase();
      const uiLabel = labelMap[raw] || tier.label || `Scaglione ${tier.ordine ?? i + 1}`;

      return `
       <div class="mini-row">
            <span>${esc(uiLabel)}</span>
             <div class="line-sub">${esc(tier.mc_allocati ?? 0)} mc - € ${euro(tier.importo)} </div>
            
        </div>
      `;
    })
    .join("");
}

function qtyMoneyRow(label, qty, amount, extraClass = "") {
  return `
    <tr class="${extraClass}">
      <td>
        <div class="line-main">${esc(label)}</div>
        <div class="line-sub">${euro(qty)} mc</div>
      </td>
      <td class="amount">€ ${euro(amount)}</td>
    </tr>
  `;
}

function buildInvoice(r, tiers, trimestreLabel, dataLettura, logoUrl) {

  const nome = [r?.utenza?.Nome, r?.utenza?.Cognome].filter(Boolean).join(" ") || "-";

  const codiceUtente = esc(r?.utenza?.id_user ?? "-");
  const isolato = esc(r?.utenza?.Isolato ?? "-");
  const scala = esc(r?.utenza?.Scala ?? "-");
  const interno = esc(r?.utenza?.Interno ?? "-");
  const ubicazione = `Is. ${isolato} · Sc. ${scala} · Int. ${interno}`;

  const lettAtt = r?.riga?.lettura_attuale ?? r?.attuale?.valore_lettura ?? "-";
  const lettPrec = r?.riga?.lettura_precedente ?? r?.precedente?.valore_lettura ?? "-";
  const stato = r?.riga?.stato_attuale ?? r?.attuale?.stato_lettura ?? "-";
  const consumoTot = intVal(r?.riga?.consumo_totale);
  const consumoAcconto = euro(r?.riga?.consumo_acconto);

  const totale = euro(r?.riga?.totale);

  return `
    <section class="page">
      <article class="invoice-sheet">
        <div class="top-accent"></div>

        <header class="invoice-header">
          <div class="brand-block">
            <div class="brand-kicker">Ripartizione consumi idrici</div>
            <h1 class="doc-title">Bolletta di Ripartizione</h1>
            <div class="doc-subtitle">Documento amministrativo interno</div>
          </div>

          <div class="brand-logo-block">
            ${
              logoUrl
                ? `<img class="brand-logo" src="${esc(logoUrl)}" alt="Logo aziendale" />`
                : `<div class="logo-fallback">IDROMARDI</div>`
            }
          </div>
        </header>

        <section class="summary-band">
          <div class="summary-left">
            <div class="summary-caption">Intestatario / riferimento utenza</div>
            <div class="summary-name">${esc(nome)}</div>
            <div class="summary-meta">
              <span><strong>ID utente:</strong> ${codiceUtente}</span>
              <span><strong>Ubicazione:</strong> ${ubicazione}</span>
            </div>
          </div>

          <div class="summary-right">
            <div class="summary-total-label">Totale documento</div>
            <div class="summary-total-value">€ ${totale}</div>
          </div>
        </section>

        <section class="invoice-grid">
          <div class="main-column">
 

            <section class="panel">
              <div class="panel-title">Letture e consumi</div>
              <div class="info-grid three-cols">
                ${row("Periodo", esc(trimestreLabel || "-"))}
                ${row("Data lettura", esc(dataLettura || "-"))}
                ${row("Stato lettura", esc(stato))}
                ${row("Lettura precedente", esc(lettPrec))}
                ${row("Lettura attuale", esc(lettAtt))}
                ${row("Consumo totale", `${esc(consumoTot)} mc`, "highlight-row")}
              </div>
            </section>

            <section class="panel">
              <div class="panel-title">Dettaglio economico</div>

              <table class="cost-table">
                <thead>
                  <tr>
                    <th>Voce</th>
                    <th class="amount">Importo</th>
                  </tr>
                </thead>
                <tbody>
                  ${moneyRow("Acquedotto", r?.riga?.imp_acquedotto)}
                  ${moneyRow("Fognatura", r?.riga?.imp_fognatura)}
                  ${moneyRow("Depurazione", r?.riga?.imp_depurazione)}
                  ${moneyRow("Quota fissa", r?.riga?.imp_qf)}
                  ${moneyRow("Conguaglio", r?.riga?.conguaglio)}
                  ${moneyRow("Oneri", r?.riga?.imp_oneri)}
                  ${moneyRow("IVA", r?.riga?.imp_iva)}
                  ${qtyMoneyRow("Acconto", r?.riga?.consumo_acconto, r?.riga?.imp_acconto)}
                  ${moneyRow("Storno acconto", r?.riga?.storno_acconto)}
                  ${moneyRow("Arrotondamento", r?.riga?.imp_arr)}
                </tbody>
              </table>
            </section>
          </div>

          <aside class="side-column">
            <section class="panel total-panel">
              <div class="panel-title">Dettagli Ripartizione</div>

              <div class="mini-summary">
                 
                 ${getTiers(tiers)} 

              </div>
            </section>

            <section class="panel note-panel">
              <div class="panel-title">Note lettura</div>
              <div class="note-text">
                K = lett. verificata<br />
                U = lett. utente<br />
                T = tel. utente<br />
                F = foto cont.<br />
                I = internet<br />
                L = cartolina<br />
                S = contatore sostituito<br />
                X = cons. presunto<br />
                Y = cont. illeg. o fermo<br />
                C = disabitato
              </div>
            </section>

            <section class="panel company-panel">
              <div class="panel-title">Riferimenti</div>
              <div class="company-name">Idromardi</div>
              <div class="company-text">Via Posillipo, 299 · 80123 Napoli</div>
              <div class="company-text">info@idromardi.it</div>
              <div class="company-text">www.idromardi.it</div>
            </section>
          </aside>
        </section>

        <footer class="invoice-footer">
          <div>Documento generato per finalità di ripartizione interna dei consumi idrici.</div>
          <div class="footer-right">Bolletta di Ripartizione · ${esc(trimestreLabel || "-")}</div>
        </footer>
      </article>
    </section>
  `;
}

function buildRipartizionePdfHtml({ righe, dettaglioByUtenza, trimestreLabel, dataLettura, logoUrl }) {
  const pages = chunkArray(righe || [], 1);

  return `
  <!doctype html>
  <html lang="it">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Bolletta di Ripartizione</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 8mm;
        }

        :root {
          --bg: #f4f7fb;
          --paper: #ffffff;
          --ink: #0f172a;
          --muted: #64748b;
          --muted-2: #475569;
          --line: #dbe5ef;
          --line-strong: #c5d4e6;
          --soft: #f8fbff;
          --soft-2: #f1f6fc;
          --accent: #1d4ed8;
          --accent-2: #0f3d91;
          --accent-soft: #dbeafe;
          --shadow: rgba(15, 23, 42, 0.08);
        }

        * {
          box-sizing: border-box;
        }

        html, body {
          margin: 0;
          padding: 0;
          background: #ffffff;
          color: var(--ink);
          font-family: Arial, Helvetica, sans-serif;
        }

        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .page {
          page-break-after: always;
        }

        .page:last-child {
          page-break-after: auto;
        }

        .invoice-sheet {
          width: 100%;
          min-height: auto;
          background: var(--paper);
          border: 1px solid var(--line-strong);
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 2mm 6mm var(--shadow);
          display: flex;
          flex-direction: column;
        }

        .top-accent {
          height: 5mm;
          background: linear-gradient(90deg, #0f3d91 0%, #1d4ed8 45%, #60a5fa 100%);
        }

        .invoice-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10mm;
          padding: 5mm 6mm 3mm 6mm;
        }

        .brand-block {
          flex: 1;
          min-width: 0;
        }

        .brand-kicker {
          font-size: 8pt;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          font-weight: 800;
          color: var(--accent);
          margin-bottom: 1.5mm;
        }

        .doc-title {
          margin: 0;
          font-size: 20pt;
          line-height: 1.05;
          font-weight: 800;
          color: var(--ink);
        }

        .doc-subtitle {
          margin-top: 1mm;
          font-size: 8pt;
          color: var(--muted);
        }

        .brand-logo-block {
          width: 44mm;
          min-width: 44mm;
          height: 18mm;
          display: flex;
          justify-content: flex-end;
          align-items: flex-start;
        }

        .brand-logo {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          display: block;
        }

        .logo-fallback {
          width: 100%;
          height: 100%;
          border: 1px dashed #9fb3c8;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10pt;
          font-weight: 800;
          color: var(--muted);
          background: var(--soft);
        }

        .summary-band {
          margin: 0 6mm 4mm 6mm;
          padding: 3.5mm 4.5mm;
          border: 1px solid var(--line);
          border-radius: 12px;
          background: linear-gradient(180deg, #fbfdff 0%, #f4f8fd 100%);
          display: grid;
          grid-template-columns: 1fr 70mm;
          gap: 6mm;
          align-items: stretch;
        }

        .summary-caption {
          font-size: 7.2pt;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-weight: 700;
          color: var(--muted);
          margin-bottom: 1.5mm;
        }

        .summary-name {
          font-size: 14pt;
          line-height: 1.1;
          font-weight: 800;
          color: var(--ink);
          margin-bottom: 1.8mm;
          word-break: break-word;
        }

        .summary-meta {
          display: flex;
          flex-direction: column;
          gap: 1mm;
          font-size: 8pt;
          line-height: 1.35;
          color: var(--muted-2);
        }

        .summary-right {
          border-left: 1px solid #d8e4f1;
          padding-left: 6mm;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: flex-end;
        }

        .summary-total-label {
          font-size: 8pt;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 700;
          color: var(--muted);
          margin-bottom: 1.2mm;
        }

        .summary-total-value {
          font-size: 20pt;
          line-height: 1;
          font-weight: 800;
          color: var(--accent-2);
        }

        .invoice-grid {
          flex: 1;
          display: grid;
          grid-template-columns: 1.65fr 0.9fr;
          gap: 4mm;
          padding: 0 6mm 4mm 6mm;
        }

        .main-column,
        .side-column {
          display: flex;
          flex-direction: column;
          gap: 3mm;
        }

        .panel {
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #ffffff;
          overflow: hidden;
        }

        .panel-title {
          padding: 2.8mm 3.5mm 2.2mm 3.5mm;
          border-bottom: 1px solid var(--line);
          background: var(--soft);
          font-size: 7pt;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-weight: 800;
          color: var(--muted-2);
        }

        .info-grid {
          display: grid;
          gap: 2mm;
          padding: 3mm;
        }

        .two-cols {
          grid-template-columns: 1fr 1fr;
        }

        .three-cols {
          grid-template-columns: repeat(3, 1fr);
        }

        .info-row {
          min-height: 13mm
          border: 1px solid var(--line);
          border-radius: 10px;
          background: #ffffff;
          padding: 2.2mm 2.6mm;
        }

        .highlight-row {
          background: linear-gradient(180deg, #f5fbff 0%, #edf6ff 100%);
          border-color: #a8c9f7;
        }

        .info-label {
          font-size: 6.5pt;
          line-height: 1.15;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted);
          margin-bottom: 1.1mm;
        }

        .info-value {
          font-size: 10.5pt;
          line-height: 1.2;
          font-weight: 700;
          color: var(--ink);
          word-break: break-word;
        }

        .cost-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }

        .cost-table thead th {
          background: #f8fbff;
          color: var(--muted-2);
          font-size: 7pt;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          text-align: left;
          padding: 3.6mm 4.5mm;
          border-bottom: 1px solid var(--line);
        }

        .cost-table thead th.amount {
          width: 34mm;
          text-align: right;
        }

        .cost-table tbody td {
          padding: 3.6mm 4.5mm;
          border-bottom: 1px solid #e8eef5;
          font-size: 9.6pt;
          color: var(--ink);
          vertical-align: middle;
        }

        .cost-table tbody tr:last-child td {
          border-bottom: none;
        }

        .cost-table tbody td.amount {
          text-align: right;
          font-weight: 800;
          white-space: nowrap;
        }

        .line-main {
          font-weight: 700;
          color: var(--ink);
          line-height: 1.2;
        }

        .line-sub {
          margin-top: 0.8mm;
          font-size: 8.3pt;
          color: var(--muted);
        }

        .total-panel {
          background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
        }

        .mini-summary {
          padding: 4.5mm;
          display: flex;
          flex-direction: column;
          gap: 2.5mm;
        }

        .mini-row {
          display: flex;
          justify-content: space-between;
          gap: 4mm;
          align-items: center;
          font-size: 9pt;
          line-height: 1.3;
          color: var(--muted-2);
          padding-bottom: 2mm;
          border-bottom: 1px dashed #d8e2ee;
        }

        .mini-row:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }

        .mini-row strong {
          color: var(--ink);
          font-weight: 800;
          text-align: right;
        }

        .grand-total-box {
          margin: 0 4.5mm 4.5mm 4.5mm;
          border: 1px solid #9ec1ee;
          border-radius: 12px;
          background: linear-gradient(180deg, #eef6ff 0%, #dcecff 100%);
          padding: 5mm;
        }

        .grand-total-label {
          font-size: 7.4pt;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-weight: 800;
          color: var(--accent-2);
          margin-bottom: 1.6mm;
        }

        .grand-total-value {
          font-size: 22pt;
          line-height: 1;
          font-weight: 900;
          color: var(--accent-2);
        }

        .note-panel,
        .company-panel {
          background: #ffffff;
        }

        .note-text,
        .company-text {
          padding: 4.5mm;
          padding-top: 4mm;
          font-size: 8.6pt;
          line-height: 1.45;
          color: var(--muted-2);
        }

        .company-name {
          padding: 4.5mm 4.5mm 0 4.5mm;
          font-size: 12pt;
          font-weight: 800;
          color: var(--ink);
        }

        .company-text + .company-text {
          padding-top: 0;
        }

        .invoice-footer {
          border-top: 1px solid var(--line);
          background: #fbfcfe;
          padding: 4mm 9mm;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 5mm;
          font-size: 7.6pt;
          line-height: 1.3;
          color: var(--muted);
        }

        .footer-right {
          font-weight: 700;
          color: var(--muted-2);
          text-align: right;
          white-space: nowrap;
        }
      </style>
    </head>
    <body>
      ${(pages || [])
        .map((page) =>
          page
            .map((r) => {
              const idUtenza =
                r?.utenza?.id ||
                r?.id_utenza ||
                r?.idUtenza ||
                r?.utenza_id;

              const dettaglio =
                dettaglioByUtenza?.[idUtenza] ||
                dettaglioByUtenza?.[String(idUtenza)] ||
                {};

              return buildInvoice(
                r,
                dettaglio,
                trimestreLabel,
                dataLettura,
                logoUrl
              );
            })
            .join("")
        )
        .join("")}
    </body>
  </html>
  `;
}

module.exports = {
  buildRipartizionePdfHtml,
};