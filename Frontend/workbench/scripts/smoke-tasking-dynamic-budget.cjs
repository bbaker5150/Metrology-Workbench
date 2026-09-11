// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9249");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "tasking-dynamic-budget-"));
app.setPath("userData", path.join(output, "profile"));
const source = `
import '/src/index.css';
import React from 'react';import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router';import axios from 'axios';
import WorkbenchShell from '/src/app/WorkbenchShell.jsx';
import UncertaintyApp from '/src/modules/uncertainty/UncertaintyApp.jsx';
import {ThemeProvider} from '/src/shared/ThemeContext.jsx';
import {NotificationProvider} from '/src/shared/NotificationContext.jsx';
const range={id:'range1',min:0,max:100,unit:'V',measuringResolution:0.01,measuringResolutionUnit:'V',measuringResolutionDistribution:'3.464',tolerances:{reading:{high:1,low:-1,unit:'%',distribution:'1.732',symmetric:true}}};
const uut={id:'u1',description:'Micrometer',measurementArea:'Length',measurementAreaId:'length',instrument:{id:'def1',manufacturer:'Bench',model:'M1',description:'Micrometer',functions:[{id:'length-fn',name:'Length',unit:'V',ranges:[range]}]}};
let session={id:902,name:'September follow-up',measurementAreas:[{id:'length',name:'Length',color:'#4c9ada'}],uuts:[uut,...Array.from({length:5},(_,i)=>({...uut,id:"u"+(i+2),description:"Micrometer "+(i+2)}))],tmdes:[{...uut,id:'t1',name:'Length reference',description:'Length reference'}, {...uut,id:'t-other',measurementAreaId:'other',measurementArea:'Other',measurementAreaNames:['Other'],name:'Length reference',description:'Length reference'}],testPoints:Array.from({length:3},(_,i)=>({id:'p'+i,measurementAreaId:'length',associatedUutIds:['u1'],activeUutId:'u1',measurementType:'direct',testPointInfo:{parameter:{name:'Length',value:i===0?'123456789.123456':String(i+1),unit:i===0?'':'V'}},uutTolerance:{...range,functionId:'length-fn',functionName:'Length',rangeId:'range1'},tmdeTolerances:[],components:[{id:"manual-"+i,name:"Manual source",value:1,value_native:1,unit_native:"V",isBaseUnitValue:false,dof:null}],specifications:{}})),uncReq:{uncertaintyConfidence:95,reliability:95,reqPFA:2,calInt:12}};
session.uuts=[uut];session.tmdes=[];session.testPoints=session.testPoints.map((p,i)=>({...p,components:[],testPointInfo:{parameter:{name:'Length',value:String((i+1)*100),unit:'V'}}}));
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
    const virtual = path.resolve("__tasking-dynamic-budget.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.resolve("node_modules/.vite-tasking-dynamic-budget"),
      optimizeDeps: { force: false },
      server: { host: "127.0.0.1", port: 4215, strictPort: false, open: false },
      plugins: [
        {
          name: "tasking-dynamic-budget",
          resolveId: (id) =>
            id === "/__tasking-dynamic-budget.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__tasking-dynamic-budget") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__tasking-dynamic-budget.jsx"></script></body></html>',
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
        "/__tasking-dynamic-budget",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9249");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("combobox", { name: "Analysis Session" }).waitFor();
    const rows=page.locator('.point-grid-item');
    await rows.first().waitFor();


    const selectPoint=async(index)=>{await rows.nth(index).locator('.point-metric').first().click();await page.locator('[data-tour="tab-budget"]').click();};
    await selectPoint(0);
    await page.getByRole('button',{name:'Add component to budget',exact:true}).first().click();
    await page.getByRole('button',{name:'Add tabular uncertainty',exact:true}).click();
    const dynamic=page.locator('.budget-dynamic-row');
    await dynamic.getByLabel('Error source name',{exact:true}).fill('Head correction');
    await dynamic.getByRole('button',{name:'Not Set',exact:true}).click();
    await page.getByLabel('Measurement point row 1',{exact:true}).fill('100');
    await page.getByLabel('Uncertainty row 1',{exact:true}).fill('.012');
    await page.getByLabel('Uncertainty row 1',{exact:true}).press('Tab');
    await page.getByLabel('Measurement point row 2',{exact:true}).fill('200');
    await page.getByLabel('Uncertainty row 2',{exact:true}).fill('.023');
    await page.getByLabel('Uncertainty row 2',{exact:true}).press('Enter');
    await dynamic.getByRole('button',{name:'0.012 V',exact:true}).waitFor();
    console.log('PASS authored table inline');
    await selectPoint(1);
    await page.getByRole('button',{name:'Add component to budget',exact:true}).first().click();
    await page.getByRole('button',{name:'Head correction',exact:true}).click();
    await dynamic.getByRole('button',{name:'0.023 V',exact:true}).waitFor();
    console.log('PASS existing definition offered for a matching point');
    await page.getByRole('button',{name:'Add component to budget',exact:true}).first().click();
    await page.getByRole('button',{name:'Add equation uncertainty',exact:true}).click();
    const equation=dynamic.last();
    await equation.getByLabel('Error source name',{exact:true}).fill('Ambient correction');
    await equation.getByRole('button',{name:'Not Set',exact:true}).click();
    await page.getByLabel('Uncertainty equation',{exact:true}).fill('A*B+C');
    await page.getByRole('button',{name:'Set uncertainty equation',exact:true}).click();
    await page.getByLabel('B nominal',{exact:true}).fill('10');await page.getByLabel('C nominal',{exact:true}).fill('2.2');
    await page.getByLabel('C nominal',{exact:true}).press('Enter');
    await equation.getByRole('button',{name:'2002.2 V',exact:true}).waitFor();
    await selectPoint(0);
    await page.getByRole('button',{name:'Add component to budget',exact:true}).first().click();
    await page.getByRole('button',{name:'Ambient correction',exact:true}).click();
    await dynamic.last().getByRole('button',{name:'1002.2 V',exact:true}).click();
    await page.getByLabel('B nominal',{exact:true}).fill('2');await page.getByLabel('B nominal',{exact:true}).press('Enter');
    await dynamic.last().getByRole('button',{name:'202.2 V',exact:true}).waitFor();
    await page.waitForFunction(()=>Math.abs(window.savedSession().testPoints[1].combined_uncertainty_absolute_base-402.2)<.0001);
    console.log('PASS unopened point cached uncertainty refreshed');
    await selectPoint(1);
    await dynamic.last().getByRole('button',{name:'402.2 V',exact:true}).waitFor();
    console.log('PASS equation follows point values and shared edits');
    await dynamic.last().getByRole('button',{name:'402.2 V',exact:true}).click();
    await page.locator('.dynamic-budget-editor').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'equation-light.png')});
    await page.evaluate(()=>document.body.classList.add('dark-mode'));
    await page.screenshot({path:path.join(output,'equation-dark.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS dynamic budget full-app interaction. Artifacts:',output);
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
