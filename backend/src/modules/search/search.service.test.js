const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeSearchLimit,
  normalizeSearchQuery,
  normalizeSearchScope,
  search,
} = require("./search.service");
const db = require("../../config/db");

test("normalizes global search input", () => {
  assert.equal(normalizeSearchQuery("  Via   Roma  12 "), "Via Roma 12");
  assert.equal(normalizeSearchScope("UTENZE"), "utenze");
  assert.equal(normalizeSearchScope("unknown"), "all");
});

test("keeps result limits within an operational range", () => {
  assert.equal(normalizeSearchLimit(undefined, "all"), 6);
  assert.equal(normalizeSearchLimit(undefined, "utenze"), 30);
  assert.equal(normalizeSearchLimit(0, "utenze"), 1);
  assert.equal(normalizeSearchLimit(500, "utenze"), 50);
});

test("maps an utenza search result to an actionable global result", async () => {
  const originalQuery = db.query;
  db.query = async (sql, params) => {
    assert.match(sql, /FROM utenze_v2 u/);
    assert.equal(params[0], "%Rossi%");
    return [[{
      id: "utenza-1",
      condominio_id: "condominio-1",
      id_user: 7,
      Nome: "Mario",
      Cognome: "Rossi",
      Interno: "4",
      Scala: "A",
      Isolato: "2",
      Matricola_Contatore: "ABC123",
      Contatore_Inverso: "SI",
      stato: "ATTIVA",
      condominio_codice: 42,
      condominio_nome: "Condominio Centro",
      condominio_indirizzo: "Via Roma 12",
    }]];
  };

  try {
    const result = await search({ query: "Rossi", scope: "utenze", limit: 10 });
    assert.equal(result.total, 1);
    assert.deepEqual(result.groups.utenze[0], {
      type: "utenza",
      id: "utenza-1",
      condominioId: "condominio-1",
      title: "Rossi Mario",
      subtitle: "Condominio Centro",
      status: "ATTIVA",
      userNumber: "7",
      meterNumber: "ABC123",
      apartment: "4",
      staircase: "A",
      block: "2",
      inverseMeter: true,
      condominioCode: "42",
    });
  } finally {
    db.query = originalQuery;
  }
});
