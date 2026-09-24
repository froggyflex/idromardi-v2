function addDateTokens(tokens, value) {
  if (!value) return;
  const raw = typeof value === "string" ? value.slice(0, 10) : "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = iso ? null : new Date(value);
  if (!iso && Number.isNaN(parsed.getTime())) return;
  const year = iso ? iso[1] : String(parsed.getFullYear());
  const month = iso ? iso[2] : String(parsed.getMonth() + 1).padStart(2, "0");
  const day = iso ? iso[3] : String(parsed.getDate()).padStart(2, "0");
  const shortMonth = String(Number(month));
  tokens.add(`${day}/${month}/${year}`);
  tokens.add(`${shortMonth}.${year}`);
  tokens.add(`${month}.${year}`);
  tokens.add(`${shortMonth}/${year}`);
  tokens.add(`${month}/${year}`);
}

function buildPeriodTokens(period) {
  const tokens = new Set();
  addDateTokens(tokens, period?.data_lettura_operatore);
  addDateTokens(tokens, period?.data_lettura_casa_idrica);
  const month = Number(period?.period_month);
  const year = Number(period?.period_year);
  if (Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year)) {
    tokens.add(`${month}.${year}`);
    tokens.add(`${String(month).padStart(2, "0")}.${year}`);
    tokens.add(`${month}/${year}`);
    tokens.add(`${String(month).padStart(2, "0")}/${year}`);
  }
  return [...tokens];
}

function scorePeriodMatch(invoice, previousPeriod, currentPeriod) {
  const description = String(invoice?.descrizione || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!description) return 0;
  const periodIndex = description.indexOf("periodo");
  const periodText = periodIndex >= 0
    ? description.slice(periodIndex, periodIndex + 220)
    : description;
  const previousMatches = buildPeriodTokens(previousPeriod)
    .filter((token) => periodText.includes(token));
  const currentMatches = buildPeriodTokens(currentPeriod)
    .filter((token) => periodText.includes(token));
  if (!previousMatches.length || !currentMatches.length) return 0;
  const score = (tokens) => tokens.some((token) => /^\d{2}\/\d{2}\/\d{4}$/.test(token))
    ? 4
    : 2;
  return score(previousMatches) + score(currentMatches);
}

function findBestIssuedInvoice(invoices, previousPeriod, currentPeriod) {
  return (Array.isArray(invoices) ? invoices : [])
    .map((invoice) => ({
      invoice,
      score: scorePeriodMatch(invoice, previousPeriod, currentPeriod),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.invoice.created_at || 0).getTime() -
        new Date(a.invoice.created_at || 0).getTime();
    })[0]?.invoice || null;
}

function formatPeriodLabel(previousPeriod, currentPeriod) {
  const format = (period) => {
    const month = Number(period?.period_month);
    const year = Number(period?.period_year);
    if (!Number.isInteger(month) || !Number.isInteger(year)) return "";
    return `${String(month).padStart(2, "0")}/${year}`;
  };
  const previous = format(previousPeriod);
  const current = format(currentPeriod);
  return previous && current ? `${previous} - ${current}` : previous || current || null;
}

module.exports = {
  buildPeriodTokens,
  findBestIssuedInvoice,
  formatPeriodLabel,
  scorePeriodMatch,
};
