// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9240");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "sep9-points-"));
app.setPath("userData", path.join(output, "profile"));
const source = `
import '/src/index.css';
import React from 'react';import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router';import axios from 'axios';
import WorkbenchShell from '/src/app/WorkbenchShell.jsx';
import UncertaintyApp from '/src/modules/uncertainty/UncertaintyApp.jsx';
import {ThemeProvider} from '/src/shared/ThemeContext.jsx';
import {NotificationProvider} from '/src/shared/NotificationContext.jsx';
const range={id:'range1',min:0,max:100,unit:'degF',tolerances:{reading:{high:1,low:-1,unit:'%',distribution:'1.732',symmetric:true}}};
const uut={id:'u1',description:'Micrometer',measurementArea:'Length',measurementAreaId:'length',instrument:{id:'def1',manufacturer:'Bench',model:'M1',description:'Micrometer',functions:[{id:'length-fn',name:'Length',unit:'degF',ranges:[range]}]}};
let session={id:902,name:'September follow-up',measurementAreas:[{id:'length',name:'Length',color:'#4c9ada'}],uuts:[uut],tmdes:[{...uut,id:'t1',name:'Length reference',description:'Length reference'}],testPoints:Array.from({length:3},(_,i)=>({id:'p'+i,measurementAreaId:'length',associatedUutIds:['u1'],activeUutId:'u1',measurementType:'direct',testPointInfo:{parameter:{name:'Length',value:String(i+1),unit:'degF'}},uutTolerance:{...range,functionId:'length-fn',functionName:'Length',rangeId:'range1'},tmdeTolerances:[],components:[],specifications:{}})),uncReq:{uncertaintyConfidence:95,reliability:95,reqPFA:2,calInt:12}};
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
  const timer = setTimeout(() => app.exit(1), 180000);
  try {
    const { createServer } = await import("vite");
    const virtual = path.resolve("__sep9-points.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.join(output, "vite"),
      server: { host: "127.0.0.1", port: 4206, strictPort: false, open: false },
      plugins: [
        {
          name: "sep9-points",
          resolveId: (id) =>
            id === "/__sep9-points.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__sep9-points") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__sep9-points.jsx"></script></body></html>',
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
        "/__sep9-points",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9240");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("combobox", { name: "Analysis Session" }).waitFor();
    const rows=page.locator('.point-grid-item');
    await rows.first().waitFor();
    await rows.first().locator('.point-value-number').click();
    await page.locator('.sidebar-inline-input.value').fill('11');
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.activeElement?.value==='2' && document.activeElement?.matches('.sidebar-inline-input.value'));
    assert.equal(await rows.count(),3);
    await rows.last().locator('.point-value-number').click();
    await page.keyboard.press('Enter');
    assert.equal(await rows.count(),3,'Enter at last point never creates a row');
    await rows.nth(1).locator('.point-value-number').click();
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(()=>document.querySelectorAll('.point-grid-item').length===4);
    await page.waitForFunction(()=>window.savedSession().testPoints.length===4);
    let order=await page.evaluate(()=>window.savedSession().testPoints.map(p=>p.id));
    assert.deepEqual([order[0],order[1],order[3]],['p0','p1','p2']);
    assert.ok(await rows.nth(2).locator('input.value').evaluate(e=>e===document.activeElement),'Inserted point owns focus');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(()=>document.querySelectorAll('.point-grid-item').length===5);
    await page.waitForFunction(()=>window.savedSession().testPoints.length===5);
    const nextOrder=await page.evaluate(()=>window.savedSession().testPoints.map(p=>p.id));
    assert.equal(nextOrder[2],order[2]);assert.equal(nextOrder[4],'p2');
    const resize=page.locator('.sidebar-column-resizer').first();
    const line=await resize.evaluate(e=>getComputedStyle(e,'::after').backgroundColor);
    assert.notEqual(line,'rgba(0, 0, 0, 0)','Resize boundary is visible at rest');
    await page.screenshot({path:path.join(output,'point-navigation.png')});
    await page.locator('[data-tour="tab-overview"]').click();
    const tolerance=page.locator('.instrument-equipment-table').first().locator('.cell-tolerance .inline-tolerance-summary').first();
    await tolerance.click();
    const input=page.locator('.instrument-equipment-table').first().locator('.inline-tolerance-editor input').first();
    await input.fill('3');
    await page.locator('[data-tour="tab-overview"]').click();
    await page.waitForFunction(()=>window.savedSession().testPoints.every(p=>Number(p.uutTolerance?.tolerances?.reading?.high)===3));
    const firstLimits=await rows.first().textContent();
    assert.ok(firstLimits.includes('10.67') && firstLimits.includes('11.33'),'UUT limits update on untouched row');
    await page.screenshot({path:path.join(output,'live-tolerance.png')});
    await rows.first().locator('.point-value-number').click();
    await page.locator('[data-tour="tab-budget"]').click();
    const results=page.locator('.budget-results-card').last();
    await results.waitFor();
    assert.ok((await results.textContent()).includes('°F'));
    assert.ok(!(await results.textContent()).includes('degF'));
    await page.screenshot({path:path.join(output,'result-units.png')});
    assert.deepEqual(errors, []);
    console.log(
      "PASS point UI: Enter navigation, Ctrl+Enter insertion, visible resize handles, live UUT tolerance updates, formatted result units. Artifacts:",
      output,
    );
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
