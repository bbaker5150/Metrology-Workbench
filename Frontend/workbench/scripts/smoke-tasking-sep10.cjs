// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9244");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "tasking-sep10-"));
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
    const virtual = path.resolve("__tasking-sep10.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.resolve("node_modules/.vite-tasking-sep10"),
      optimizeDeps: { force: false },
      server: { host: "127.0.0.1", port: 4210, strictPort: false, open: false },
      plugins: [
        {
          name: "tasking-sep10",
          resolveId: (id) =>
            id === "/__tasking-sep10.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__tasking-sep10") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__tasking-sep10.jsx"></script></body></html>',
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
        "/__tasking-sep10",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9244");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("combobox", { name: "Analysis Session" }).waitFor();
    const rows=page.locator('.point-grid-item');
    await rows.first().waitFor();
    const diagnostic=rows.first().locator('.point-diagnostic-warning').first();
    await diagnostic.waitFor();
    const warningBox=await diagnostic.boundingBox(), valueBox=await rows.first().locator('.point-value-number').boundingBox();
    assert.ok(warningBox.x+warningBox.width<=valueBox.x,'Indicators stay left of a large value');
    await page.locator('[data-tour="tab-overview"]').click();
    const uutTable=page.locator('.instrument-equipment-table').first();
    for(const kind of ['UUT','TMDE']) {
      await page.getByRole('textbox',{name:`New ${kind} measurement area name`}).fill(kind+' area');
      await page.getByRole('button',{name:`Add Measurement Area from ${kind} table`}).click();
      const header=page.getByRole('textbox',{name:`Measurement area name: ${kind} area`,exact:true}).locator('..');
      assert.equal(await header.locator('.function-sidebar-collapse-button').count(),0,'Empty point area has no accordion');
      assert.equal(await page.getByRole('textbox',{name:`New ${kind} measurement area name`}).inputValue(),'');
    }
    assert.equal(await page.locator('[data-tour="uut-function-menu"]').count(),0);
    const handle=page.getByRole('button',{name:'Resize UUT table height',exact:true});
    const container=uutTable.locator('..');
    await handle.scrollIntoViewIfNeeded();
    const h=await handle.boundingBox();
    await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();
    await page.mouse.move(h.x+h.width/2,h.y-150,{steps:5});await page.mouse.up();
    assert.equal(await handle.getAttribute('data-sizing-mode'),'manual');
    await handle.dblclick();
    assert.equal(await handle.getAttribute('data-sizing-mode'),'auto');
    assert.equal(await container.evaluate(e=>e.style.height),'');
    const animation=await handle.evaluate(e=>getComputedStyle(e,'::after').animationName);
    assert.ok(animation.startsWith('instrument-auto-height-pulse'));
    const before=await container.evaluate(e=>e.clientHeight);
    const area=uutTable.locator('.instrument-area-section-row').filter({hasText:'UUT area'});
    await area.locator('button').last().click();
    await page.waitForFunction(()=>window.savedSession().uuts.length===7);
    const geometry=await container.evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight}));
    assert.ok(geometry.height>before && geometry.scroll<=geometry.height+1);
    await page.keyboard.press('Escape');
    await page.screenshot({path:path.join(output,'light.png')});
    await page.evaluate(()=>document.body.classList.add('dark-mode'));
    await page.screenshot({path:path.join(output,'dark.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS inline area inputs, empty accordions, left indicators, double-click auto height and growth. Artifacts:',output);
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
