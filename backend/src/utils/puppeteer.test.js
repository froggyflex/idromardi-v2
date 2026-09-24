const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createBrowserPool } = require("./puppeteer");

function fixture(idleTimeoutMs = 15000) {
  const state = { launches: 0, closes: 0, pages: 0 };
  const pool = createBrowserPool({
    idleTimeoutMs,
    async launch() {
      state.launches += 1;
      const browser = new EventEmitter();
      browser.connected = true;
      browser.newPage = async () => ({ id: ++state.pages });
      browser.close = async () => {
        if (!browser.connected) return;
        browser.connected = false;
        state.closes += 1;
        browser.emit("disconnected");
      };
      return browser;
    },
  });
  return { pool, state };
}

test("reuses the warm browser for consecutive PDF jobs", async () => {
  const { pool, state } = fixture();
  const first = await pool.launchBrowser();
  assert.equal((await first.newPage()).id, 1);
  await first.close();

  const second = await pool.launchBrowser();
  assert.equal((await second.newPage()).id, 2);
  await second.close();

  assert.equal(state.launches, 1);
  assert.equal(state.closes, 0);
  assert.equal(await pool.closeSharedBrowser(), true);
  assert.equal(state.closes, 1);
});

test("serializes PDF jobs while sharing the browser process", async () => {
  const { pool, state } = fixture();
  const first = await pool.launchBrowser();
  let secondResolved = false;
  const secondPromise = pool.launchBrowser().then((browser) => {
    secondResolved = true;
    return browser;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondResolved, false);
  await first.close();
  const second = await secondPromise;
  assert.equal(state.launches, 1);
  await second.close();
  await pool.closeSharedBrowser();
});

test("zero idle timeout closes Chromium after every job", async () => {
  const { pool, state } = fixture(0);
  const first = await pool.launchBrowser();
  await first.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.closes, 1);

  const second = await pool.launchBrowser();
  await second.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.launches, 2);
  assert.equal(state.closes, 2);
});
