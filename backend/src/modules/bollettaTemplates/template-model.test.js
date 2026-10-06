const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_TEMPLATE, validateOverrides, resolveTemplate, diffTemplate } = require("./template-model");
const { buildRipartizionePdfHtml } = require("../fatture/fatture.pdf");

test("default edits propagate while condominium overrides survive", () => {
  const custom = resolveTemplate(DEFAULT_TEMPLATE, { labels: { water: "Servizio idrico" }, sections: { costs: { fontSize: 9 } } });
  const patch = diffTemplate(DEFAULT_TEMPLATE, custom);
  const updated = resolveTemplate(DEFAULT_TEMPLATE, { labels: { water: "Acqua", sewer: "Servizio fognario" }, page: { gap: 3 } });
  const effective = resolveTemplate(updated, patch);
  assert.equal(effective.labels.water, "Servizio idrico");
  assert.equal(effective.labels.sewer, "Servizio fognario");
  assert.equal(effective.page.gap, 3);
  assert.equal(effective.sections.costs.fontSize, 9);
  assert.equal(effective.sections.costs.padding, updated.sections.costs.padding);
  assert.deepEqual(diffTemplate(updated, updated), { labels: {}, page: {}, sections: {} });
});
test("untrusted layout values and unknown fields cannot become CSS", () => {
  for (const data of [{ page: { gap: "1; color:red" } }, { page: { mainWidth: 101 } }, { sections: { costs: { column: "hidden" } } }, { sections: { costs: { fontSize: 30 } } }, { labels: { total: "" } }, { labels: { nonexistent: "hidden" } }, { sections: { notes: { order: 1.5 } } }]) {
    assert.throws(() => validateOverrides(data), error => error.statusCode === 400);
  }
});
test("custom labels are escaped, sections move without changing billing values", () => {
  const template = resolveTemplate(DEFAULT_TEMPLATE, validateOverrides({ labels: { water: '<script>alert("x")</script>' }, sections: { costs: { column: "full" }, notes: { column: "main", order: 0 }, readings: { order: 1 } } }));
  const html = buildRipartizionePdfHtml({ template, righe: [{ riga: { imp_acquedotto: 42.5 } }] });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /42,50/);
  const body = html.slice(html.indexOf("<body>"));
  assert(body.indexOf('data-section="costs"') < body.indexOf('<div class="main-column">'));
  assert(body.indexOf('data-section="notes"') < body.indexOf('data-section="readings"'));
  for (const id of Object.keys(DEFAULT_TEMPLATE.sections)) assert.equal((body.match(new RegExp(`data-section="${id}"`, "g")) || []).length, 1);
});
