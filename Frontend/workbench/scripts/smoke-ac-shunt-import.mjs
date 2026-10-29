import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { generic5790, nominalY5020Resolution } from '../src/modules/uncertainty/utils/testFixtures/generic5790.js';

// Run against the full Workbench dev server: WORKBENCH_URL=http://127.0.0.1:3197
const url=process.env.WORKBENCH_URL || 'http://127.0.0.1:3197';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const source={id:11,name:'Y5020 import smoke',createdAt:'2026-10-02T00:00:00Z',
  generic5790Instrument:generic5790,
  instruments:{test_instrument_model:'Y5020',test_instrument_serial:'TEST-20',standard_instrument_model:'Y5020',
    standard_instrument_serial:'STD-20'},points:[6.9,10,20].map(current=>({
      current,frequency:1000,sourcePointIds:[current*10,current*10+1],
      readerResolution:nominalY5020Resolution(current),
      analytics:{pair_type_a_uncertainty_ppm:1.2,n_pairs_used:5,pair_delta_uut_ppm:2.5}}))};
const reference={id:'nist-reference',type:'tmde',scope:'validated',manufacturer:'Fluke',model:'Y5020 · STD-20',description:'NIST reference',
  functions:[{id:'current',name:'Current',unit:'A',ranges:source.points.map(point=>({
    id:`range-${point.current}`,min:point.current,max:point.current,value:point.current,isSingleValue:true,unit:'A',
    qualifier:{min:1000,max:1000,value:1000,isSingleValue:true,unit:'Hz'},
    tolerances:{reading:{high:point.current===20?46:35,low:point.current===20?-46:-35,unit:'ppm',distribution:'1.960',symmetric:true}},
    acShuntSource:{serial:'STD-20',model:'Y5020'}}))}]};
const ti={id:'library-ti',type:'uut',scope:'validated',manufacturer:'Fluke',model:'Y5020 · TEST-20',description:'Lab TI',
  functions:[{id:'ti-current',name:'Current',unit:'A',ranges:source.points.map(point=>({
    id:`ti-range-${point.current}`,min:point.current,max:point.current,value:point.current,isSingleValue:true,unit:'A',
    qualifier:{min:1000,max:1000,value:1000,isSingleValue:true,unit:'Hz'},
    tolerances:{reading:{high:100,low:-100,unit:'ppm',distribution:'not_set',symmetric:true}},
    acShuntSource:{serial:'TEST-20',model:'Y5020',role:'uut'}}))}]};
let saved;
await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let data=[];
  if(path.endsWith('/uncertainty/instruments/'))data=[reference,ti,generic5790];
  else if(path.endsWith('/ac-shunt/sessions/'))data={available:true,sessions:[{id:11,session_name:source.name,test_instrument_model:'Y5020',test_instrument_serial:'TEST-20',created_at:source.createdAt}],page:1,pages:1};
  else if(path.endsWith('/ac-shunt/sessions/11/'))data=source;
  else if(route.request().method()==='PUT' && /uncertainty\/sessions\/\d+\/$/.test(path)){saved=route.request().postDataJSON();data=saved;}
  else if(path.includes('system_info'))data={database_type:'sqlite3'};
  else if(path.includes('/info'))data={status:'ready'};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
