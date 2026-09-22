import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildRipartizionePdfHtml } = require('../../backend/src/modules/fatture/fatture.pdf');
const source = fs.readFileSync(new URL('../src/utils/ripartizionePdfPayload.ts', import.meta.url),'utf8');
const context = {exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);

test('compact request produces identical invoices including credit, storno and tariff details', () => {
  const row = {
    utenza:{id:'one',id_user:15,Nome:'Anna',Cognome:'De Luca',Isolato:101,Scala:'A',Interno:'12',unrelatedNotes:'x'.repeat(8000)},
    attuale:{valore_lettura:50,stato_lettura:'Y',photoMetadata:'x'.repeat(2000)},
    precedente:{valore_lettura:60},
    riga:{lettura_attuale:60,lettura_precedente:60,stato_attuale:'Y',consumo_totale:0,consumo_acconto:10,acconto:33,imp_acconto:11,depfog_acconto:12,storno_acconto:-18,storno_txt_aggiuntivo:-3,storno_legacy:-6,storno_legacy_periodo:'Marzo 2026',totale:45,imp_acquedotto:10,imp_fognatura:2,imp_depurazione:3,imp_qf:4,conguaglio:5,imp_oneri_base_display:2,imp_oneri:8,imp_oneri_perequazione_display:6,imp_iva:7,minimum_payable_credit_euro:9,credito_storno_residuo:10,imp_arr:0.01,debug:'x'.repeat(8000)},
  };
  const input = {righe:[row, {...row,utenza:{...row.utenza,id:'two'},riga:null}],dettaglioByUtenza:{one:[{label:'agevolata',ordine:1,mc_allocati:12,importo:8,key:'one',unused:'x'.repeat(3000)}],unrelated:[{label:'unused'}]}};
  const compact = context.exports.buildRipartizionePdfPayload(input.righe,input.dettaglioByUtenza);
  const shared={trimestreLabel:'11/03/2026 - 18/06/2026',dataLettura:'18/06/2026',logoUrl:''};
  assert.equal(buildRipartizionePdfHtml({...input,...shared}),buildRipartizionePdfHtml({...compact,...shared}));
  assert(JSON.stringify(compact).length < JSON.stringify(input).length / 5);
  assert.equal(input.righe[0].riga.debug.length,8000);
});
