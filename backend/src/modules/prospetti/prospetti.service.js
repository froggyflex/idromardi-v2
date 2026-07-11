const db = require("../../config/db");
const { launchBrowser } = require("../../utils/puppeteer");
const fs = require("fs");
const path = require("path");

function n(value) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function money(value) {
  return n(value).toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function intValue(value) {
  const num = Number(value);
  return Number.isFinite(num) ? String(Math.round(num)) : "";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getLogoColoratoDataUrl() {
  const candidateDirs = [
    path.join(__dirname, "..", "..", "..", "public", "images"),
    path.join(process.cwd(), "backend", "public", "images"),
    path.join(process.cwd(), "public", "images"),
  ];

  for (const imagesDir of candidateDirs) {
    if (!fs.existsSync(imagesDir)) continue;

    const filename = fs
      .readdirSync(imagesDir)
      .find((name) => /^logo_colorato\.(png|jpe?g|webp)$/i.test(name));

    if (!filename) continue;

    const ext = path.extname(filename).slice(1).toLowerCase();
    const mimeType = ext === "jpg" ? "jpeg" : ext;
    const base64 = fs.readFileSync(path.join(imagesDir, filename)).toString("base64");

    return `data:image/${mimeType};base64,${base64}`;
  }

  return "";
}

function compactName(row) {
  const name = [row.Nome, row.Cognome].filter(Boolean).join(" ").trim();
  return name || "-";
}

function periodLabel(periodo, session) {
  const fromSession = session?.period_label || session?.scadenza || session?.scad;
  if (fromSession) return fromSession;

  const year = Number(periodo?.period_year || session?.anno || 0);
  const month = Number(periodo?.period_month || 0);

  if (year && month) {
    return `${month}^${String(year).slice(-2)}`;
  }

  return "";
}

function dateIt(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("it-IT");
}

function compareTableRows(a, b) {
  const rowA = Number(a?.id_user ?? 0);
  const rowB = Number(b?.id_user ?? 0);

  if (rowA !== rowB) {
    return rowA - rowB;
  }

  return String(a?.id_utenza ?? "").localeCompare(String(b?.id_utenza ?? ""), "it", {
    numeric: true,
    sensitivity: "base",
  });
}

function chunkRows(rows, perPage = 22) {
  const pages = [];
  for (let i = 0; i < rows.length; i += perPage) {
    pages.push(rows.slice(i, i + perPage));
  }
  return pages.length ? pages : [[]];
}

function sum(rows, getter) {
  return rows.reduce((total, row) => total + n(getter(row)), 0);
}

function roundMoney(value) {
  return Math.round((n(value) + Number.EPSILON) * 100) / 100;
}

function parseCalculationContext(session) {
  if (!session?.calculation_context_json) return {};

  try {
    return typeof session.calculation_context_json === "string"
      ? JSON.parse(session.calculation_context_json)
      : session.calculation_context_json;
  } catch {
    return {};
  }
}

function allocateRounded(total, items, decimals = 2, weightGetter = null) {
  if (!items.length) return [];

  const factor = Math.pow(10, decimals);
  const totalUnits = Math.round(Math.abs(n(total)) * factor);
  const sign = n(total) < 0 ? -1 : 1;
  const weights = weightGetter
    ? items.map((item) => Math.max(0, n(weightGetter(item))))
    : items.map(() => 1);
  const weightTotal = weights.reduce((acc, value) => acc + value, 0);
  const safeWeights = weightTotal > 0 ? weights : items.map(() => 1);
  const safeWeightTotal = weightTotal > 0 ? weightTotal : items.length;
  const raw = safeWeights.map((weight) => (totalUnits * weight) / safeWeightTotal);
  const floored = raw.map(Math.floor);
  const assigned = floored.reduce((acc, value) => acc + value, 0);
  const remainder = totalUnits - assigned;
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);

  for (let i = 0; i < remainder; i += 1) {
    floored[order[i % order.length].index] += 1;
  }

  return floored.map((units) => sign * (units / factor));
}

function enrichRowsWithSeparatedOneri(rows, session) {
  const context = parseCalculationContext(session);
  const parsedOneriNormale = roundMoney(context.parsedOneriPerequazione);
  const parsedOneriAcconto = roundMoney(context.parsedOneriPerequazioneAcconto);
  const hasParsedPerequazione = parsedOneriNormale !== 0 || parsedOneriAcconto !== 0;

  if (!hasParsedPerequazione) {
    return rows.map((row) => ({
      ...row,
      imp_oneri_base_display: n(row.imp_oneri),
      imp_oneri_perequazione_display: 0,
    }));
  }

  const chargeableRows = rows.filter((row) => n(row.imp_oneri) !== 0);
  const normaleShares = allocateRounded(parsedOneriNormale, chargeableRows);
  const accontoShares = allocateRounded(
    parsedOneriAcconto,
    chargeableRows,
    2,
    (row) => row.consumo_normale
  );
  const shareByRowId = new Map();

  chargeableRows.forEach((row, index) => {
    shareByRowId.set(
      row.id,
      roundMoney(n(normaleShares[index]) + n(accontoShares[index]))
    );
  });

  return rows.map((row) => {
    const perequazione = roundMoney(shareByRowId.get(row.id) || 0);
    return {
      ...row,
      imp_oneri_base_display: Math.max(0, roundMoney(n(row.imp_oneri) - perequazione)),
      imp_oneri_perequazione_display: perequazione,
    };
  });
}

function buildTotals(rows) {
  return {
    count: rows.length,
    consumo: sum(rows, (r) => r.consumo_totale),
    acquedotto: sum(rows, (r) => r.imp_acquedotto),
    acconto: sum(rows, (r) => r.imp_acconto),
    accontoDepFog: sum(rows, (r) => r.depfog_acconto),
    storno: sum(rows, (r) => r.storno_acconto),
    depFog: sum(rows, (r) => n(r.imp_fognatura) + n(r.imp_depurazione)),
    qf: sum(rows, (r) => r.imp_qf),
    conguaglio: sum(rows, (r) => r.conguaglio),
    oneri: sum(rows, (r) => r.imp_oneri_base_display ?? r.imp_oneri),
    oneriPerequazione: sum(rows, (r) => r.imp_oneri_perequazione_display),
    iva: sum(rows, (r) => r.imp_iva),
    arr: sum(rows, (r) => r.imp_arr),
    totale: sum(rows, (r) => r.totale),
  };
}

function statusNeedsReplacement(status) {
  return ["Y"].includes(String(status || "").trim().toUpperCase());
}

function buildHeader({ session, condominio, contatto, periodoAttuale, periodoPrecedente, totals, logoUrl }) {
  const currentGeneral = periodoAttuale?.contatore_generale_valore;
  const previousGeneral = periodoPrecedente?.contatore_generale_valore;
  const generalConsumption =
    currentGeneral != null && previousGeneral != null
      ? n(currentGeneral) - n(previousGeneral)
      : totals.consumo;

  const scad = periodLabel(periodoAttuale, session);
  const dataLettura =
    dateIt(session?.data_casa_idrica) ||
    dateIt(session?.data_fattura) ||
    dateIt(periodoAttuale?.dataOperatore) ||
    dateIt(periodoAttuale?.created_at);

  return `
    <header class="doc-header">
      <div class="top-grid">
        <div class="boxed">
          <div class="kv"><span>CODICE</span><strong>${esc(condominio?.codice || "")}</strong></div>
          <div class="kv"><span>SCAD</span><strong>${esc(scad)}</strong></div>
        </div>

        <div class="condo-box">
          ${logoUrl ? `<img class="header-logo" src="${esc(logoUrl)}" alt="Idromardi" />` : ""}
          <div class="condo-title">CONDOMINIO: ${esc(condominio?.nome || condominio?.indirizzo || "-")}</div>
          <div class="condo-meta">
            NUAE: ${esc(condominio?.nuae ?? "-")} - T.F.: ${esc(session?.tf_code || session?.tf || "-")} - Data lett.: ${esc(dataLettura || "-")}
          </div>
          <div class="admin-line">
            <span>Amministratore</span>
            <strong>${esc(contatto?.nome || "-")}</strong>
            <span>${esc(contatto?.telefono || "")}</span>
          </div>
          <div class="address-line">${esc(contatto?.indirizzo || condominio?.indirizzo || "")}</div>
          <div class="address-line">Sez ${esc(condominio?.sezione || "")} Cat. ${esc(condominio?.categoria || "")} Ruolo ${esc(condominio?.ruolo || "")}</div>
        </div>

        <div class="general-box">
          <div class="general-title">SITUAZIONE CONTATORE GENERALE</div>
          <div class="general-grid">
            <span>Attuale</span><strong>${esc(intValue(currentGeneral))}</strong>
            <span>Precedente</span><strong>${esc(intValue(previousGeneral))}</strong>
            <span>Consumo</span><strong>${esc(intValue(generalConsumption))}</strong>
            <span>Imp. cons.</span><strong>${money(session?.tot_acquedotto ?? totals.acquedotto)}</strong>
            <span>Dep./fogn.</span><strong>${money(totals.depFog)}</strong>
            <span>Q.F.</span><strong>${money(totals.qf)}</strong>
            <span>Varie</span><strong>${money(session?.varie)}</strong>
            <span>Totale ivato</span><strong class="grand">€ ${money(totals.totale)}</strong>
          </div>
        </div>
      </div>
      <h1>PROSPETTO DETTAGLIO CONSUMI ACQUA AD USO AMMINISTRATIVO INTERNO</h1>
    </header>
  `;
}

function rowHtml(row) {
  const status = String(row.stato_attuale || "").trim().toUpperCase();
  const name = compactName(row);

  return `
    <tr>
      <td class="id">${esc(row.id_user)}</td>
      <td class="name"><div class="name-text">${esc(name)}</div></td>
      <td>${esc(row.Isolato || "")}</td>
      <td>${esc(row.Scala || "")}</td>
      <td>${esc(row.Interno || "")}</td>
      <td class="num">${esc(intValue(row.lettura_attuale))}</td>
      <td class="num">${esc(intValue(row.lettura_precedente))}</td>
      <td class="state">${esc(status)}</td>
      <td class="num">${esc(intValue(row.consumo_totale))}</td>
      <td class="money">${money(row.imp_acquedotto)}</td>
      <td class="money">${money(row.imp_acconto)}</td>
      <td class="money">${money(row.depfog_acconto)}</td>
      <td class="money">${money(row.storno_acconto)}</td>
      <td class="money">${money(n(row.imp_fognatura) + n(row.imp_depurazione))}</td>
      <td class="money">${money(row.imp_qf)}</td>
      <td class="money">${money(row.conguaglio)}</td>
      <td class="money">${money(row.imp_oneri_base_display ?? row.imp_oneri)}</td>
      <td class="money">${money(row.imp_oneri_perequazione_display)}</td>
      <td class="money">${money(row.imp_iva)}</td>
      <td class="money">${money(row.imp_arr)}</td>
      <td class="money total">${money(row.totale)}</td>
    </tr>
  `;
}

function totalRow(totals) {
  return `
    <tr class="totals">
      <td colspan="8">TOTALI</td>
      <td class="num">${intValue(totals.consumo)}</td>
      <td class="money">${money(totals.acquedotto)}</td>
      <td class="money">${money(totals.acconto)}</td>
      <td class="money">${money(totals.accontoDepFog)}</td>
      <td class="money">${money(totals.storno)}</td>
      <td class="money">${money(totals.depFog)}</td>
      <td class="money">${money(totals.qf)}</td>
      <td class="money">${money(totals.conguaglio)}</td>
      <td class="money">${money(totals.oneri)}</td>
      <td class="money">${money(totals.oneriPerequazione)}</td>
      <td class="money">${money(totals.iva)}</td>
      <td class="money">${money(totals.arr)}</td>
      <td class="money total">€ ${money(totals.totale)}</td>
    </tr>
  `;
}

function tableHtml(rows, totals) {
  return `
    <table class="detail-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Nome</th>
          <th>Is.</th>
          <th>Sc.</th>
          <th>Interno</th>
          <th>Attuale</th>
          <th>Preced.</th>
          <th>*</th>
          <th>m3</th>
          <th>Importo consumo</th>
          <th>Acconto</th>
          <th>Acc. dep/fog</th>
          <th>Storno acc.</th>
          <th>Dep/Fog</th>
          <th>Q.F.</th>
          <th>Cong.</th>
          <th>Oneri</th>
          <th>Oneri Pereq.</th>
          <th>IVA</th>
          <th>Arr.</th>
          <th>Tot. bolletta</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(rowHtml).join("")}
      </tbody>
      <tfoot>
        ${totalRow(totals)}
      </tfoot>
    </table>
  `;
}

function legendHtml() {
  return `
    <div class="legend">
      *Legenda K = lett. verificata; U = utente; T = telefono; F = foto contatore; I = internet; L = cartolina;
      S = contatore sostituito; X = cons. presunto per utenza chiusa; Y = m. contatore guasto illeggibile o fermo; C = disabitato.
    </div>
  `;
}

function replacementHtml(rows) {
  const items = rows.filter((row) => statusNeedsReplacement(row.stato_attuale));
  if (!items.length) return "";

  return `
    <section class="replacement-page">
      <div class="replacement-card">
        <div class="replacement-header">
          <div>
            <div class="replacement-kicker">Contatori da verificare</div>
            <h2>Utenze con contatori che necessitano di sostituzione</h2>
          </div>
          <div class="replacement-count">${items.length}</div>
        </div>
        <table class="replacement-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Utenza</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
        ${items
          .map(
            (row) => `
              <tr>
                <td>${esc(row.id_user)}</td>
                <td>${esc(compactName(row))}</td>
                <td>Media contatore illeggibile</td>
              </tr>
            `
          )
          .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function buildHtml({ session, condominio, contatto, periodoAttuale, periodoPrecedente, rows }) {
  const orderedRows = enrichRowsWithSeparatedOneri([...rows], session).sort(compareTableRows);
  const totals = buildTotals(orderedRows);
  const pages = chunkRows(orderedRows);
  const logoUrl = getLogoColoratoDataUrl();
  const header = buildHeader({
    session,
    condominio,
    contatto,
    periodoAttuale,
    periodoPrecedente,
    totals,
    logoUrl,
  });

  return `
    <!doctype html>
    <html lang="it">
      <head>
        <meta charset="utf-8" />
        <title>Prospetto contabilita</title>
        <style>
          @page { size: A4 landscape; margin: 7mm 7mm 6mm; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            color: #111827;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 7.2pt;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .page {
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .top-grid {
            display: grid;
            grid-template-columns: 28mm 1fr 68mm;
            gap: 3mm;
            align-items: stretch;
          }
          .boxed,
          .condo-box,
          .general-box {
            border: 1px solid #9ca3af;
            border-radius: 3px;
            background: #ffffff;
          }
          .boxed {
            padding: 2mm;
            display: grid;
            gap: 2mm;
          }
          .kv span,
          .general-title,
          .admin-line span,
          h1 {
            color: #334155;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }
          .kv strong {
            display: block;
            margin-top: 1mm;
            font-size: 11pt;
          }
          .condo-box {
            min-height: 23mm;
            padding: 2mm 40mm 2mm 2.5mm;
            position: relative;
          }
          .header-logo {
            position: absolute;
            top: 50%;
            right: 4mm;
            width: 34mm;
            max-height: 15mm;
            transform: translateY(-50%);
            object-fit: contain;
          }
          .condo-title {
            font-size: 11pt;
            font-weight: 900;
            margin-bottom: 1mm;
          }
          .condo-meta,
          .address-line {
            margin-top: 0.8mm;
          }
          .admin-line {
            display: flex;
            gap: 6mm;
            align-items: baseline;
            margin-top: 1.5mm;
          }
          .admin-line strong {
            font-size: 8.5pt;
          }
          .general-box {
            padding: 2mm;
          }
          .general-title {
            text-align: center;
            margin-bottom: 1.5mm;
          }
          .general-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.7mm 2mm;
          }
          .general-grid strong {
            text-align: right;
          }
          .general-grid .grand {
            color: #0f3d91;
            font-size: 8.5pt;
          }
          h1 {
            margin: 3mm 0 2mm;
            text-align: center;
            font-size: 10pt;
          }
          .detail-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          .detail-table th,
          .detail-table td {
            border: 1px solid #cbd5e1;
            padding: 0.95mm 0.7mm;
            vertical-align: middle;
          }
          .detail-table th {
            background: #eaf1f9;
            color: #0f172a;
            font-size: 5.55pt;
            line-height: 1.05;
            font-weight: 800;
            text-transform: uppercase;
            text-align: center;
            overflow: hidden;
            overflow-wrap: anywhere;
            word-break: normal;
          }
          .detail-table tbody tr:nth-child(even) td {
            background: #f8fafc;
          }
          .detail-table tfoot {
            display: table-footer-group;
          }
          .detail-table th:nth-child(1),
          .detail-table td:nth-child(1) { width: 7mm; }
          .detail-table th:nth-child(2),
          .detail-table td:nth-child(2) { width: 48mm; }
          .detail-table th:nth-child(3),
          .detail-table td:nth-child(3),
          .detail-table th:nth-child(4),
          .detail-table td:nth-child(4),
          .detail-table th:nth-child(8),
          .detail-table td:nth-child(8) {
            width: 5mm;
            padding-left: 0.25mm;
            padding-right: 0.25mm;
            text-align: center;
          }
          .detail-table th:nth-child(5),
          .detail-table td:nth-child(5) {
            width: 11mm;
            padding-left: 0.35mm;
            padding-right: 0.35mm;
            text-align: center;
          }
          .detail-table th:nth-child(6),
          .detail-table td:nth-child(6),
          .detail-table th:nth-child(7),
          .detail-table td:nth-child(7) { width: 13mm; }
          .detail-table .id { text-align: center; }
          .detail-table .name {
            width: 48mm;
            max-width: 48mm;
            font-weight: 700;
          }
          .detail-table .name-text {
            width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .detail-table .state { text-align: center; font-weight: 800; }
          .detail-table .num,
          .detail-table .money {
            text-align: right;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
          }
          .detail-table .total {
            font-weight: 900;
          }
          .detail-table .totals td {
            background: #dbeafe !important;
            font-weight: 900;
          }
          .legend {
            margin-top: 2mm;
            color: #334155;
            font-size: 6.6pt;
            text-align: right;
          }
          .replacement-page {
            page-break-before: always;
            padding-top: 5mm;
          }
          .replacement-card {
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            overflow: hidden;
          }
          .replacement-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4mm 5mm;
            border-bottom: 1px solid #cbd5e1;
            background: #f8fbff;
          }
          .replacement-kicker {
            margin-bottom: 1mm;
            color: #1d4ed8;
            font-size: 7pt;
            font-weight: 900;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }
          .replacement-page h2 {
            margin: 0;
            color: #0f172a;
            font-size: 12pt;
            line-height: 1.2;
          }
          .replacement-count {
            min-width: 12mm;
            height: 12mm;
            border-radius: 999px;
            background: #0f3d91;
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13pt;
            font-weight: 900;
          }
          .replacement-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            font-size: 9pt;
          }
          .replacement-table th,
          .replacement-table td {
            border-bottom: 1px solid #e2e8f0;
            padding: 2.2mm 3mm;
            text-align: left;
          }
          .replacement-table th {
            background: #eaf1f9;
            color: #334155;
            font-size: 7pt;
            font-weight: 900;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          .replacement-table th:first-child,
          .replacement-table td:first-child {
            width: 16mm;
            text-align: center;
            font-weight: 900;
          }
          .replacement-table tr:last-child td {
            border-bottom: none;
          }
        </style>
      </head>
      <body>
        ${pages
          .map(
            (pageRows, index) => `
              <section class="page">
                ${header}
                ${tableHtml(pageRows, totals)}
                ${legendHtml()}
              </section>
            `
          )
          .join("")}
        ${replacementHtml(orderedRows)}
      </body>
    </html>
  `;
}

async function buildPdf(fatturaId) {
  const [[session]] = await db.query(
    `SELECT * FROM fatture_sessioni WHERE id = ? LIMIT 1`,
    [fatturaId]
  );

  if (!session) {
    const err = new Error("Fattura non trovata");
    err.statusCode = 404;
    throw err;
  }

  const [rows] = await db.query(
    `
    SELECT
      fr.*,
      u.id_user,
      u.Nome,
      u.Cognome,
      u.Isolato,
      u.Scala,
      u.Interno
    FROM fatture_righe fr
    JOIN utenze_v2 u
      ON u.id = fr.id_utenza
    WHERE fr.id_fattura = ?
    ORDER BY u.id_user ASC, fr.id_utenza ASC
    `,
    [fatturaId]
  );

  if (!rows.length) {
    const err = new Error("Nessuna riga calcolata: esegui prima il calcolo contabilita");
    err.statusCode = 400;
    throw err;
  }

  const [[condominio]] = await db.query(
    `SELECT * FROM condomini_v2 WHERE id = ? LIMIT 1`,
    [session.id_condominio]
  );

  const [[contatto]] = await db.query(
    `
    SELECT *
    FROM condominio_contatti_v2
    WHERE condominio_id = ?
    ORDER BY created_at ASC
    LIMIT 1
    `,
    [session.id_condominio]
  );

  const [[periodoAttuale]] = await db.query(
    `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
    [session.id_periodo_attuale]
  );

  const [[periodoPrecedente]] = await db.query(
    `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
    [session.id_periodo_precedente]
  );

  const html = buildHtml({
    session,
    condominio,
    contatto,
    periodoAttuale,
    periodoPrecedente,
    rows,
  });

  let browser;
  let page;

  try {
    browser = await launchBrowser();
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(120000);
    page.setDefaultTimeout(120000);

    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });

    const buffer = await page.pdf({
      format: "A4",
      landscape: true,
      preferCSSPageSize: true,
      printBackground: true,
      margin: {
        top: "7mm",
        right: "7mm",
        bottom: "6mm",
        left: "7mm",
      },
    });

    const safeCondominio = String(condominio?.indirizzo || condominio?.nome || session.id_condominio)
      .replace(/[^\w.-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");

    return {
      buffer: Buffer.from(buffer),
      filename: `prospetto_Contabilita_${safeCondominio || "condominio"}.pdf`,
      condominioId: session.id_condominio,
      fatturaId,
      periodLabel: periodLabel(periodoAttuale, session),
    };
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
  }
}

module.exports = { buildPdf };
