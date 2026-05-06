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