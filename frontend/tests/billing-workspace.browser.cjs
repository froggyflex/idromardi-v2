const puppeteer = require('../../backend/node_modules/puppeteer');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
const outputDir = process.env.BILLING_QA_OUTPUT || path.join(root, '.codex-remote-attachments');
fs.mkdirSync(outputDir, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const condo = { id:'demo', nome:'Parco dei Fiori - Via Domenico Padula, 121', indirizzo:'Via Domenico Padula, 121', codice:'41' };
const session = { id:'period-1', id_condominio:'demo', id_casa_idrica:'asis', id_periodo_attuale:'june', id_periodo_precedente:'march', imported_document_id:'txt-1', stato:'CALCOLATA', tf_code:'TF1' };
session.periodo_attuale_data_operatore = '2026-06-18';
session.periodo_precedente_data_operatore = '2026-03-11';
const periods = [{id:'june',period_year:2026,period_month:6,data_lettura_operatore:'2026-06-18'}, {id:'march',period_year:2026,period_month:3,data_lettura_operatore:'2026-03-11'}];
const imported = { id:'txt-1', original_filename:'bolletta.txt', parse_status:'reviewed', validation_status:'valid', linked_session_id:'period-1', data_inizio_periodo:'2026-03-11', data_fine_periodo:'2026-06-18', importo_totale_da_pagare:2615.63, parsed_payload_json:'{}' };
imported.parsed_payload_json = JSON.stringify({ manual_overrides: {
 main: {lettura_precedente:1000,lettura_attuale:2066,consumo_mc:1066,acquedotto:1900,dep_fog:500,oneri:80,iva:250,totale:2730},
 acconto: {mc:100,acquedotto:150,dep_fog:50,quota_fissa:2,oneri:5,iva:20.7,totale:235},
 storno: {mc:120,acquedotto:170,dep_fog:60,quota_fissa:2,oneri:6,iva:23.8,totale:261.8},
} });
const docs = [{ id:'invoice-1', document_type:'fattura_emessa', filename:'Fattura 001354.pdf', period_label:'03/2026 - 06/2026'}, {id:'prospetto-1',document_type:'prospetto',filename:'prospetto_Parco_dei_Fiori.pdf',period_label:'03/2026 - 06/2026'}, {id:'bollette-1',document_type:'bollette_complete',filename:'bollette.pdf',period_label:'03/2026 - 06/2026'}];
const testRows = ['Rossi','De Luca','Della Valle Amministrazione'].map((Cognome,i)=>({
 utenza:{id:`user-${i}`,id_user:i+1,Nome:['Mario','Anna','Francesca'][i],Cognome,Scala:'A',Interno:String(i+1),Isolato:'101'},
 attuale:{valore_lettura:120+i,stato_lettura:'K'},precedente:{valore_lettura:100,stato_lettura:'K'},
 riga:{consumo:20+i,totale:50+i,quota_fissa:4.43,importo_acquedotto:20,importo_fognatura:5,importo_depurazione:5}
}));
(async () => {
 console.log('Launching browser');
 const browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),headless:true,pipe:true,args:['--no-sandbox','--disable-gpu']});
 console.log('Browser ready');
 try {
 const page = await browser.newPage();
 await page.setViewport({width:1280,height:832});
 await page.evaluateOnNewDocument(() => { localStorage.setItem('idromardi_auth_token','local-ui-test'); localStorage.setItem('idromardi_auth_user',JSON.stringify({username:'test',role:'admin'})); });
 let documentFailure = false, issued = true, generations = 0;
 const errors = [];
 page.on('pageerror',err => errors.push(err.message));
 await page.setRequestInterception(true);
 page.on('request', async request => {
  const url = new URL(request.url());
  if (request.method() === 'OPTIONS') {
   return request.respond({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'authorization,content-type'}});
  }
  if (['xhr','fetch'].includes(request.resourceType())) {
   let body = {}, status = 200;
   const p = url.pathname.replace(/^\/api/, '');
   if (p === '/condomini/demo') body = condo;
   else if (p === '/fatture/providers') body = [{id:'asis',nome:'ASIS',codice:'ASIS'}];
   else if (p === '/fatture/periodi/demo') body = periods;
   else if (p === '/fatture/condominio/demo') body = [session];
   else if (p.includes('/fatture/condomini/demo/fatture/')) body = {session,righe:testRows,condominio:condo,periodoAttuale:periods[0],periodoPrecedente:periods[1],linkedImportedDocument:imported};
   else if (p === '/fatture/imported-documents/txt-1') body = {document:imported};
   else if (p === '/fatture/imported-documents/condominio/demo') body = {items:[imported]};
   else if (p === '/fatture/generated-documents') { body = documentFailure ? {error:'Verifica documenti non disponibile'} : {documents:issued ? docs : docs.slice(1)}; if(documentFailure)status=500; }
   else if (p.endsWith('/prospetto/generate')) { generations++; await delay(1200); body = {document:docs[1]}; }
   else if (p.includes('/tariffe')) body = [];
   else if (p.includes('/letture/condomini/')) body = {items:[]};
   await request.respond({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
  } else if (url.origin === 'http://127.0.0.1:5173' || url.protocol === 'data:') await request.continue();
  else await request.abort();
 });
 await page.goto('http://127.0.0.1:5173/condomini/demo/fatture/period-1',{waitUntil:'domcontentloaded'});
 await delay(3000);
 await page.waitForFunction(() => document.body.innerText.includes('Visualizza fattura emessa'));
 assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Registra fattura')),false);
 assert(await page.evaluate(() => document.body.innerText.includes('Parco dei Fiori')));
 {
  assert(await page.$('[aria-label="Acconto rilevato"]'));
  assert(await page.$('[aria-label="Storno rilevato"]'));
  for (const width of [1280,1440,1920,390]) {
   await page.setViewport({width,height:900});
   if (width < 1536) await page.evaluate(()=>document.querySelector('[aria-label="Chiudi menu"]')?.click());
   await delay(250);
   for (const id of ['billing-summary','billing-documents','billing-readings']) {
    const label={'billing-summary':'Riepilogo','billing-documents':'Documenti','billing-readings':'Contatori'}[id];
    await page.evaluate(label=>[...document.querySelectorAll('nav[aria-label="Sezioni fatturazione"] button')].find(b=>b.textContent.includes(label)).click(),label);
    const visible=await page.evaluate(id=>{const e=document.getElementById(id);const header=document.querySelector('.billing-workspace .workspace-sticky');return {top:e.getBoundingClientRect().top,bottom:header.getBoundingClientRect().bottom};},id);
    assert(visible.top>=visible.bottom-2,`${width} ${id} overlaps header: ${JSON.stringify(visible)}`);
    await delay(50);
    const headerState = await page.evaluate(() => {
      const header = document.querySelector('.billing-header');
      const main = document.querySelector('.app-main');
      return {
        top: header.getBoundingClientRect().top,
        expected: main.getBoundingClientRect().top + (innerWidth < 1536 ? 48 : 0),
        background: getComputedStyle(header).backgroundColor,
        active: header.querySelector('[aria-current="location"]')?.textContent,
        tariffInside: !!header.querySelector('.billing-tariff'),
      };
    });
    assert(Math.abs(headerState.top-headerState.expected)<=1,`Sticky gap at ${width}: ${JSON.stringify(headerState)}`);
    assert.equal(headerState.background,'rgb(255, 255, 255)');
    assert.equal(headerState.tariffInside,false);
    assert(headerState.active?.includes(label),`Navigation did not track ${id}`);
    await page.screenshot({path:path.join(outputDir,`billing-verified-${width}-${id}.png`)});
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  const totalBefore=await page.$eval('.billing-readings-table tfoot',e=>e.innerText);
  await page.type('[aria-label="Cerca utenza"]','anna luca');
  assert.equal(await page.$$eval('.billing-readings-table tbody > tr',rows=>rows.length),1);
  assert(await page.$eval('.billing-readings-table tbody',e=>e.innerText.includes('Anna De Luca')));
  assert.equal(await page.$eval('.billing-readings-table tfoot',e=>e.innerText),totalBefore);
  await page.click('[aria-label="Cancella ricerca"]');
  await page.type('[aria-label="Cerca utenza"]','nonexistent');
  assert(await page.$eval('.billing-readings-table tbody',e=>e.innerText.includes('Nessuna utenza corrisponde')));
  await page.click('[aria-label="Cancella ricerca"]');
  assert.equal(await page.$$eval('.billing-readings-table tbody > tr',rows=>rows.length),3);
  await page.evaluate(()=>[...document.querySelectorAll('nav[aria-label="Sezioni fatturazione"] button')][0].click());
  const headerHeight = await page.$eval('.billing-header',e=>e.getBoundingClientRect().height);
  await page.click('.billing-tariff summary');
  assert.equal(await page.$eval('.billing-tariff',e=>e.open),true);
  assert.equal(await page.$eval('.billing-header',e=>e.getBoundingClientRect().height),headerHeight);
  await page.click('.billing-tariff summary');
  const days=await page.$('#billing-preparation-body input[type="number"]');
  await days.click({clickCount:3});await days.type('92');
  await page.click('[aria-controls="billing-preparation-body"]');
  assert.equal(await page.$eval('#billing-preparation-body',e=>e.hidden),true);
  await page.click('[aria-controls="billing-preparation-body"]');
  assert.equal(await days.evaluate(e=>e.value),'92');
  assert.deepEqual(errors,[]);
  assert(await page.$eval('.billing-reconciliation-result',e=>e.innerText.includes('-2.462,63')));
  assert.equal(await page.$eval('.billing-breakdown tbody tr:nth-child(3) td',e=>e.rowSpan),2);
  assert.equal(await page.$$eval('.billing-breakdown tbody tr:nth-child(4) td',cells=>cells.length),0);
  const payload = JSON.parse(imported.parsed_payload_json);
  payload.manual_overrides.main.fognatura = 200;
  payload.manual_overrides.main.depurazione = 300;
  payload.manual_overrides.storno.acquedotto = -170;
  imported.parsed_payload_json = JSON.stringify(payload);
  imported.importo_totale_da_pagare = 153;
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => document.querySelector('.billing-reconciliation-result')?.innerText.includes('Ripartito = dovuto'));
  assert.equal(await page.$eval('.billing-breakdown tbody tr:nth-child(3) td',e=>e.rowSpan),1);
  assert.equal(await page.$eval('.billing-breakdown tbody tr:nth-child(3) td',e=>e.innerText),'200,00');
  assert.equal(await page.$eval('.billing-breakdown tbody tr:nth-child(4) td',e=>e.innerText),'300,00');
  // Manual storno values are displayed as positive magnitudes by the existing parser.
  assert.equal(await page.$eval('.billing-breakdown tbody tr:nth-child(2) td:last-child',e=>e.innerText),'170,00');
  assert(await page.$eval('.billing-audit-status',e=>e.innerText.includes('Da verificare')));
  assert(await page.$eval('.billing-reconciliation-result strong',e=>e.innerText.includes('0,00')));
  assert.deepEqual(errors,[]);
  console.log('Billing interactions passed: 4 viewports, opaque gap-free sticky header, active navigation, tariff disclosure, reconciliation, combined service cells, no overflow, row search, unchanged totals, preserved edits.');
  return;
 }
 } finally { await browser.close(); }
})().catch(err=>{console.error(err);process.exitCode=1;});
