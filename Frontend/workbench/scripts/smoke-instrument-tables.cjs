// Run from Frontend/workbench with the installed Electron executable.
// Real React table + production CSS, isolated session; no backend writes.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'instrument-ui-')));
const source = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import UncertaintyPanel from '/src/modules/uncertainty/features/analysis/components/UncertaintyPanel.jsx';
import '/src/modules/uncertainty/App.css';
const range = {id:'r1', min:0,max:10,unit:'V',tolerances:{reading:{high:1,low:-1,unit:'%',symmetric:true,distribution:'1.732'}},measuringResolution:'0.001',measuringResolutionUnit:'V'};
const makeInstrument = (id) => ({id, measurementAreaNames:['Bench calibration'], description:'Mock DMM '+id,name:'Mock DMM '+id,instrument:{...(id.startsWith('tmde')?{id:'definition-'+id,scope:'local'}:{}),manufacturer:'Mock',model:'DMM',name:'Test',functions:[{name:'Voltage',unit:'V',ranges:[{...range,id:id+'r1'},{...range,id:id+'r2',min:20,max:30}]}]}});
function Harness() {
 const [session,setSession] = useState({id:'test',name:'Layout regression',measurementAreaGroups:[{name:'Bench calibration',unit:'V',kind:'uut'},{name:'Bench calibration',unit:'V',kind:'tmde'}],uuts:Array.from({length:10},(_,i)=>makeInstrument('uut'+i)),tmdes:Array.from({length:12},(_,i)=>makeInstrument('tmde'+i)),testPoints:[],uncReq:{}});
 window.savedSession=()=>session; window.setSmokeSession=setSession;
 const [selected,setSelected] = useState([]);
 const [view,setView] = useState('session'); window.showDetail=()=>setView('point'); window.showOverview=()=>setView('session');
 return <div className="uncertainty-module" style={{height:'100vh',overflow:'auto'}}><div className="analysis-container" style={{display:'block',overflow:'visible',width:'100%'}}><div className="analysis-tabs"><button>Instrument Overview</button><button>Uncertainty Budget</button></div><UncertaintyPanel testPointData={{viewMode:view,id:'test',testPointInfo:{measurementArea:session.uuts[0]?.measurementAreaNames?.[0] || 'Bench calibration',parameter:{name:'Voltage',unit:'V'}},associatedUutIds:[session.uuts[0]?.id],components:[]}} tmdeTolerancesData={[]} uutNominal={{value:5,unit:'V'}} sessionData={session} onSessionSave={setSession} currentUutSelection={selected} setCurrentUutSelection={setSelected} setNotification={()=>{}} onInstrumentSynced={()=>{}}/><div style={{height:900}}>End of tables</div></div></div>;
}
document.body.classList.add('uncertainty-active');
for (const kind of ['uut','tmde']) localStorage.setItem('uncertalytics:'+kind+':instrument-column-widths:v2',JSON.stringify({description:90,range:90,tolerance:90,distribution:90,resolution:90,sync:550}));
createRoot(document.getElementById('root')).render(<Harness/>);
`;
let server, window;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = code => window.webContents.executeJavaScript(code);
async function click(selector, button = 'left') {
  await js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',inline:'nearest'})`);
  await pause(150);
  const rect = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  window.webContents.sendInputEvent({type:'mouseDown',button,clickCount:1,...rect});
  await pause(40);
  window.webContents.sendInputEvent({type:'mouseUp',button,clickCount:1,...rect});
  await pause(250);
}
async function capture(name) {
  await pause(200);
  fs.writeFileSync(path.join(os.tmpdir(), 'instrument-'+name+'.png'),(await window.webContents.capturePage()).toPNG());
}
async function checkEditor(selector) {
  for(let i=0;i<40;i++){if(await js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`))break;await pause(100);}
  console.log('Checking editor',selector);
  const geometry = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),td=e.closest('td'),r=td.getBoundingClientRect();return {cell:r.width,editor:e.getBoundingClientRect().width,overflow:[...td.querySelectorAll('input,button')].filter(c=>{const b=c.getBoundingClientRect();return b.width>0&&(b.left<r.left-1||b.right>r.right+1)}).map(c=>c.className)}})()`);
  assert.deepEqual(geometry.overflow, [], JSON.stringify(geometry));
  return geometry;
}
async function checkAddRange(table, kind, label) {
  const before = await js(`window.savedSession().${kind}s[0].instrument.functions[0].ranges.length`);
  await click(table+' .range-row-add');
  await pause(300);
  assert.equal(await js(`window.savedSession().${kind}s[0].instrument.functions[0].ranges.length`),before+1,label+': click inserts exactly one range');
  assert.equal(await js(`document.querySelectorAll('${table} tr[data-range-group="${kind}:${kind}0"]').length`),before+1,label+': range list stays expanded');
  assert.ok(await js(`document.activeElement?.matches('.range-row-add')`),label+': add keeps focus for repeated clicks');
  await js(`([...document.querySelectorAll('${table} tr[data-range-group="${kind}:${kind}0"] input[placeholder="min"]')].at(-1)).focus()`);
  await js(`(()=>{const min=document.activeElement,row=min.closest('tr'),set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(min,'40');min.dispatchEvent(new Event('input',{bubbles:true}));row.querySelector('input[placeholder="max"]').focus()})()`);
  await pause(100);
  await js(`(()=>{const max=document.activeElement,set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(max,'50');max.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await click('.analysis-tabs button');
  assert.equal(await js(`document.querySelectorAll('${table} .inline-range-editor.is-editing').length`),0,label+': ordinary click-away closes editors');
  const persisted=await js(`window.savedSession().${kind}s[0].instrument.functions[0].ranges`);
  assert.equal(persisted.length,before+1,label+': new range survives collapse');
  assert.ok(persisted.some(r=>Number(r.min)===40&&Number(r.max)===50),label+': bounds are saved '+JSON.stringify(persisted));
  const second=table+` tr[data-range-group="${kind}:${kind}0"]:nth-of-type(3)`;
  await click(second+' [data-range-cell] .inline-tolerance-summary');
  const alignment=await js(`(()=>{const cell=document.querySelector('${second} [data-range-cell]'),button=cell.querySelector('.range-row-delete');return button.getBoundingClientRect().left-cell.getBoundingClientRect().left})()`);
  assert.ok(alignment<55,label+': delete remains at the left of the range column');
  await click(second+' .range-row-delete');
  assert.equal(await js(`window.savedSession().${kind}s[0].instrument.functions[0].ranges.length`),before,label+': delete works while editing');
  await click('.analysis-tabs button');
  console.log('PASS add range:',label);
}
async function menuItem(label) {
  await js(`(()=>{const e=[...document.querySelectorAll('.context-menu li')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e)throw Error('Missing menu '+${JSON.stringify(label)}+'; open: '+[...document.querySelectorAll('.context-menu li')].map(e=>e.textContent).join('|'));e.setAttribute('data-smoke-menu','true')})()`);
  await click('[data-smoke-menu="true"]');
  console.log('Menu action:',label);
}
async function shortcut(key) {
  window.webContents.sendInputEvent({type:'keyDown',keyCode:key,modifiers:['control']});
  window.webContents.sendInputEvent({type:'keyUp',keyCode:key,modifiers:['control']});
  await pause(300);
}
async function checkClipboard(view) {
  await js(`window.setSmokeSession(s=>({...s, measurementAreaGroups:[{name:'Temperature',kind:'uut'},{name:'Torque',kind:'uut'},{name:'Torque',kind:'tmde'}],uuts:[{...s.uuts[0],id:'source',measurementAreaNames:['Temperature']},{...s.uuts[1],id:'target',measurementAreaNames:['Torque']}],tmdes:[{...s.tmdes[0],id:'reference',measurementAreaNames:['Torque']}]}));window.${view === 'detail' ? 'showDetail' : 'showOverview'}()`);
  await pause(400);
  const uut='[data-tour="uut-table"]',tmde='[data-tour="tmde-table"]';
  if(view === 'detail') {
    for(const kind of ['UUT','TMDE']) {
      const toggle='[aria-label="Show all '+kind+' measurement areas"]';
      if(await js(`Boolean(document.querySelector('${toggle}'))`)) await click(toggle);
    }
  }

  await click(uut+' tr[data-range-group="uut:source"] .cell-description','right');
  await menuItem('Copy Instrument');
  await click(uut+' tr[data-range-group="uut:target"] [data-range-cell]','right');
  await menuItem('Paste Instrument');
  assert.deepEqual(await js(`window.savedSession().uuts[2].measurementAreaNames`),['Torque'],view+': destination area');
  assert.equal(await js(`window.savedSession().uuts[1].id`),'target',view+': paste below selected instrument');
  await click(tmde+' tr[data-range-group="tmde:reference"] [data-range-cell]');
  await shortcut('V');
  assert.equal(await js(`window.savedSession().tmdes.length`),2,view+': context copy to keyboard paste across tables');
  await click(uut+' tr[data-range-group="uut:target"] [data-range-cell]');
  await shortcut('C');
  const before=await js(`window.savedSession().uuts[1].instrument.functions[0].ranges.map(r=>r.id)`);
  await click(uut+' tr[data-range-group="uut:target"] [data-range-cell]','right');
  await menuItem('Paste Range');
  const after=await js(`window.savedSession().uuts[1].instrument.functions[0].ranges.map(r=>r.id)`);
  assert.equal(after.length,before.length+1,view+': keyboard copy to context paste');
  assert.equal(after[0],before[0]);assert.equal(after[2],before[1],view+': range inserted directly below target');
  await click(tmde+' tr[data-range-group="tmde:reference"] .cell-description','right');
  await menuItem('Copy Instrument');
  await click(uut+' tr.instrument-area-section-row[data-measurement-area="torque"] .function-header-name','right');
  await menuItem('Paste Instrument');
  assert.equal(await js(`window.savedSession().uuts.length`),4,view+': header paste across tables');
  assert.deepEqual(await js(`window.savedSession().uuts[3].measurementAreaNames`),['Torque']);
  console.log('PASS clipboard:',view);
}
async function checkBatchAdd(view) {
  await js(`window.${view === 'detail' ? 'showDetail' : 'showOverview'}()`);
  await pause(350);
  if(view === 'detail') {
    for(const kind of ['UUT','TMDE']) {
      const toggle='[aria-label="Show all '+kind+' measurement areas"]';
      if(await js(`Boolean(document.querySelector('${toggle}'))`)) await click(toggle);
    }
  }
  for(const kind of ['uut','tmde']) {
    const table=`[data-tour="${kind}-table"]`;
    const id=await js(`window.savedSession().${kind}s[0].id`);
    const group=table+` tr[data-range-group="${kind}:${id}"]`;
    const before=await js(`window.savedSession().${kind}s[0].instrument.functions[0].ranges.length`);
    await click(group+' [data-range-cell] .inline-tolerance-summary');
    const rect=await js(`(()=>{const r=document.querySelector('${group} .range-row-add').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    for(let i=0;i<10;i++) {
      window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...rect});
      await pause(15);
      window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...rect});
      await pause(25);
    }
    await pause(300);
    let ranges=await js(`window.savedSession().${kind}s[0].instrument.functions[0].ranges`);
    assert.equal(ranges.length,before+10,view+' '+kind+': ten clicks at the same position add ten ranges');
    assert.equal(new Set(ranges.map(r=>r.id)).size,ranges.length,'Every blank has a unique id');
    assert.ok(ranges.slice(before).every(r=>r.min===''&&r.max===''),'All ten new ranges remain blank');
    await click('.analysis-tabs button');
    assert.equal(await js(`window.savedSession().${kind}s[0].instrument.functions[0].ranges.length`),before+10,'Leaving the table preserves the batch');
    const lastId=ranges.at(-1).id;
    await js(`(()=>{const min=[...document.querySelectorAll('${group} input[placeholder="min"]')].at(-1);min.focus();const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(min,'60');min.dispatchEvent(new Event('input',{bubbles:true}));min.closest('tr').querySelector('input[placeholder="max"]').focus()})()`);
    await pause(100);
    await js(`(()=>{const max=document.activeElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(max,'70');max.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await click('.analysis-tabs button');
    ranges=await js(`window.savedSession().${kind}s[0].instrument.functions[0].ranges`);
    assert.equal(ranges.length,before+10);
    assert.ok(ranges.some(r=>r.id===lastId&&Number(r.min)===60&&Number(r.max)===70),'A blank range can be filled afterward');
    console.log('PASS rapid batch add:',view,kind);
  }
}
app.whenReady().then(async()=>{
 const deadline = setTimeout(()=>{console.error('Timed out');app.exit(1)},120000);
 let status=0;
 try {
  const {createServer}=await import('vite');
  const virtual = path.resolve('__instrument-smoke.jsx').replaceAll('\\','/');
  server=await createServer({cacheDir:fs.mkdtempSync(path.join(os.tmpdir(),'instrument-vite-')),server:{host:'127.0.0.1',port:4195,strictPort:false,open:false},plugins:[{name:'instrument-smoke',resolveId:id=>id==='/__instrument-smoke.jsx'?virtual:undefined,load:id=>id===virtual?source:undefined,configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url!=='/__instrument-smoke')return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/__instrument-smoke.jsx"></script></body></html>'));});}}]});
  await server.listen();
  window=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{offscreen:true,backgroundThrottling:false}});
  window.webContents.on('console-message',event=>{if(/error|uncaught/i.test(event.message))console.error(event.message)});
  await window.loadURL('http://127.0.0.1:'+server.httpServer.address().port+'/__instrument-smoke');
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  for(let i=0;i<300;i++){if(await js(`document.querySelectorAll('.instrument-equipment-table tbody tr').length>10`))break;await pause(100);}
  await capture('initial');
  assert.deepEqual(await js(`[...document.querySelectorAll('.function-header-name')].map(e=>e.textContent)`), ['Bench calibration','Bench calibration'], 'Both tables use the custom measurement area, independently of Voltage function metadata');
  const uut='[data-tour="uut-table"]';
  const tmde='[data-tour="tmde-table"]';
  window.setSize(1800,900);
  for (const zoom of [0.6, 0.9, 1, 1.4]) {
    await js(`document.querySelector('${uut} table').style.zoom='${zoom}'`);
    await pause(300);
    const fill=await js(`(()=>{const c=document.querySelector('${uut}'),t=c.querySelector('table');return {available:c.clientWidth,rendered:t.getBoundingClientRect().width}})()`);
    assert.ok(fill.rendered >= fill.available - 2, 'No right-side whitespace at zoom '+zoom+': '+JSON.stringify(fill));
  }
  await js(`document.querySelector('${uut} table').style.zoom='1'`);
  window.setSize(1280,900);
  await pause(300);
  const base=await js(`document.querySelector('${uut} th').getBoundingClientRect().width`);
  await click(uut+' .inline-desc-combined');
  const description=await checkEditor('.inline-desc-fields');
  await capture('description');
  assert.ok(description.cell>base+50);
  await click(uut+' [data-range-cell] .inline-tolerance-summary');
  const rangeGeometry=await checkEditor('.inline-range-editor.is-editing');
  await capture('range');
  const width1=await js(`document.querySelector('${uut} table').getBoundingClientRect().width`);
  await pause(800);
  assert.equal(await js(`document.querySelector('${uut} table').getBoundingClientRect().width`),width1,'No resize feedback loop');
  await js(`([...document.querySelectorAll('${uut} [data-range-cell] .inline-tolerance-summary')].find(e=>e.textContent.includes('20 to 30'))).setAttribute('data-smoke-second','true')`);
  await click('[data-smoke-second]');
  await checkEditor('.inline-range-editor.is-editing');
  assert.ok(Math.abs(await js(`document.querySelector('${uut} th').getBoundingClientRect().width`)-base)<1,'Editing a later row expands Range, not the row-spanned Description');
  await capture('second-range');
  await checkAddRange(uut,'uut','overview UUT while editing a later row');
  await click(tmde+' [data-range-cell] .inline-tolerance-summary');
  await checkAddRange(tmde,'tmde','overview TMDE');
  await click('.analysis-tabs button');
  assert.ok(Math.abs(await js(`document.querySelector('${uut} th').getBoundingClientRect().width`)-base)<1,'Saved column width restored');
  await click(tmde+' .cell-tolerance .inline-tolerance-summary');
  await checkEditor('.inline-tolerance-editor');
  await click(tmde+' .cell-distribution .inline-tolerance-summary');
  assert.ok(await js(`Boolean(document.querySelector('[role="listbox"][aria-label="Spec band distribution"]'))`),'Distribution opens with one click from tolerance');
  await pause(400);
  const menuAlignment=await js(`(()=>{const a=document.querySelector('.inline-distribution-editor .inline-menu-select').getBoundingClientRect(),m=document.querySelector('.inline-menu-select-menu').getBoundingClientRect();return Math.abs(a.right-m.right)})()`);
  assert.ok(menuAlignment<2,'Distribution menu tracks the resized column');
  await capture('distribution');
  await click('.analysis-tabs button');
  await click(tmde+' td:nth-child(5) .inline-tolerance-summary');
  await checkEditor('.inline-resolution-editor');
  await capture('resolution');
  await click('.analysis-tabs button');
  await click(tmde+' [data-range-cell] .inline-tolerance-summary','right');
  await capture('context');
  const separators=await js(`[...document.querySelectorAll('.context-menu-divider')].map(e=>e.getBoundingClientRect().height)`);
  assert.ok(separators.length>0 && separators.every(height=>height<=1),'Compact context-menu separators');
  await click('.analysis-tabs button');
  await js(`(()=>{const s=document.querySelector('.uncertainty-module'),t=document.querySelector('${tmde}');s.scrollTop+=t.getBoundingClientRect().top-160})()`);
  await pause(300);
  await js(`document.querySelector('.uncertainty-module').scrollTop+=240`);
  await pause(300);
  const header=await js(`(()=>{const h=document.querySelector('${tmde} th').getBoundingClientRect(),t=document.querySelector('.analysis-tabs').getBoundingClientRect();return {top:h.top,tabs:t.bottom}})()`);
  assert.ok(Math.abs(header.top-header.tabs)<2,JSON.stringify(header));
  await capture('sticky');
  await js(`document.body.classList.add('dark-mode')`);
  await capture('dark');
  await js(`document.querySelector('.uncertainty-module').scrollTop+=600`);
  await pause(300);
  const bounds=await js(`(()=>{const h=document.querySelector('${tmde} th').getBoundingClientRect(),c=document.querySelector('${tmde}').getBoundingClientRect();return {header:h.bottom,container:c.bottom}})()`);
  assert.ok(bounds.header<=bounds.container+1,'Headers do not follow below the table');
  await js(`window.showDetail();document.querySelector('.uncertainty-module').scrollTop=0`);
  await pause(400);
  await click(uut+' .inline-desc-combined');
  await checkEditor('.inline-desc-fields');
  const descLayout=await js(`(()=>{const e=document.querySelector('.inline-desc-fields'),cell=e.closest('td'),pill=cell.querySelector('.active-uut-badge'),r=cell.getBoundingClientRect(),p=pill.getBoundingClientRect();return {columns:getComputedStyle(e).gridTemplateColumns.split(' ').length,fields:e.children.length,pillRight:p.right,cellRight:r.right}})()`);
  assert.equal(descLayout.columns,2,'Description uses two columns');
  assert.equal(descLayout.fields,4,'All four description fields remain available');
  assert.ok(descLayout.pillRight<descLayout.cellRight,'Active UUT badge stays inside its cell');
  await capture('active-uut');
  await click('.analysis-tabs button');
  for (const [table,kind] of [[uut,'uut'],[tmde,'tmde']]) {
    await click(table+' [data-range-cell] .inline-tolerance-summary');
    await checkAddRange(table,kind,'detail '+kind);
  }
  const plus=uut+' .instrument-column-insert-button';
  await js(`document.querySelector('${plus}').focus()`);
  await pause(200);
  const hit=await js(`(()=>{const b=document.querySelector('${plus}'),r=b.getBoundingClientRect();return [[r.left+2,r.top+r.height/2],[r.right-2,r.top+r.height/2]].every(([x,y])=>b.contains(document.elementFromPoint(x,y)))})()`);
  assert.ok(hit,'Both edges of the add-column button are visible and clickable');
  await capture('add-column');
  await js(`document.documentElement.style.zoom='1.1';document.querySelector('${tmde} table').style.zoom='0.8'`);
  await pause(350);
  await js(`(()=>{const s=document.querySelector('.uncertainty-module'),t=document.querySelector('${tmde}');s.scrollTop+=(t.getBoundingClientRect().top-20)/1.1})()`);
  await pause(350);
  const zoomedHeader=await js(`(()=>{const h=document.querySelector('${tmde} th').getBoundingClientRect(),t=document.querySelector('.analysis-tabs').getBoundingClientRect();return {top:h.top,tabs:t.bottom}})()`);
  assert.ok(Math.abs(zoomedHeader.top-zoomedHeader.tabs)<2, 'Sticky header respects app and table zoom: '+JSON.stringify(zoomedHeader));
  await capture('global-zoom');

  await js(`document.documentElement.style.zoom='1'`);
  for (const view of ['overview', 'detail']) {
    await js(view === 'overview' ? 'window.showOverview()' : 'window.showDetail()');
    await pause(350);
    for (const table of [uut, tmde]) {
      await click(table+' [data-range-cell] .inline-tolerance-summary');
      assert.ok(await js(`Boolean(document.querySelector('${table} .is-active-range.instrument-selected'))`),view+': clicking a range selects its instrument');
      assert.equal(await js(`document.querySelectorAll('tr.is-active-range:not(.instrument-selected),tr.is-selected-range:not(.instrument-selected)').length`),0,view+': unselected instruments have no range highlight');
    }
  }
  await checkClipboard('overview');
  await checkClipboard('detail');
  await checkBatchAdd('overview');
  await checkBatchAdd('detail');
  console.log('PASS: real table editors fit; widths restore and remain stable; distribution opens with one click; headers track page scrolling.',{description,rangeGeometry,header});
 } catch(error){console.error(error);await capture('failure');status=1}
 finally{clearTimeout(deadline);window?.webContents.stopPainting();window?.destroy();await server?.close();await pause(250);app.exit(status)}
});
