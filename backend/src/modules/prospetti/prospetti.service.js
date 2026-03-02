const path = require("path");
const ejs = require("ejs");
const wkhtmltopdf = require("wkhtmltopdf");
const db = require("../../config/db"); // same as utenze service

function wkToBuffer(html, opts) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    wkhtmltopdf(html, opts)
      .on("error", reject)
      .on("data", (c) => chunks.push(c))
      .on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function n2(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buildPages(rows) {
  let nouperpage = 35;
  const nou = rows.length;

  if (nouperpage === nou) nouperpage -= 1;
  if (nouperpage > 0 && nou % nouperpage === 0) nouperpage -= 1;
  if (nouperpage <= 0) nouperpage = 35;

  const pages = [];
  for (let i = 0; i < rows.length; i += nouperpage) {
    pages.push(rows.slice(i, i + nouperpage));
  }
  return { pages, nouperpage };
}

async function buildCondObject(session, generale, totals, condo, admin) {
  // This cond object mimics what PHP expected
  return {
    codice: condo?.codice ?? session?.codice ?? "",
    scad: session?.scadenza ?? "", // or whatever you store
    condo: `${condo?.nome ?? ""}::${session?.period_label ?? ""}`,
    amministratore: admin?.nome ?? condo?.amministratore ?? "",
    tel: admin?.tel ?? condo?.tel ?? "",
    ind: admin?.indirizzo ?? condo?.indirizzo ?? "",
    sez: condo?.sezione ?? "",
    cat: condo?.categoria ?? "",
    ruolo: condo?.ruolo ?? "",
    tf: session?.tf_code ?? session?.tf ?? "1",
    nuae: `${condo?.nuae ?? 1}:${condo?.nuae_non_dom ?? ""}`,
    data: session?.data_lettura ?? session?.created_at ?? "",

    // general meter snapshot (match the ejs we gave you)
    attG: generale.attG,
    preG: generale.preG,
    consG: generale.consG,
    impG: generale.impG,
    depG: generale.depG,
    qfG: generale.qfG,
    totG: generale.totG,
    varie: generale.varie,

    numofusers: totals.numofusers,
    tot_cons: totals.tot_cons,
    tot_fasc: totals.tot_fasc,
    tot_DF: totals.tot_DF,
    tot_QF: totals.tot_QF,
    tot_DC: totals.tot_DC,
    tot_IMP: totals.tot_IMP,
    tot_IVA: totals.tot_IVA,
    tot_ArrP: totals.tot_ArrP,
    tot_ArrA: totals.tot_ArrA,
    tot_tot: totals.tot_tot,
  };
}

async function buildPdf(fatturaId) {
  // 1) session (fattura)
  const [[session]] = await db.query(
    `SELECT * FROM letture_sessioni WHERE id = ? LIMIT 1`,
    [fatturaId]
  );
  if (!session) throw new Error("Session not found");

  // 2) rows (frozen)
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
    JOIN utenze_v2 u ON u.id = fr.id_utenza
    WHERE fr.id_fattura = ?
    ORDER BY u.id_user ASC
    `,
    [fatturaId]
  );

  // 3) totals (compute from snapshot to print)
  const totals = {
    numofusers: rows.length,
    tot_cons: rows.reduce((s, r) => s + n2(r.consumo_totale), 0).toFixed(0),
    tot_fasc: rows.reduce((s, r) => s + n2(r.imp_acquedotto), 0).toFixed(2),
    tot_DF: rows.reduce((s, r) => s + n2(r.imp_fognatura) + n2(r.imp_depurazione), 0).toFixed(2),
    tot_QF: rows.reduce((s, r) => s + n2(r.imp_qf), 0).toFixed(2),
    tot_DC: rows.reduce((s, r) => s + n2(r.conguaglio), 0).toFixed(2),
    tot_IMP: rows.reduce((s, r) => s + n2(r.imp_oneri), 0).toFixed(2),
    tot_IVA: rows.reduce((s, r) => s + n2(r.imp_iva), 0).toFixed(2),
    // in PHP these were split prev/att. Here we just put all in "att"
    tot_ArrP: 0,
    tot_ArrA: rows.reduce((s, r) => s + n2(r.imp_arr), 0).toFixed(2),
    tot_tot: rows.reduce((s, r) => s + n2(r.totale), 0).toFixed(2),
  };

  // 4) general meter block - MUST come from session snapshot columns you already have
  const generale = {
    attG: session.attG ?? session.attuale_generale ?? "",
    preG: session.preG ?? session.precedente_generale ?? "",
    consG: session.consG ?? session.consumo_generale ?? "",
    impG: session.impG ?? session.imp_cons_generale ?? "",
    depG: session.depG ?? session.dep_fog_generale ?? "",
    qfG: session.qfG ?? session.qf_generale ?? 0,
    totG: session.totG ?? session.totale_generale ?? "",
    varie: session.varie ?? 0,
  };

  // 5) condo/admin info (adapt to your schema)
  const [[condo]] = await db.query(
    `SELECT * FROM condomini_v2 WHERE id = ? LIMIT 1`,
    [session.id_condominio]
  );
  // optional admin table
  const admin = null;

  const cond = await buildCondObject(session, generale, totals, condo, admin);

  // paginate rows like legacy
  const { pages, nouperpage } = buildPages(rows);

  const templatePath = path.join(__dirname, "templates", "prospetto.ejs");
  const html = await ejs.renderFile(templatePath, {
    cond,
    pages,
    allRows: rows,
    nouperpage,
    logoUrl: null,
  });

  const buffer = await wkToBuffer(html, {
    pageSize: "A4",
    orientation: "Landscape",
    marginTop: "1.60",
    marginRight: "0.67",
    marginBottom: "0.00",
    marginLeft: "0.67",
    enableLocalFileAccess: true,
  });

  return {
    buffer,
    filename: `prospetto_${session.id_condominio}_${fatturaId}.pdf`,
  };
}

module.exports = { buildPdf };