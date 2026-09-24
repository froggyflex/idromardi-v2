const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const { generateRipartizioneCompletePdfBuffer, getRipartizionePdfChunkSize } = require("./fatture.pdf-renderer");

function fixture(failAt = -1) {
  const state = { opened: 0, closed: 0, chunks: [], buffers: [] };
  const browser = { async newPage() {
    state.opened++;
    let count;
    return {
      setDefaultNavigationTimeout() {}, setDefaultTimeout() {}, async emulateMediaType() {},
      async setContent(html) { count = (html.match(/class="invoice-sheet"/g) || []).length; state.chunks.push(count); },
      async pdf() {
        if (state.buffers.length === failAt) throw new Error("render failed");
        const pdf = await PDFDocument.create();
        for (let i = 0; i < count; i++) pdf.addPage([200 + state.buffers.length, 300]);
        const buffer = Buffer.from(await pdf.save());
        state.buffers.push(buffer);
        return buffer;
      },
      async close() { state.closed++; },
    };
  } };
  return { browser, state };
}

test("uses two bounded render passes for a typical 70-utenza condominium", () => {
  assert.equal(getRipartizionePdfChunkSize(), 35);
  assert.equal(Math.ceil(70 / getRipartizionePdfChunkSize()), 2);
});

test("bounded batches reuse one page and preserve PDF order and progress", async () => {
  const { browser, state } = fixture();
  const size = getRipartizionePdfChunkSize();
  const progress = [];
  const buffer = await generateRipartizioneCompletePdfBuffer({browser, righe: Array.from({length: size + 1}, () => ({})), onChunkComplete: (i, total) => progress.push([i,total])});
  const pdf = await PDFDocument.load(buffer);
  assert.equal(pdf.getPageCount(), size + 1);
  assert.deepEqual(pdf.getPages().map(page => page.getWidth()), [...Array(size).fill(200), 201]);
  assert.deepEqual(state.chunks, [size,1]);
  assert.deepEqual(progress, [[0,2],[1,2]]);
  assert.equal(state.opened, 1);
  assert.equal(state.closed, 1);
});

test("one invoice is returned directly without merging", async () => {
  const { browser, state } = fixture();
  const buffer = await generateRipartizioneCompletePdfBuffer({browser, righe:[{}]});
  assert.deepEqual(buffer, state.buffers[0]);
  assert.equal(state.closed, 1);
});

test("failed rendering closes its page and does not report completion", async () => {
  const { browser, state } = fixture(0);
  let progress = 0;
  await assert.rejects(generateRipartizioneCompletePdfBuffer({browser, righe:[{}], onChunkComplete: () => progress++}), /render failed/);
  assert.equal(state.closed, 1);
  assert.equal(progress, 0);
});

test("empty input is rejected before opening a browser page", async () => {
  const { browser, state } = fixture();
  await assert.rejects(generateRipartizioneCompletePdfBuffer({browser, righe:[]}), /Nessuna riga/);
  assert.equal(state.opened, 0);
});