try {
  await page.goto(`${url}/#/uncertainty`);
  const button=page.getByRole('button',{name:'Import AC/DC shunt session',exact:true});
  await button.waitFor({timeout:90000});
  console.log('Workbench loaded.');
  await page.getByRole('button',{name:'Close walkthrough',exact:true}).click();
  assert.equal(await button.evaluate(b=>b.previousElementSibling?.getAttribute('aria-label')),'Unit converter');
  await button.click();
  await page.getByRole('button',{name:/Y5020 import smoke/}).click();
  await page.getByText('3 measurement points',{exact:true}).waitFor();
  assert.equal(await page.locator('dialog.ac-shunt-import select').count(),0);
  mkdirSync('tmp/ac-shunt-import',{recursive:true});
  await page.screenshot({path:'tmp/ac-shunt-import/preview.png'});
  await page.getByRole('button',{name:'Create budget',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog.ac-shunt-import'));
  console.log('Imported session saved.');
  assert.equal(saved.testPoints.length,3);
  assert.equal(saved.testPoints[0].components[0].dof,4);
  assert.equal(saved.tmdes.length,2);
  assert.equal(saved.tmdes[1].instrument.sourceId,generic5790.id);
  assert.equal(saved.tmdes[1].instrument.functions[0].ranges[1].resolution,1e-7);
  assert.equal(saved.tmdes[0].libraryInstrumentId,'nist-reference');
  assert.equal(saved.tmdes[0].name,'NIST reference');
  assert.equal(saved.uuts[0].libraryInstrumentId,'library-ti');
  assert.equal(saved.uuts[0].instrument.sourceId,'library-ti');
  assert.equal(saved.uuts[0].instrument.model,'Y5020 · TEST-20');
  assert.equal(saved.uuts[0].instrument.manufacturer,'Fluke');
  assert.equal(saved.testPoints[0].testPointInfo.measurementArea,'Current');
  assert.ok(saved.testPoints.every(p=>p.testPointInfo.qualifier.value===1000 && p.testPointInfo.qualifier.unit==='Hz'));
  assert.ok(saved.testPoints.every(p=>p.testPointInfo.acShuntSource.deltaPpm===2.5));
  assert.ok(saved.testPoints.every(p=>p.components.length===4 && p.components.every(c=>!c.pendingReason)));
  assert.ok(saved.testPoints.every(p=>p.components[3].isResolution && p.components[3].tmdeBudgetSourceId===saved.tmdes[1].id));
  assert.ok(saved.testPoints.every(p=>p.uutTolerance.tolerances.reading.high===100 && p.uutTolerance.tolerances.reading.low===-100));
  assert.ok(saved.testPoints.every(p=>!p.uutTolerance.tolerances.bias));
  assert.ok(saved.testPoints.every(p=>p.expanded_uncertainty_absolute_base>0));
  assert.ok(saved.testPoints.every(p=>p.measurementType==='direct' && !p.equationString));
  assert.ok(saved.testPoints.every(p=>p.components[0].originalInput.standardUncertainty===1.2));
  assert.ok(saved.testPoints.every(p=>p.components[1].name==='Fluke 5790B Variability' && p.components[1].isInlineManual &&
    p.components[1].originalInput.tolerance.floor.high===5 && p.components[1].distribution==='Rectangular'));
  assert.ok(saved.testPoints.every(p=>p.components[2].tmdeBudgetSourceId===saved.tmdes[0].id));
  const expandArea=page.getByRole('button',{name:'Expand measurement area',exact:true});
  if(await expandArea.count()) await expandArea.click();
  await page.getByRole('button',{name:'Columns',exact:true}).click();
  await page.getByRole('button',{name:'Add TAR column',exact:true}).click();
  await page.getByRole('button',{name:'Close column settings',exact:true}).click();
  console.log('Sidebar metrics displayed.');
  const rows=page.locator('[data-point-id]');
  assert.equal(await rows.count(),3);
  assert.equal(await rows.first().locator('[data-sidebar-column="section"]').count(),0);
  assert.equal(await rows.first().locator('[data-sidebar-column="value"] + [data-sidebar-column="qualifier"]').count(),1);
  assert.match(await rows.first().locator('[data-sidebar-column="qualifier"]').innerText(),/1000 Hz/);
  writeFileSync('tmp/ac-shunt-import/point-row.html',await rows.first().evaluate(el=>el.outerHTML));
  for (const row of await rows.all()) {
    for (const metric of ['TUR','PFA','PFR']) {
      const cell=row.locator(`[data-sidebar-column="${metric.toLowerCase()}"]`).first();
      assert.equal(await cell.count(),1,`${metric} column is visible`);
      assert.ok(Number.isFinite(Number((await cell.innerText()).replace('%',''))),`${metric} must be calculated`);
    }
  }
  await rows.first().click({position:{x:2,y:2}});
  await page.getByRole('button',{name:'Uncertainty Budget',exact:true}).click();
  await page.getByText('Fluke 5790B Variability',{exact:true}).first().waitFor();
  const body=await page.locator('body').innerText();
  assert.match(body,/Imported AC–DC difference: 2.5 ppm/);
  assert.match(body,/Rectangular/);
  assert.match(body,/Normal \(95%\)/);
  await page.screenshot({path:'tmp/ac-shunt-import/budget.png'});
  writeFileSync('tmp/ac-shunt-import/feature-body.txt',await page.locator('body').innerText());
  assert.deepEqual(errors,[]);
  console.log('PASS: direct current/frequency points, saved ppm results, editable variability, lab TI limits, and shared reference uncertainty.');
} catch (error) {
  mkdirSync('tmp/ac-shunt-import',{recursive:true});
  await page.screenshot({path:'tmp/ac-shunt-import/failure.png'});
  console.error(await page.locator('body').innerText().then(text=>text.slice(-1500)),errors);
  throw error;
} finally {await browser.close();}
