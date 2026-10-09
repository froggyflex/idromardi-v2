const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const express = require('../../backend/node_modules/express');
const puppeteer = require('../../backend/node_modules/puppeteer');
const { samplePdf } = require('../../backend/scripts/test-pcloud-storage');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.codex-remote-attachments', 'pcloud-qa');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const app = express(); app.use(express.static(path.join(root, 'frontend/dist')));
  app.get(/.*/, (req, res) => res.sendFile(path.join(root, 'frontend/dist/index.html')));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined), headless: true, pipe: true, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1000 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const authSetup = await page.evaluateOnNewDocument(() => {
      localStorage.setItem('idromardi_auth_token', 'test-token');
      localStorage.setItem('idromardi_auth_user', JSON.stringify({ username: 'admin', role: 'ADMIN' }));
    });
    let configured = false, status = 'testing', polls = 0, downloaded = false;
    const pdf = await samplePdf('Bolletta di prova');
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const url = new URL(request.url());
      if (['blob:', 'chrome-extension:', 'chrome:', 'data:'].includes(url.protocol)) return request.continue();
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type' };
      if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
      if (['fetch', 'xhr'].includes(request.resourceType())) {
        const route = url.pathname.replace(/^\/api/, ''); let data = {};
        if (route === '/pcloud-test/settings') data = { configured };
        else if (route === '/pcloud-test/sessions' && request.method() === 'POST') {
          assert.equal(request.headers().authorization, 'Bearer test-token');
          data = { id: 'test-session', authorizeUrl: `${base}/mock-pcloud` };
        } else if (route === '/pcloud-test/sessions/test-session') {
          polls++;
          data = { id: 'test-session', status, report: status === 'complete' ? {
            capacity: { totalBytes: 10e12, usedBytes: 1e12, freeBytes: 9e12 },
            documents: ['bolletta', 'prospetto'].map(kind => ({ kind, verified: true, uploadMs: 120, previewMs: 90, downloadMs: 80 })),
          } : undefined, error: status === 'failed' ? 'Autorizzazione pCloud non concessa.' : undefined };
        } else if (route.startsWith('/pcloud-test/sessions/test-session/documents/')) {
          assert.equal(request.headers().authorization, 'Bearer test-token');
          if (url.searchParams.get('download') === '1') downloaded = true;
          return request.respond({ status: 200, headers, contentType: 'application/pdf', body: pdf });
        } else if (route === '/meta/unread') data = { total: 0 };
        else if (route === '/dashboard/map') data = [];
        return request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(data) });
      }
      if (url.pathname === '/mock-pcloud') return request.respond({ status: 200, contentType: 'text/html', body: '<p>Authorisation page</p>' });
      if (url.origin === base) return request.continue();
      return request.abort();
    });
    const section = 'section[aria-label="Test archivio pCloud"]';
    await page.goto(`${base}/admin/pcloud-test`);
    await page.waitForFunction(() => document.body.innerText.includes('Collegamento non ancora configurato'));
    assert(await page.$eval(`${section} button`, button => button.disabled));
    configured = true;
    await page.reload(); await page.waitForFunction(section => !document.querySelector(`${section} button`).disabled, {}, section);
    await page.click(`${section} button`);
    await page.waitForFunction(() => window.location.pathname === '/mock-pcloud');
    assert.equal(page.url(), `${base}/mock-pcloud`);
    await page.goto(`${base}/admin/pcloud-test?session=test-session`);
    await page.waitForFunction(() => document.body.innerText.includes('Caricamento e verifica dei PDF in corso'));
    status = 'complete';
    await page.waitForFunction(() => document.body.innerText.includes('Test completato'));
    assert(polls >= 2);
    assert((await page.$eval(section, element => element.innerText)).includes('10 TB'));
    assert.equal(await page.$$eval(`${section} button`, buttons => buttons.filter(button => button.textContent === 'Visualizza').length), 2);
    await (await page.$(section)).screenshot({ path: path.join(output, 'pcloud-desktop.png') });
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(output, 'pcloud-mobile.png'), fullPage: true });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Visualizza').click());
    await page.waitForSelector('dialog[open]');
    assert.equal(await page.$eval('dialog iframe', frame => frame.title), 'Bolletta di prova');
    await page.keyboard.press('Escape'); await page.waitForSelector('dialog', { hidden: true });
    await page.click('[aria-label="Scarica bolletta di prova"]');
    await page.waitForFunction(() => !document.querySelector('[aria-label="Scarica bolletta di prova"]').disabled);
    assert(downloaded);
    status = 'failed';
    await page.reload(); await page.waitForSelector('[role="alert"]');
    assert((await page.$eval('[role="alert"]', element => element.innerText)).includes('non concessa'));
    await page.removeScriptToEvaluateOnNewDocument(authSetup.identifier);
    await page.evaluate(() => localStorage.setItem('idromardi_auth_user', JSON.stringify({ username: 'reviewer', role: 'REVIEWER' })));
    await page.goto(`${base}/admin/pcloud-test`);
    await page.waitForFunction(() => window.location.pathname === '/');
    assert.equal(await page.$(section), null);
    assert.deepEqual(errors, []);
    console.log('pCloud UI passed: setup state, authorisation, polling, preview, download, failure, admin access and mobile layout.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
