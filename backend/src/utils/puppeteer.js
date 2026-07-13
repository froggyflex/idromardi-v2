// utils/puppeteer.js
const puppeteer = require("puppeteer");

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
  return puppeteer.launch(getBrowserConfig());
}

module.exports = { launchBrowser };
