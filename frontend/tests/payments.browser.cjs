const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const express = require('../../backend/node_modules/express');
const puppeteer = require('../../backend/node_modules/puppeteer');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.codex-remote-attachments', 'payments-qa');
fs.mkdirSync(output, { recursive: true });
const payments = Array.from({ length: 53 }, (_, index) => ({
  id: `payment-${index + 1}`, numero_progressivo: index === 1 ? null : index + 1,
  numero: `PG-${index + 1}-CONDOMINIO`, payment_method: 'BONIFICO',
  stato: index % 3 === 0 ? 'ANNULLATO' : 'ALLOCATO',
  data_pagamento: `2026-10-${String(index % 28 + 1).padStart(2, '0')}`,
  created_at: `2026-11-${String(28 - index % 28).padStart(2, '0')}`,
  importo: 100 + index, totale_allocato: 100 + index, descrizione: `Quota ${index + 1}`,
})).reverse();

(async () => {
  const app = express(); app.use(express.static(path.join(root, 'frontend/dist')));
  app.get(/.*/, (req, res) => res.sendFile(path.join(root, 'frontend/dist/index.html')));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined), headless: true, pipe: true, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1000 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('idromardi_auth_token', 'test-token');
      localStorage.setItem('idromardi_auth_user', JSON.stringify({ username: 'admin', role: 'ADMIN' }));
    });
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const url = new URL(request.url());
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type' };
      if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
      if (['fetch', 'xhr'].includes(request.resourceType())) {
        const route = url.pathname.replace(/^\/api/, ''); let data = {};
        if (route === '/financial-summary') data = { summary: { totaleInsolutoProforme: 0, totaleInsolutoFatture: 0, totaleIncassato: 6500 } };
        else if (route === '/financial-summary/recent') data = { rows: [] };
        else if (route === '/financial-summary/imported-documents') data = { items: [], total: 0, page: 1, totalPages: 1 };
        else if (route === '/financial-summary/payments') data = payments;
        else if (route.startsWith('/financial-summary/payments/')) data = { ...payments.find(payment => route.endsWith(`/${payment.id}`)), allocations: [] };
        else if (route === '/meta/unread') data = { total: 0 };
        return request.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(data) });
      }
      if (url.origin === base || url.protocol === 'data:') return request.continue();
      return request.abort();
    });
    await page.goto(`${base}/admin/contabilita`);
    await page.waitForFunction(() => document.body.innerText.includes('Totale INCASSATO'));
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Dettagli' && button.closest('article')?.innerText.includes('Totale INCASSATO')).click());
    const table = 'table[aria-label="Pagamenti registrati"]';
    const next = 'button[aria-label="Pagina successiva pagamenti"]';
    const previous = 'button[aria-label="Pagina precedente pagamenti"]';
    const rows = () => page.$$eval(`${table} tbody tr`, rows => rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent.trim())));
    const clearSearch = async () => { await page.click('[aria-label="Cerca pagamenti"]', { clickCount: 3 }); await page.keyboard.press('Backspace'); };
    await page.waitForFunction(table => document.querySelectorAll(`${table} tbody tr`).length === 25, {}, table);
    assert(await page.$eval(`${table} th[aria-sort="descending"]`, th => th.innerText.includes('Data')));
    assert(await page.$eval(previous, button => button.disabled));
    const allRows = [];
    for (const count of [25, 25, 3]) {
      const current = await rows(); assert.equal(current.length, count); allRows.push(...current);
      if (count === 3) break;
      await page.click(next);
    }
    assert.equal(new Set(allRows.map(row => row[0])).size, 53);
    assert(allRows.every(row => /^\d{6}$/.test(row[0])));
    const dates = allRows.map(row => row[2].split('/').reverse().map(part => part.padStart(2, '0')).join('-'));
    assert(dates.every((date, index) => index === 0 || dates[index - 1] >= date));
    assert(await page.$eval(next, button => button.disabled));
    assert((await page.$eval('[aria-label="Paginazione pagamenti"]', element => element.innerText)).includes('51–53 di 53'));
    await (await page.$('section[aria-label="Pagamenti registrati"]')).screenshot({ path: path.join(output, 'payments-desktop.png') });
    const selected = (await rows())[0][0];
    await page.click(`${table} tbody tr button`); await page.waitForSelector('[role="dialog"]');
    assert.equal(await page.$eval('#payment-detail-title', element => element.textContent), `Dettaglio pagamento ${selected}`);
    await page.keyboard.press('Escape'); await page.waitForSelector('[role="dialog"]', { hidden: true });
    assert((await page.$eval('[aria-label="Paginazione pagamenti"]', element => element.innerText)).includes('Pagina 3 di 3'));
    await page.click(`${table} button[title="Ordina per Numero"]`);
    assert.deepEqual((await rows()).slice(0, 3).map(row => row[0]), ['000001', '000002', '000003']);
    await page.click(`${table} button[title="Ordina per Numero"]`);
    assert.deepEqual((await rows()).slice(0, 3).map(row => row[0]), ['000053', '000052', '000051']);
    await page.click(next); await page.type('[aria-label="Cerca pagamenti"]', '000009');
    assert.equal((await rows()).length, 1); assert.equal((await rows())[0][0], '000009');
    assert((await page.$eval('[aria-label="Paginazione pagamenti"]', element => element.innerText)).includes('Pagina 1 di 1'));
    await clearSearch(); await page.select('[aria-label="Filtra stato pagamenti"]', 'ANNULLATO');
    assert.equal((await rows()).length, 18);
    await page.select('[aria-label="Filtra stato pagamenti"]', 'TUTTI');
    await page.select('[aria-label="Pagamenti per pagina"]', '50'); assert.equal((await rows()).length, 50);
    await page.click(next); assert.equal((await rows()).length, 3);
    await page.select('[aria-label="Pagamenti per pagina"]', '25'); assert.equal((await rows()).length, 25);
    await page.type('[aria-label="Cerca pagamenti"]', 'PG-9-CONDOMINIO'); assert.equal((await rows())[0][0], '000009');
    await clearSearch(); await page.type('[aria-label="Cerca pagamenti"]', 'inesistente');
    assert((await page.$eval(`${table} tbody`, element => element.innerText)).includes('Nessun pagamento trovato'));
    assert(await page.$eval(next, button => button.disabled)); assert(await page.$eval(previous, button => button.disabled));
    await clearSearch(); await page.click(`${table} button[title="Ordina per Data"]`);
    await page.click(next); await page.click(next); await page.setViewport({ width: 390, height: 844 });
    await (await page.$('section[aria-label="Pagamenti registrati"]')).screenshot({ path: path.join(output, 'payments-mobile.png') });
    assert(await page.$eval('[aria-label="Paginazione pagamenti"]', element => element.getBoundingClientRect().right <= window.innerWidth));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
    console.log('Payments UI passed: date order across pages, numeric sequence sorting, six-digit display, detail identity, search/filter reset, page sizes, empty results, and mobile overflow. Screenshots:', output);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
