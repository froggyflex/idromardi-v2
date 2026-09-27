const puppeteer = require('../../backend/node_modules/puppeteer');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const out = path.resolve(__dirname, '../../.codex-remote-attachments');
fs.mkdirSync(out, {recursive:true});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const periods = [
  {id:'march',period_year:2026,period_month:3,stato:'CHIUSA',registered_rows:3,registered_values:3,data_lettura_operatore:'2026-03-11'},
  {id:'empty',period_year:2026,period_month:9,stato:'BOZZA',registered_rows:0,registered_values:0},
  {id:'june',period_year:2026,period_month:6,stato:'BOZZA',registered_rows:2,registered_values:1,data_lettura_operatore:'2026-06-18'},
];
const grid = [{utenza:{id:'u1',id_user:'1',Nome:'Mario',Cognome:'Rossi',Interno:'1'},current:{valore:120,stato:'K',persisted:true},history:[]}];
(async () => {
  const browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,args:['--no-sandbox','--disable-gpu']});
  try {
    const page = await browser.newPage();
    const errors = [], writes = [], loaded = [];
    let confirmations = 0;
    page.on('dialog',async dialog=>{confirmations++;await dialog.dismiss();});
    let failPeriods = false, failGrid = false, slowGrid = false;
    page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:1280,height:832});
    await page.evaluateOnNewDocument(()=>{
      localStorage.setItem('idromardi_auth_token','readings-ui-test');
      localStorage.setItem('idromardi_auth_user',JSON.stringify({username:'test',role:'admin'}));
    });
    await page.setRequestInterception(true);
    page.on('request',async request=>{
      const url = new URL(request.url());
      if(request.method()==='OPTIONS') return request.respond({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'authorization,content-type'}});
      if(['xhr','fetch'].includes(request.resourceType())){
        const p=url.pathname.replace(/^\/api/,'');
        if(request.method()!=='GET') writes.push({p,body:request.postData()});
        let body={},status=200;
        if(p.startsWith('/condomini/')) body={id:p.split('/')[2],nome:p.includes('other')?'Condominio Secondo':'Via Domenico Padula, 121 - Palazzo Carla'};
        else if(p.match(/^\/letture\/condomini\/[^/]+\/sessioni$/)){
          if(failPeriods){status=500;body={message:'Errore test'};}
          else body={items:p.includes('/empty/')?[]:p.includes('/other/')?[{...periods[0],id:'other',period_month:5}]:periods};
        } else if(p.match(/^\/letture\/sessioni\/[^/]+$/)){
          const id=p.split('/').pop();loaded.push(id);
          if(slowGrid && id==='june') await delay(800);
          if(failGrid){status=500;body={message:'Periodo non disponibile'};}
          else body={session:id==='other'?{...periods[0],id,period_month:5}:periods.find(s=>s.id===id),states:[{codice:'K',descrizione:'Verificata'}],grid};
        } else if(p==='/auth/users') body={users:[{id:'op',username:'admin',role:'ADMIN'}]};
        else if(p==='/letture/sessioni'){
          const data=JSON.parse(request.postData());
          body={session:{id:'new',period_year:data.periodYear,period_month:data.periodMonth,stato:'BOZZA'}};
        }
        return request.respond({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
      }
      if(url.origin==='http://127.0.0.1:5173'||url.protocol==='data:') return request.continue();
      return request.abort();
    });
    const go = async id=>{
      await page.goto('http://127.0.0.1:5173/condomini/'+id+'/letture',{waitUntil:'domcontentloaded'});
    };
    const waitPeriod = async label=>{
      try { await page.waitForFunction(label=>document.querySelector('.readings-period-state')?.innerText.includes(label),{timeout:10000},label); }
      catch(error) { console.log('Period diagnostics',label,await page.evaluate(()=>({text:document.body.innerText.slice(0,1800),locator:document.querySelector('#reading-period')?.value})),loaded,writes); throw error; }
    };
    await go('demo');
    await waitPeriod('Giugno 2026');
    assert.equal(await page.$eval('#reading-period',e=>e.value),'18/06/2026');
    assert.equal(writes.length,0,'Automatic opening must be read-only');
    assert(!loaded.includes('empty'),'Skip newer empty sessions');
    for(const width of [1280,1440,1920,390]){
      await page.setViewport({width,height:832});
      if(width<1536) await page.evaluate(()=>document.querySelector('[aria-label="Chiudi menu"]')?.click());
      await delay(150);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const boxes=await page.$$eval('.readings-fields .input',els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
      for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++){
        const a=boxes[i],b=boxes[j];
        assert(a.x+a.w<=b.x+1||b.x+b.w<=a.x+1||a.y+a.h<=b.y+1||b.y+b.h<=a.y+1,'Date fields overlap');
      }
      await page.screenshot({path:path.join(out,'readings-verified-'+width+'.png')});
    }
    await page.setViewport({width:1280,height:832});
    const choose = async value=>{
      await page.click('#reading-period',{clickCount:3});
      await page.keyboard.type(value);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Tab');
    };
    await choose('11/03/2026');
    await waitPeriod('Marzo 2026');
    assert.equal(await page.$eval('#reading-operator-date',e=>e.disabled),true);
    assert.equal(writes.length,0,'Opening existing periods must not POST');
    await page.click('#reading-period');
    assert(await page.$('.reading-period-day--closed'));
    await page.select('.react-datepicker__month-select','5');
    await page.click('.react-datepicker__day--018:not(.react-datepicker__day--outside-month)');
    await waitPeriod('Giugno 2026');
    await choose('11/03/2026');
    await waitPeriod('Marzo 2026');
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Apri ultimo')).click());
    await waitPeriod('Giugno 2026');
    await page.click('#reading-operator-date',{clickCount:3});
    await page.keyboard.type('19/06/2026');await page.keyboard.press('Enter');await page.keyboard.press('Tab');
    assert.equal(confirmations,0);
    await choose('11/03/2026');
    assert(await page.$eval('.readings-period-state',e=>e.innerText.includes('Giugno')));
    assert.equal(await page.$eval('#reading-operator-date',e=>e.value),'19/06/2026');
    assert.equal(await page.$eval('#reading-period',e=>e.value),'18/06/2026');
    assert.equal(confirmations,1);
    await go('empty');
    await page.waitForFunction(()=>document.body.innerText.includes('Nessuna lettura ancora registrata'));
    assert.equal(await page.$('.readings-period-state'),null);
    assert.equal(writes.length,0);
    failPeriods=true;
    await go('demo');
    await page.waitForSelector('.readings-load-error');
    assert.equal(await page.$eval('#reading-period',e=>e.disabled),true);
    failPeriods=false;
    await page.click('.readings-load-error button');
    await waitPeriod('Giugno 2026');
    failGrid=true;
    await go('demo');
    await page.waitForSelector('.readings-load-error');
    assert.equal(await page.$('.readings-period-state'),null);
    failGrid=false;
    await page.click('.readings-load-error button');
    await waitPeriod('Giugno 2026');
    periods[2].data_lettura_operatore='2026-07-02';
    await go('demo');
    await waitPeriod('Giugno 2026');
    assert.equal(await page.$eval('#reading-period',e=>e.value),'01/06/2026');
    assert.equal(await page.$eval('#reading-operator-date',e=>e.value),'02/07/2026');
    slowGrid=true;
    await go('demo');
    await delay(200);
    await page.evaluate(()=>{
      history.pushState({},'', '/condomini/other/letture');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitPeriod('Maggio 2026');
    await delay(900);
    assert(await page.$eval('.readings-period-state',e=>e.innerText.includes('Maggio')));
    assert(await page.$eval('.readings-heading',e=>e.innerText.includes('Condominio Secondo')));
    assert.equal(writes.length,0);
    assert.deepEqual(errors,[]);
    console.log('Passed: latest populated period, read-only opening, manual selection, closed period, dirty guard, empty state, retries, period/date mismatch, stale condominium requests, 4 responsive viewports.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
