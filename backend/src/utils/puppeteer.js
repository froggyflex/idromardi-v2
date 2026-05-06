// utils/puppeteer.js
const puppeteer = require("puppeteer");

function getBrowserConfig() {
  const isRender = !!process.env.RENDER;

  if (isRender) {
    return {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    };
  }

  // LOCAL
  return {
    headless: true,
  };
}

async function launchBrowser() {
  const config = getBrowserConfig();
  return puppeteer.launch(config);
}

module.exports = { launchBrowser };