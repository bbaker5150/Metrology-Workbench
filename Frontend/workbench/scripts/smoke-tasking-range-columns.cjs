// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9275");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "tasking-range-columns-"));
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
const uut={id:'u1',description:'Micrometer',measurementArea:'Length',measurementAreaId:'length',instrument:{id:'def1',manufacturer:'Bench',model:'M1',description:'Micrometer',functions:[{id:'length-fn',name:'Length',unit:'V',ranges:[range,{...range,id:"range2",min:100,max:200}]}]}};
let session={id:902,name:'September follow-up',measurementAreas:[{id:'length',name:'Length',color:'#4c9ada'}],uuts:[uut,...Array.from({length:5},(_,i)=>({...uut,id:"u"+(i+2),description:"Micrometer "+(i+2)}))],tmdes:[{...uut,id:'t1',name:'Length reference',description:'Length reference'}, {...uut,id:'t-other',measurementAreaId:'other',measurementArea:'Other',measurementAreaNames:['Other'],name:'Length reference',description:'Length reference'}],testPoints:Array.from({length:3},(_,i)=>({id:'p'+i,measurementAreaId:'length',associatedUutIds:['u1'],activeUutId:'u1',measurementType:'direct',testPointInfo:{parameter:{name:'Length',value:i===0?'123456789.123456':String(i+1),unit:i===0?'':'V'}},uutTolerance:{...range,functionId:'length-fn',functionName:'Length',rangeId:'range1'},tmdeTolerances:[],components:[{id:"manual-"+i,name:"Manual source",value:1,value_native:1,unit_native:"V",isBaseUnitValue:false,dof:null}],specifications:{}})),uncReq:{uncertaintyConfidence:95,reliability:95,reqPFA:2,calInt:12}};
session.uuts=[uut];session.tmdes=[];session.testPoints=session.testPoints.map((p,i)=>({...p,components:[],testPointInfo:{parameter:{name:'Length',value:String((i+1)*50),unit:'V'}}}));
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
    const virtual = path.resolve("__tasking-range-columns.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.resolve("node_modules/.vite-tasking-range-columns"),
      optimizeDeps: { force: false },
      server: { host: "127.0.0.1", port: 4235, strictPort: false, open: false },
      plugins: [
        {
          name: "tasking-range-columns",
          resolveId: (id) =>
            id === "/__tasking-range-columns.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__tasking-range-columns") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__tasking-range-columns.jsx"></script></body></html>',
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
        "/__tasking-range-columns",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9275");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("combobox", { name: "Analysis Session" }).waitFor();
    const rows=page.locator('.point-grid-item');
    await rows.first().waitFor();


    await page.getByRole('button',{name:'Columns',exact:true}).click();
    await page.getByRole('checkbox',{name:'UUT Limits',exact:true}).waitFor();
    assert.equal(await page.getByRole('checkbox',{name:'UUT Low Limit',exact:true}).count(),0);
    await page.screenshot({path:path.join(output,'columns-light.png')});
    await page.getByRole('button',{name:'Close columns menu'}).click();
    await page.locator('[data-tour="tab-overview"]').click();
    assert.equal(await page.getByRole('button',{name:'Add range',exact:true}).count(),0);
    const limitsBefore=await rows.allTextContents();
    const firstRow=page.locator('tr.inline-range-row').first();
    await firstRow.locator('td[data-range-cell]').click({position:{x:3,y:3}});
    await firstRow.getByRole('button',{name:'Add range',exact:true}).waitFor();
    for(let i=0;i<4;i++) await firstRow.getByRole('button',{name:'Add range',exact:true}).click();
    await page.waitForFunction(()=>window.savedSession().uuts[0].instrument.functions[0].ranges.length===6);
    const ranges=await page.evaluate(()=>window.savedSession().uuts[0].instrument.functions[0].ranges);
    assert.equal(ranges[0].id,'range1'); assert.equal(ranges[5].id,'range2');
    assert.equal(new Set(ranges.map(r=>r.id)).size,6);
    
    assert.deepEqual(await rows.allTextContents(),limitsBefore,'Blank ranges must not change existing point limits');
    console.log('PASS: selecting a range exposes controls; four repeated additions stay below that range', output);
    const area=page.getByRole('textbox',{name:'Measurement area subsection name'}).first();
    await area.click(); await area.press('End'); await area.press('Backspace');
    assert.equal(await page.getByRole('button',{name:'Delete',exact:true}).count(),0);
    await area.press('Escape');
    await page.getByTitle('Edit manufacturer, model, and name').first().click();
    const nameInput=page.getByPlaceholder('Name',{exact:true}).first();
    const box=await nameInput.boundingBox();
    await page.mouse.move(box.x+10,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+65,box.y+box.height/2,{steps:8});await page.mouse.up();
    assert.ok(await nameInput.evaluate(el=>el.selectionEnd>el.selectionStart),'Dragging inside an input should select text');
    console.log('PASS: area Backspace does not delete the selected instrument; dragging selects input text');
    await page.getByRole('button',{name:'Switch to dark mode'}).click();
    await page.getByRole('button',{name:'Columns',exact:true}).click();
    await page.screenshot({path:path.join(output,'columns-dark.png')});
    await page.getByRole('button',{name:'Close columns menu'}).click();
    console.log('ERRORS',JSON.stringify(errors));
    await page.screenshot({path:path.join(output,'instrument-final.png')});
    assert.deepEqual(errors,[]);
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

