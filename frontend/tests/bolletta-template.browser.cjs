const puppeteer = require('../../backend/node_modules/puppeteer');
const { PDFDocument } = require('../../backend/node_modules/pdf-lib');
const { DEFAULT_TEMPLATE, SECTION_NAMES, resolveTemplate, diffTemplate } = require('../../backend/src/modules/bollettaTemplates/template-model');
const { previewHtml, inspectA4 } = require('../../backend/src/modules/bollettaTemplates/template-preview');
const { generateRipartizioneCompletePdfBuffer } = require('../../backend/src/modules/fatture/fatture.pdf-renderer');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const out = path.resolve(__dirname, '../../.codex-remote-attachments/template-qa');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined), headless: true, pipe: true, args: ['--no-sandbox'] });
  try {
    const render = await browser.newPage();
    await render.emulateMediaType('print');
    await render.setContent(previewHtml(DEFAULT_TEMPLATE), { waitUntil: 'load' });
    assert.deepEqual(await inspectA4(render), [], 'base template must fit A4 with all optional charges');
    await render.screenshot({ path: path.join(out, 'base-print.png'), fullPage: true });
    const oversized = resolveTemplate(DEFAULT_TEMPLATE, { sections: { costs: { column: 'side', padding: 6, fontSize: 12 } } });
    await render.setContent(previewHtml(oversized), { waitUntil: 'load' });
    assert((await inspectA4(render)).length > 0, 'overflow must be detected');
    await render.close();
    const pdf = await generateRipartizioneCompletePdfBuffer({ browser, template: DEFAULT_TEMPLATE, righe: Array.from({length: 36}, () => ({riga:{totale:12.5}})) });
    assert.equal((await PDFDocument.load(pdf)).getPageCount(), 36);
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.setViewport({ width: 1280, height: 832 });
    await page.evaluateOnNewDocument(() => {
      if (window !== window.top) return;
      localStorage.setItem('idromardi_auth_token', 'local-ui-test');
      localStorage.setItem('idromardi_auth_user', JSON.stringify({username:'test',role:'admin'}));
    });
    let base = structuredClone(DEFAULT_TEMPLATE), revisions = { default:0, demo:0 }, overrides = {}, saved = 0;
    function doc(scope) { return { scope, factory:DEFAULT_TEMPLATE, base, effective: scope === 'default' ? base : resolveTemplate(base, overrides), revision:revisions[scope], defaultRevision:revisions.default, sectionNames:SECTION_NAMES }; }
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const url = new URL(request.url());
      if (request.method() === 'OPTIONS') return request.respond({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Allow-Headers':'authorization,content-type'}});
      if (['xhr','fetch'].includes(request.resourceType())) {
        const p = url.pathname.replace(/^\/api/, '');
        let body = {};
        if (p === '/bolletta-templates/condomini') body = {items:[{id:'demo',nome:'Parco dei Fiori',codice:'41'}]};
        else if (p.startsWith('/bolletta-templates/')) {
          const scope = p.split('/')[2];
          if (p.endsWith('/preview')) body = {html:previewHtml(JSON.parse(request.postData()).template)};
          else if (request.method() === 'PUT') {
            const data = JSON.parse(request.postData());
            if (scope === 'default') base = data.template; else overrides = diffTemplate(base,data.template);
            revisions[scope]++; saved++; body = doc(scope);
          } else body = doc(scope);
        }
        return request.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
      }
      if (url.origin === 'http://127.0.0.1:5173' || url.protocol === 'data:') await request.continue(); else await request.abort();
    });
    await page.goto('http://127.0.0.1:5173/admin/bolletta-templates', {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => document.body.innerText.includes('Formato verificato'));
    await page.evaluate(()=>document.querySelector('[aria-label="Chiudi menu"]')?.click());
    for (const width of [1280,1440,390]) {
      await page.setViewport({width,height:832}); await delay(200);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`page overflow at ${width}`);
      await page.screenshot({path:path.join(out,`editor-${width}.png`),fullPage:true});
    }
    await page.setViewport({width:1280,height:832});
    await page.select('.bt-target select','demo');
    await page.waitForFunction(()=>document.body.innerText.includes('Parco dei Fiori') && document.body.innerText.includes('Formato verificato'));
    await page.evaluate(()=>[...document.querySelectorAll('.bt-tabs button')].find(b=>b.textContent==='Etichette').click());
    const input = await page.$('.bt-label input');
    await input.click({clickCount:3}); await input.type('Ripartizione Parco dei Fiori');
    await page.waitForFunction(()=>!document.querySelector('.bt-primary').disabled);
    await page.click('.bt-primary');
    await page.waitForFunction(()=>document.body.innerText.includes('Modello salvato e associato'));
    assert.equal(saved,1); assert.equal(overrides.labels.kicker,'Ripartizione Parco dei Fiori');
    await page.evaluate(()=>[...document.querySelectorAll('.bt-tabs button')].find(b=>b.textContent==='Impaginazione').click());
    await page.select('[aria-label="Colonna sezione"]','full');
    await page.waitForFunction(()=>!document.querySelector('.bt-primary').disabled);
    const frame = page.frames().find(f=>f!==page.mainFrame());
    assert(await frame.evaluate(()=>document.querySelector('.full-column [data-section="readings"]')!==null));
    await page.click('.bt-primary');
    await page.waitForFunction(()=>document.body.innerText.includes('Modello salvato e associato'));
    assert.equal(saved,2);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.body.innerText.includes('Formato verificato'));
    await page.select('.bt-target select','demo');
    await page.waitForFunction(()=>document.body.innerText.includes('Parco dei Fiori') && document.body.innerText.includes('Formato verificato'));
    const reloadedFrame = page.frames().find(f=>f!==page.mainFrame());
    assert(await reloadedFrame.evaluate(()=>document.querySelector('.full-column [data-section="readings"]')!==null));
    assert(await reloadedFrame.evaluate(()=>document.querySelector('.brand-kicker').textContent==='Ripartizione Parco dei Fiori'));
    const font = await page.$('.bt-number input');
    await font.click({clickCount:3}); await font.type('11'); await font.press('Tab');
    assert.equal(await page.$eval('.bt-number input',e=>e.value),'11');
    await page.click('[aria-label="Annulla modifica"]');
    assert.equal(await page.$eval('.bt-number input',e=>e.value),'8.4');
    await page.click('[aria-label="Ripeti modifica"]');
    assert.equal(await page.$eval('.bt-number input',e=>e.value),'11');
    assert.deepEqual(errors,[]);
    console.log('A4 fit/overflow, 36 invoice PDF pages, desktop/mobile layout, custom labels, section movement, save and reload verified.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
