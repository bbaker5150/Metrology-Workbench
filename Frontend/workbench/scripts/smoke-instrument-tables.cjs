// Run from Frontend/workbench with the installed Electron executable.
// Real React table + production CSS, isolated session; no backend writes.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
app.disableHardwareAcceleration();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'instrument-ui-')));
const source = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import UncertaintyPanel from '/src/modules/uncertainty/features/analysis/components/UncertaintyPanel.jsx';
import '/src/modules/uncertainty/App.css';
const range = {id:'r1', min:0,max:10,unit:'V',tolerances:{reading:{high:1,low:-1,unit:'%',symmetric:true,distribution:'1.732'}},measuringResolution:'0.001',measuringResolutionUnit:'V'};
const makeInstrument = (id) => ({id, description:'Mock DMM '+id,instrument:{manufacturer:'Mock',model:'DMM',name:'Test',functions:[{name:'Voltage',unit:'V',ranges:[{...range,id:id+'r1'},{...range,id:id+'r2',min:20,max:30}]}]}});
function Harness() {
 const [session,setSession] = useState({id:'test',name:'Layout regression',functionGroups:[{name:'Voltage',unit:'V',kind:'uut'},{name:'Voltage',unit:'V',kind:'tmde'}],uuts:Array.from({length:10},(_,i)=>makeInstrument('uut'+i)),tmdes:Array.from({length:12},(_,i)=>makeInstrument('tmde'+i)),testPoints:[],uncReq:{}});
 const [selected,setSelected] = useState([]);
 return <div className="uncertainty-module" style={{height:'100vh',overflow:'auto'}}><div className="analysis-container" style={{display:'block',overflow:'visible',width:'100%'}}><div className="analysis-tabs"><button>Instrument Overview</button><button>Uncertainty Budget</button></div><UncertaintyPanel testPointData={{viewMode:'session',id:'test'}} sessionData={session} onSessionSave={setSession} currentUutSelection={selected} setCurrentUutSelection={setSelected} setNotification={()=>{}} onInstrumentSynced={()=>{}}/><div style={{height:900}}>End of tables</div></div></div>;
}
document.body.classList.add('uncertainty-active');
for (const kind of ['uut','tmde']) localStorage.setItem('uncertalytics:'+kind+':instrument-column-widths:v2',JSON.stringify({description:90,range:90,tolerance:90,distribution:90,resolution:90,sync:550}));
createRoot(document.getElementById('root')).render(<Harness/>);
`;
let server, window;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = code => window.webContents.executeJavaScript(code);
async function click(selector, button = 'left') {
  const rect = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
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
app.whenReady().then(async()=>{
 const deadline = setTimeout(()=>{console.error('Timed out');app.exit(1)},120000);
 let status=0;
 try {
  const {createServer}=await import('vite');
  const virtual = path.resolve('__instrument-smoke.jsx').replaceAll('\\','/');
  server=await createServer({server:{host:'127.0.0.1',port:4195,strictPort:false,open:false},plugins:[{name:'instrument-smoke',resolveId:id=>id==='/__instrument-smoke.jsx'?virtual:undefined,load:id=>id===virtual?source:undefined,configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url!=='/__instrument-smoke')return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/__instrument-smoke.jsx"></script></body></html>'));});}}]});
  await server.listen();
  window=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{offscreen:true,backgroundThrottling:false}});
  window.webContents.on('console-message',event=>{if(/error|uncaught/i.test(event.message))console.error(event.message)});
  await window.loadURL('http://127.0.0.1:'+server.httpServer.address().port+'/__instrument-smoke');
  for(let i=0;i<300;i++){if(await js(`document.querySelectorAll('.instrument-equipment-table tbody tr').length>10`))break;await pause(100);}
  await capture('initial');
  const uut='[data-tour="uut-table"]';
  const tmde='[data-tour="tmde-table"]';
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
  console.log('PASS: real table editors fit; widths restore and remain stable; distribution opens with one click; headers track page scrolling.',{description,rangeGeometry,header});
 } catch(error){console.error(error);await capture('failure');status=1}
 finally{clearTimeout(deadline);window?.webContents.stopPainting();window?.destroy();await server?.close();await pause(250);app.exit(status)}
});
