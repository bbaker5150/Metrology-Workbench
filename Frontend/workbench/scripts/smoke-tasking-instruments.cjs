// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9242");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "tasking-instruments-"));
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
let session={id:902,name:'September follow-up',measurementAreas:[{id:'length',name:'Length',color:'#4c9ada'}],uuts:[uut],tmdes:[{...uut,id:'t1',name:'Length reference',description:'Length reference'}, {...uut,id:'t-other',measurementAreaId:'other',measurementArea:'Other',measurementAreaNames:['Other'],name:'Length reference',description:'Length reference'}],testPoints:Array.from({length:3},(_,i)=>({id:'p'+i,measurementAreaId:'length',associatedUutIds:['u1'],activeUutId:'u1',measurementType:'direct',testPointInfo:{parameter:{name:'Length',value:String(i+1),unit:'degF'}},uutTolerance:{...range,functionId:'length-fn',functionName:'Length',rangeId:'range1'},tmdeTolerances:[],components:[{id:"manual-"+i,name:"Manual source",value:1,value_native:1,unit_native:"degF",isBaseUnitValue:false,dof:null}],specifications:{}})),uncReq:{uncertaintyConfidence:95,reliability:95,reqPFA:2,calInt:12}};
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
    const virtual = path.resolve("__tasking-instruments.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.join(output, "vite"),
      server: { host: "127.0.0.1", port: 4208, strictPort: false, open: false },
      plugins: [
        {
          name: "tasking-instruments",
          resolveId: (id) =>
            id === "/__tasking-instruments.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__tasking-instruments") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__tasking-instruments.jsx"></script></body></html>',
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
        "/__tasking-instruments",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9242");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("combobox", { name: "Analysis Session" }).waitFor();
    const rows=page.locator('.point-grid-item');
    await rows.first().waitFor();
    await page.getByRole('button',{name:'Reorder columns',exact:true}).click();
    const order=page.locator('.sidebar-column-order-item[draggable]');
    assert.ok(await order.filter({hasText:'UUT Limits'}).count());
    assert.equal(await order.filter({hasText:'TMDE Limits'}).count(),0,'Hidden limit group is omitted');
    const before=await order.allTextContents();
    await order.last().dragTo(order.first());
    const after=await order.allTextContents();
    assert.equal(after[0],before.at(-1));
    await page.getByRole('button',{name:'Reorder columns',exact:true}).click();
    await page.getByRole('textbox',{name:'New Measurement Area name'}).fill('Blank area');
    await page.getByRole('button',{name:'Add Measurement Area from points',exact:true}).click();
    await page.locator('[data-tour="tab-overview"]').click();
    const uutTable=page.locator('.instrument-equipment-table').first();
    const area=uutTable.locator('.instrument-area-section-row').filter({hasText:'Blank area'});
    await area.locator('button').last().click();
    await page.waitForFunction(()=>window.savedSession().uuts.length===2);
    const selected=uutTable.locator('tr.inline-range-row').last();
    const add=uutTable.locator('.range-row-add').last();
    await add.waitFor({state:'visible'});
    const range=selected.locator('.inline-range-editor');
    const addBox=await add.boundingBox(),rangeBox=await range.boundingBox();
    assert.ok(addBox.x>=rangeBox.x+rangeBox.width-1,'Range add control follows range editor');
    for(let i=0;i<5;i++) await add.click();
    await page.waitForFunction(()=>window.savedSession().uuts.at(-1).instrument.functions[0].ranges.length===6);
    const beforeWidths=await uutTable.locator('thead th').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().width));
    const widthBefore=await uutTable.evaluate(e=>e.getBoundingClientRect().width);
    const resize=uutTable.getByRole('button',{name:'Resize Description column'});
    const box=await resize.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+3);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+250,box.y+3,{steps:4});await page.mouse.up();
    const afterWidths=await uutTable.locator('thead th').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().width));
    const widthAfter=await uutTable.evaluate(e=>e.getBoundingClientRect().width);
    console.log('Resize geometry',{widthBefore,widthAfter,beforeWidths,afterWidths});
    assert.ok(widthAfter-widthBefore>245,'Resizing expands the entire table');
    for(let i=1;i<beforeWidths.length;i++)assert.ok(Math.abs(beforeWidths[i]-afterWidths[i])<2,'Other columns retain their widths');
    await page.screenshot({path:path.join(output,'range-actions-and-resizing.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS shared area, visible order groups, drag ordering, blank range actions, repeated range add, expanding column resize. Artifacts:',output);
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
