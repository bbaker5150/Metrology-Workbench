// Real AC Shunt components/styles; mocked transport, no instruments or lab DB.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const source = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import axios from 'axios';
import '/src/index.css';
import '/src/modules/ac-shunt/App.css';
import {ThemeProvider} from '/src/shared/ThemeContext.jsx';
import {InstrumentContext} from '/src/modules/ac-shunt/contexts/InstrumentContext.jsx';
import Calibration from '/src/modules/ac-shunt/components/calibration/Calibration.jsx';
import CalibrationStatusBar from '/src/modules/ac-shunt/components/calibration/CalibrationStatusBar.jsx';
import CorrectionsModal from '/src/modules/ac-shunt/components/calibration/CorrectionsModal.jsx';
const shunts=[{id:1,model_name:'Y5020',serial_number:'3995010',range:20,is_manual:true,reports:[{id:1,is_active:true,notes:'used from 18A input',corrections:[]}]}];
axios.get=async url=>({data:url.includes('/shunts/')?shunts:url.includes('/tvcs/')?[]:{}});
axios.post=async(url,payload)=>{window.saved=payload;return {data:{settings:payload.settings}}};
const context={selectedSessionId:1,stdReaderModel:'5790A',tiReaderModel:'8508A',
  liveReadings:[],tiLiveReadings:[],initialLiveReadings:[],discoveredInstruments:[],
  collectionProgress:{},activeCollectionDetails:{},stabilizationStatus:'',slidingWindowStatus:{},
  timerState:{},setFailedTPKeys:()=>{}};
const first={key:'first',current:1,frequency:1000,forward:{id:1,settings:{initial_warm_up_time:10},results:{}}};
const next={key:'next',current:1,frequency:2000,forward:{id:2,settings:{initial_warm_up_time:20},results:{}}};
function Demo(){
  const[points,setPoints]=useState([first,next]);const[focus,setFocus]=useState(next);
  const[modal,setModal]=useState(false);const[count,setCount]=useState(1);
  return <main className="ac-shunt-module" style={{padding:24}}>
    <button onClick={()=>setPoints(p=>[...p].reverse())}>Reorder test points</button>
    <button onClick={()=>setFocus(p=>p.key==='first'?next:first)}>Switch focused point</button>
    <button onClick={()=>setModal(true)}>Browse corrections</button>
    <button onClick={()=>setCount(n=>n+1)}>Next sample</button>
    <CalibrationStatusBar activeRunningTP={focus} isCollecting formatCurrent={String} formatFrequency={String}
      timerState={{isActive:false}} collectionProgress={{count}} getStageName={()=>'AC Open'}
      calibrationSettings={{num_samples:10,n_cycles:2}} selectedTPs={new Set()} dropdownOptions={[]} />
    <Calibration orderedTestPoints={points} sharedFocusedTestPoint={focus} sharedSelectedTPs={new Set()}
      activeDirection="Forward" showNotification={()=>{}} onDataUpdate={async()=>{}} setSharedFocusedTestPoint={setFocus}/>
    <CorrectionsModal isOpen={modal} onClose={()=>setModal(false)} showNotification={()=>{}} uniqueTestPoints={[]} />
  </main>;
}
createRoot(document.getElementById('root')).render(<ThemeProvider><InstrumentContext.Provider value={context}><Demo/></InstrumentContext.Provider></ThemeProvider>);
`;

const virtual = path.resolve('__ac-shunt-september.jsx').replaceAll('\\', '/');
const server = await createServer({
  server:{host:'127.0.0.1', port:4213, strictPort:false, open:false},
  plugins:[{
    name:'ac-shunt-tasking-smoke',
    resolveId:id => id === '/__ac-shunt-september.jsx' ? virtual : undefined,
    load:id => id === virtual ? source : undefined,
    configureServer(vite) {
      vite.middlewares.use(async(req,res,next) => {
        if(req.url !== '/__ac-shunt-september') return next();
        res.setHeader('Content-Type','text/html');
        res.end(await vite.transformIndexHtml(req.url,
          '<html><body><div id="root"></div><script type="module" src="/__ac-shunt-september.jsx"></script></body></html>'));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM || undefined});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__ac-shunt-september`);
  const warmup=page.getByLabel('Initial warm-up wait (sec)');
  await warmup.waitFor();
  assert.equal(await warmup.isEnabled(),true);
  assert.equal(await warmup.inputValue(),'20');
  await page.getByRole('button',{name:'Reorder test points'}).click();
  assert.equal(await warmup.inputValue(),'20');
  await page.getByRole('button',{name:'Switch focused point'}).click();
  assert.equal(await warmup.inputValue(),'10');
  await warmup.fill('35');
  await page.getByRole('button',{name:'Save Stability settings for this point'}).click();
  await page.waitForFunction(()=>window.saved?.settings?.initial_warm_up_time===35);
  assert.equal(await page.evaluate(()=>window.saved.frequency),1000);
  await page.locator('#f5790_range_mode').selectOption('AUTO');
  await page.getByRole('button',{name:'Save 5790 settings for this test point'}).click();
  await page.waitForFunction(()=>window.saved?.settings?.f5790_range_mode==='AUTO');
  await page.getByRole('button',{name:'Next sample'}).click();
  await page.getByText('2 / 10 Samples',{exact:true}).waitFor();
  assert.equal(await page.getByRole('progressbar',{name:'Samples collected'}).first().getAttribute('aria-valuenow'),'20');
  assert.equal(await page.getByText('2 / 10 Samples',{exact:true}).evaluate(el=>getComputedStyle(el).transform),'none');
  assert.equal(await page.getByText('2 / 10 Samples',{exact:true}).evaluate(el =>
    el.getBoundingClientRect().bottom < el.closest('.status-bar').getBoundingClientRect().bottom - 4),true);
  const output=await mkdtemp(path.join(os.tmpdir(),'ac-shunt-september-'));
  for(const dark of [false,true]) {
    await page.evaluate(d=>document.body.classList.toggle('dark-mode',d),dark);
    await warmup.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,dark?'settings-dark.png':'settings-light.png')});
  }
  await page.getByRole('button',{name:'Browse corrections'}).click();
  assert.equal(await page.getByRole('option',{name:'[Y5020] 3995010 (20A), used from 18A input — Manual'}).count(),1);
  await page.waitForFunction(() => {
    const panel=document.querySelector('.corrections-modal-content');
    return panel && Number(getComputedStyle(panel).opacity)===1;
  });
  await page.screenshot({path:path.join(output,'correction-notes.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS: per-point warm-up, reordering, category saves, autorange, steady status, and standard notes. Screenshots:',output);
} finally {
  await browser?.close();
  await server.close();
}
