// utils/puppeteer.js
const puppeteer = require("puppeteer");

let browserSlot = Promise.resolve();

function getBrowserConfig() {
  const isRender = Boolean(process.env.RENDER);

  return {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    ...(isRender && process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {}),
  };
}

async function launchBrowser() {
  let releaseSlot;
  const currentSlot = new Promise((resolve) => {
    releaseSlot = resolve;
  });
  const previousSlot = browserSlot;
  browserSlot = previousSlot.then(() => currentSlot);

  await previousSlot;

  let browser;
  try {
    browser = await puppeteer.launch(getBrowserConfig());
  } catch (error) {
    releaseSlot();
    throw error;
  }

  const originalClose = browser.close.bind(browser);
  let released = false;
  let closing = false;
  let closePromise = null;
  const release = () => {
    if (released) return;
    released = true;
    releaseSlot();
  };

  browser.close = () => {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      try {
        return await originalClose();
      } finally {
        release();
      }
    })();
    return closePromise;
  };
  browser.once("disconnected", () => {
    if (!closing) release();
  });

  return browser;
}

module.exports = { launchBrowser };
