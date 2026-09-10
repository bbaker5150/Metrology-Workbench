// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9248");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "tasking-sidebar-"));
app.setPath("userData", path.join(output, "profile"));
const source = `
import '/src/index.css';
import React from 'react';import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router';import axios from 'axios';
import WorkbenchShell from '/src/app/WorkbenchShell.jsx';
import UncertaintyApp from '/src/modules/uncertainty/UncertaintyApp.jsx';
import {ThemeProvider} from '/src/shared/ThemeContext.jsx';
import {NotificationProvider} from '/src/shared/NotificationContext.jsx';
const range={id:'range1',min:0,max:100,unit:'degF',measuringResolution:0.01,measuringResolutionUnit:'degF',measuringResolutionDistribution:'3.464',tolerances:{reading:{high:1,low:-1,unit:'%',distribution:'1.732',symmetric:true}}};
const uut={id:'u1',description:'Micrometer',measurementArea:'Length',measurementAreaId:'length',instrument:{id:'def1',manufacturer:'Bench',model:'M1',description:'Micrometer',functions:[{id:'length-fn',name:'Length',unit:'degF',ranges:[range]}]}};
let session={id:902,name:'September follow-up',measurementAreas:[{id:'length',name:'Length',color:'#4c9ada'}],uuts:[uut,...Array.from({length:5},(_,i)=>({...uut,id:"u"+(i+2),description:"Micrometer "+(i+2)}))],tmdes:[{...uut,id:'t1',name:'Length reference',description:'Length reference'}, {...uut,id:'t-other',measurementAreaId:'other',measurementArea:'Other',measurementAreaNames:['Other'],name:'Length reference',description:'Length reference'}],testPoints:Array.from({length:3},(_,i)=>({id:'p'+i,measurementAreaId:'length',associatedUutIds:['u1'],activeUutId:'u1',measurementType:'direct',testPointInfo:{parameter:{name:'Length',value:i===0?'123456789.123456':String(i+1),unit:i===0?'':'degF'}},uutTolerance:{...range,functionId:'length-fn',functionName:'Length',rangeId:'range1'},tmdeTolerances:[],components:[{id:"manual-"+i,name:"Manual source",value:1,value_native:1,unit_native:"degF",isBaseUnitValue:false,dof:null}],specifications:{}})),uncReq:{uncertaintyConfidence:95,reliability:95,reqPFA:2,calInt:12}};
let issues=[];window.savedSession=()=>session;window.savedIssues=()=>issues;
axios.get=async url=>({data:String(url).includes('/sessions/')?[session]:String(url).includes('/uncertainty/bug_reports/')?[]:String(url).includes('/bug_reports/')?issues:[]});
axios.put=async(url,data)=>{if(String(url).includes('/sessions/'))session=structuredClone(data);return {data};};
axios.post=async(url,data)=>{if(String(url).includes('/bug_reports/')){if(window.failIssueSave){window.failIssueSave=false;throw Error('offline');}const saved={...data,id:issues.length+1,created_at:new Date().toISOString()};issues.push(saved);return {data:saved};}return {data};};
axios.patch=async(url,data)=>({data});axios.delete=async()=>({data:{}});
localStorage.setItem('uncertalytics.uiPreferences.v1:902',JSON.stringify({expandedFunctions:['length'],expandedUuts:['length::u1']}));
createRoot(document.getElementById('root')).render(<ThemeProvider><NotificationProvider><MemoryRouter initialEntries={['/uncertalytics']}><Routes><Route element={<WorkbenchShell/>}><Route path='/uncertalytics' element={<UncertaintyApp/>}/></Route></Routes></MemoryRouter></NotificationProvider></ThemeProvider>);
`;
app.whenReady().then(async () => {
  let server,
    win,
    browser,
    page,
    status = 0;
  const timer = setTimeout(() => app.exit(1), 360000);
  try {
    const { createServer } = await import("vite");
    const virtual = path.resolve("__tasking-sidebar.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.resolve("node_modules/.vite-tasking-sidebar"),
      optimizeDeps: { force: false },
      server: { host: "127.0.0.1", port: 4214, strictPort: false, open: false },
      plugins: [
        {
          name: "tasking-sidebar",
          resolveId: (id) =>
            id === "/__tasking-sidebar.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__tasking-sidebar") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__tasking-sidebar.jsx"></script></body></html>',
                ),
              );
            });
          },
        },
      ],
    });
    await server.listen();
    win = new BrowserWindow({
      show: false,
      width: 1500,
      height: 1000,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    await win.loadURL(
      "http://127.0.0.1:" +
        server.httpServer.address().port +
        "/__tasking-sidebar",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9248");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("combobox", { name: "Analysis Session" }).waitFor();
    const rows=page.locator('.point-grid-item');
    await rows.first().waitFor();

    for(const dark of [false,true]) {
      await page.evaluate(dark=>document.body.classList.toggle('dark-mode',dark),dark);
      const header=await page.locator('.sidebar-sort-header--value > span').boundingBox();
      const values=await rows.locator('.point-value-number').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().x));
      assert.ok(values.every(x=>Math.abs(x-header.x)<1),JSON.stringify({header:header.x,values}));
      const dividers=await rows.first().locator(':scope > .point-metric').evaluateAll(nodes=>nodes.map(n=>({overflow:getComputedStyle(n).overflow,width:getComputedStyle(n,'::before').width,content:getComputedStyle(n,'::before').content})));
      assert.ok(dividers.length>=4);
      assert.ok(dividers.slice(0,-1).every(d=>d.overflow==='visible' && d.width==='1px' && d.content!=='none'),JSON.stringify(dividers));
      await page.screenshot({path:path.join(output,dark?'dark.png':'light.png')});
    }
    const resize=await page.locator('.sidebar-resizer').boundingBox();
    await page.mouse.move(resize.x+resize.width/2,resize.y+resize.height/2);await page.mouse.down();
    for(const delta of [40,100,180,80]) {
      await page.mouse.move(resize.x+delta,resize.y+resize.height/2);
      const size=await page.locator('.measurement-points-table').evaluate(e=>({viewport:e.clientWidth,areas:[...e.querySelectorAll('.area-header-sticky')].map(a=>a.getBoundingClientRect().width)}));
      assert.ok(size.areas.every(w=>Math.abs(w-size.viewport)<2),JSON.stringify(size));
    }
    await page.mouse.up();

    await page.locator('[data-tour="tab-overview"]').click();
    const uutTable=page.locator('.instrument-equipment-table').first();
    await page.getByRole('textbox',{name:'New UUT measurement area name'}).fill('Copy destination');
    await page.getByRole('button',{name:'Add Measurement Area from UUT table'}).click();
    const sourceRow=uutTable.locator('tr.instrument-function-row[data-measurement-area="length"]').first();
    await sourceRow.locator('.cell-description').click({modifiers:['Control']});
    await page.keyboard.press('Control+c');
    const destination=uutTable.locator('.instrument-area-section-row').filter({hasText:'Copy destination'});
    await destination.click({button:'right'});
    await page.getByText('Paste Instrument',{exact:true}).click();
    await page.waitForFunction(()=>window.savedSession().uuts.length===7);
    const ids=await page.evaluate(()=>window.savedSession().uuts.map(u=>u.id));
    assert.equal(new Set(ids).size,7);
    const copied=await page.evaluate(()=>window.savedSession().uuts.find(u=>u.measurementAreaNames?.includes('Copy destination')));
    assert.ok(copied && copied.id!=='u1');
    await page.keyboard.press('Escape');
    const copiedRow=uutTable.locator('tr.instrument-function-row').filter({hasNot: page.locator('[data-no-match]')}).filter({hasText: 'Micrometer'}).filter({has: page.locator('.cell-description')}).last();
    await copiedRow.locator('.cell-description').click({modifiers:['Control']});
    assert.ok((await copiedRow.getAttribute('class')).includes('selected'));
    assert.ok(!(await sourceRow.getAttribute('class')).includes('selected-row')); 
    console.log('PASS full-app copied row has an independent ID and selection');
    assert.deepEqual(errors,[]);
    console.log('PASS value header alignment, metric dividers in both themes, and area width during sidebar dragging. Artifacts:',output);
  } catch (error) {
    console.error(error);
    if (page)
      await page
        .screenshot({ path: path.join(output, "failure.png") })
        .catch(() => {});
    status = 1;
  } finally {
    clearTimeout(timer);
    await browser?.close();
    win?.destroy();
    await server?.close();
    app.exit(status);
  }
});
