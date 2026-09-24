// utils/puppeteer.js
const puppeteer = require("puppeteer");

const DEFAULT_IDLE_TIMEOUT_MS = 15000;

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

function getBrowserIdleTimeoutMs() {
  const configured = Number(process.env.PUPPETEER_IDLE_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured < 0) return DEFAULT_IDLE_TIMEOUT_MS;
  return Math.min(Math.floor(configured), 60000);
}

function createBrowserPool({ launch, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS }) {
  let browserSlot = Promise.resolve();
  let sharedBrowser = null;
  let idleTimer = null;
  let activeRelease = null;

  const clearIdleTimer = () => {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  };

  const closeSharedBrowser = async () => {
    clearIdleTimer();
    if (!sharedBrowser || activeRelease) return false;
    const browser = sharedBrowser;
    sharedBrowser = null;
    try {
      await browser.close();
    } catch (error) {
      // A disconnected browser is already closed for practical purposes.
      if (browser.connected !== false) throw error;
    }
    return true;
  };

  const scheduleIdleClose = () => {
    clearIdleTimer();
    if (idleTimeoutMs === 0) {
      void closeSharedBrowser().catch((error) => {
        console.warn("Impossibile chiudere Chromium:", error?.message);
      });
      return;
    }
    idleTimer = setTimeout(() => {
      idleTimer = null;
      void closeSharedBrowser().catch((error) => {
        console.warn("Impossibile chiudere Chromium:", error?.message);
      });
    }, idleTimeoutMs);
    idleTimer.unref?.();
  };

  const getSharedBrowser = async () => {
    if (sharedBrowser && sharedBrowser.connected !== false) return sharedBrowser;
    sharedBrowser = await launch();
    const browser = sharedBrowser;
    browser.once?.("disconnected", () => {
      if (sharedBrowser === browser) sharedBrowser = null;
      activeRelease?.();
    });
    return browser;
  };

  const launchBrowser = async () => {
    let releaseSlot;
    const currentSlot = new Promise((resolve) => {
      releaseSlot = resolve;
    });
    const previousSlot = browserSlot;
    browserSlot = previousSlot.then(() => currentSlot);

    await previousSlot;
    clearIdleTimer();

    let browser;
    try {
      browser = await getSharedBrowser();
    } catch (error) {
      releaseSlot();
      throw error;
    }

    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      if (activeRelease === release) activeRelease = null;
      releaseSlot();
      scheduleIdleClose();
    };
    activeRelease = release;

    // close() releases this exclusive job. The underlying browser remains
    // warm briefly so a following prospetto/export avoids another startup.
    return new Proxy(browser, {
      get(target, property) {
        if (property === "close") return release;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };

  return { launchBrowser, closeSharedBrowser };
}

const browserPool = createBrowserPool({
  launch: () => puppeteer.launch(getBrowserConfig()),
  idleTimeoutMs: getBrowserIdleTimeoutMs(),
});

module.exports = {
  createBrowserPool,
  getBrowserIdleTimeoutMs,
  launchBrowser: browserPool.launchBrowser,
  closeIdleBrowser: browserPool.closeSharedBrowser,
};
