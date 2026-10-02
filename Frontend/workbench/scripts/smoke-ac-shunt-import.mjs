import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

// Run against the full Workbench dev server: WORKBENCH_URL=http://127.0.0.1:3197
const url=process.env.WORKBENCH_URL || 'http://127.0.0.1:3197';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const source={id:11,name:'Y5020 import smoke',createdAt:'2026-10-02T00:00:00Z',
  instruments:{test_instrument_model:'Y5020',test_instrument_serial:'TEST-20',standard_instrument_model:'Y5020',
    standard_instrument_serial:'STD-20',standard_reader_model:'5790B',standard_reader_serial:'DMM-1',
    test_reader_model:'5790B',test_reader_serial:'DMM-2'},points:[6.9,10,20].map(current=>({
      current,frequency:1000,sourcePointIds:[current*10,current*10+1],
      analytics:{pair_type_a_uncertainty_ppm:1.2,n_pairs_used:5,pair_delta_uut_ppm:2.5},
      shuntSources:[{expandedPpm:4,report:{selection:'saved test-point report',number:'ROC-2026'}}],tvcs:{},
      readerPoints:['Forward','Reverse'].map(direction=>({direction,rangeMode:'AUTO',eta_std:1,eta_ti:1,
        phases:Object.fromEntries(['std','ti'].flatMap(side=>['ac_open','ac_close','dc_pos','dc_neg'].map(p=>[`${side}_${p}`,current===6.9?.069:.2])))}))}))};
let saved;
await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let data=[];
  if(path.endsWith('/ac-shunt/sessions/'))data={available:true,sessions:[{id:11,session_name:source.name,test_instrument_model:'Y5020',test_instrument_serial:'TEST-20',created_at:source.createdAt}],page:1,pages:1};
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
  await page.getByRole('button',{name:'Close walkthrough',exact:true}).click();
  assert.equal(await button.evaluate(b=>b.previousElementSibling?.getAttribute('aria-label')),'Unit converter');
  await button.click();
  await page.getByRole('button',{name:/Y5020 import smoke/}).click();
  await page.getByText('Y5020 · 3 points · 3 reference instruments',{exact:true}).waitFor();
  mkdirSync('tmp/ac-shunt-import',{recursive:true});
  await page.screenshot({path:'tmp/ac-shunt-import/preview.png'});
  await page.getByRole('button',{name:'Create budget',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog.ac-shunt-import'));
  assert.equal(saved.testPoints.length,3);
  assert.equal(saved.testPoints[0].components[0].dof,4);
  assert.equal(saved.tmdes.length,3);
  assert.equal(saved.testPoints[0].testPointInfo.measurementArea,'Electrical');
  assert.ok(saved.testPoints.every(p=>p.components.every(c=>!c.pendingReason)));
  assert.ok(saved.tmdes[1].instrument.functions.flatMap(f=>f.ranges).some(r=>r.max===.07));
  assert.ok(saved.tmdes[1].instrument.functions.flatMap(f=>f.ranges).some(r=>r.max===.22));
  await page.screenshot({path:'tmp/ac-shunt-import/budget.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: Workbench toolbar, session preview, paired Type A, voltage range selection, and saved Electrical budget.');
} catch (error) {
  mkdirSync('tmp/ac-shunt-import',{recursive:true});
  await page.screenshot({path:'tmp/ac-shunt-import/failure.png'});
  console.error(await page.locator('dialog.ac-shunt-import').textContent().catch(()=> 'No import dialog'),errors);
  throw error;
} finally {await browser.close();}
