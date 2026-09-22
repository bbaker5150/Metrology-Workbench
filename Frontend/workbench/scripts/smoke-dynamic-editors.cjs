// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9285");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "dynamic-editors-"));
app.setPath("userData", path.join(output, "profile"));
const source = `
import '/src/index.css';import ZoomToast from '/src/shared/ZoomToast.jsx';
import React from 'react';import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router';import axios from 'axios';
import WorkbenchShell from '/src/app/WorkbenchShell.jsx';
import UncertaintyApp from '/src/modules/uncertainty/UncertaintyApp.jsx';
import {ThemeProvider} from '/src/shared/ThemeContext.jsx';
import {NotificationProvider} from '/src/shared/NotificationContext.jsx';
const range={id:'range1',min:0,max:100,unit:'V',measuringResolution:0.01,measuringResolutionUnit:'V',measuringResolutionDistribution:'3.464',tolerances:{reading:{high:1,low:-1,unit:'%',distribution:'1.732',symmetric:true}}};
const uut={id:'u1',description:'Micrometer',measurementArea:'Length',measurementAreaId:'length',instrument:{id:'def1',manufacturer:'Bench',model:'M1',description:'Micrometer',functions:[{id:'length-fn',name:'Length',unit:'V',ranges:[range,{...range,id:"range2",min:100,max:200}]}]}};
let session={id:902,name:'September follow-up',measurementAreas:[{id:'length',name:'Length',color:'#4c9ada'}],uuts:[uut,...Array.from({length:5},(_,i)=>({...uut,id:"u"+(i+2),description:"Micrometer "+(i+2)}))],tmdes:[{...uut,id:'t1',name:'Length reference',description:'Length reference'}, {...uut,id:'t-other',measurementAreaId:'other',measurementArea:'Other',measurementAreaNames:['Other'],name:'Length reference',description:'Length reference'}],testPoints:Array.from({length:3},(_,i)=>({id:'p'+i,measurementAreaId:'length',associatedUutIds:['u1'],activeUutId:'u1',measurementType:'direct',testPointInfo:{parameter:{name:'Length',value:i===0?'123456789.123456':String(i+1),unit:i===0?'':'V'}},uutTolerance:{...range,functionId:'length-fn',functionName:'Length',rangeId:'range1'},tmdeTolerances:[],components:[{id:"manual-"+i,name:"Manual source",value:1,value_native:1,unit_native:"V",isBaseUnitValue:false,dof:null}],specifications:{}})),uncReq:{uncertaintyConfidence:95,reliability:95,reqPFA:2,calInt:12}};
session.measurementAreaGroups=[{name:'Length'},{name:'Empty area',color:'#4c9ada'}];session.uuts=[uut];session.tmdes=[{...uut,id:'reference',name:'Laboratory multifunction reference calibrator',description:'Laboratory multifunction reference calibrator',instrument:{...uut.instrument,manufacturer:'Precision Instruments',model:'REF-2000',description:'Laboratory multifunction reference calibrator',functions:[{...uut.instrument.functions[0],ranges:[range]}]}}];session.testPoints=session.testPoints.map((p,i)=>({...p,components:[],testPointInfo:{parameter:{name:'Length',value:String((i+1)*50),unit:'V'}}}));
session.instrumentCustomColumns={uut:[{key:'notes',label:'Notes',insertAfter:'description'}]}; session.testPoints[0]={...session.testPoints[0],measurementType:'derived',equationString:'x',variableMappings:{x:'Voltage'},variableNominals:{x:{value:50,unit:'V'}}};let issues=[];window.savedSession=()=>session;window.savedIssues=()=>issues;
axios.get=async url=>({data:String(url).includes('/sessions/')?[session]:String(url).includes('/uncertainty/bug_reports/')?[]:String(url).includes('/bug_reports/')?issues:[]});
axios.put=async(url,data)=>{if(String(url).includes('/sessions/'))session=structuredClone(data);return {data};};
axios.post=async(url,data)=>{if(String(url).includes('/bug_reports/')){if(window.failIssueSave){window.failIssueSave=false;throw Error('offline');}const saved={...data,id:issues.length+1,created_at:new Date().toISOString()};issues.push(saved);return {data:saved};}return {data};};
axios.patch=async(url,data)=>({data});axios.delete=async()=>({data:{}});
localStorage.setItem('uncertalytics.uiPreferences.v1:902',JSON.stringify({expandedFunctions:['length'],expandedUuts:['length::u1']}));
createRoot(document.getElementById('root')).render(<ThemeProvider><ZoomToast/><NotificationProvider><MemoryRouter initialEntries={['/uncertalytics']}><Routes><Route element={<WorkbenchShell/>}><Route path='/uncertalytics' element={<UncertaintyApp/>}/></Route></Routes></MemoryRouter></NotificationProvider></ThemeProvider>);
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
    const virtual = path.resolve("__dynamic-editors.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.resolve("node_modules/.vite-dynamic-editors"),
      optimizeDeps: { force: false },
      server: { host: "127.0.0.1", port: 4241, strictPort: false, open: false },
      plugins: [
        {
          name: "dynamic-editors",
          resolveId: (id) =>
            id === "/__dynamic-editors.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__dynamic-editors") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__dynamic-editors.jsx"></script></body></html>',
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
        "/__dynamic-editors",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9285");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("combobox", { name: "Analysis Session" }).waitFor();
    const rows=page.locator('.point-grid-item');
    await rows.first().waitFor();




    await rows.first().click();
    await page.locator('[data-tour="tab-budget"]').click();
    const add=page.getByRole('button',{name:'Add component to budget',exact:true}).first();
    const panel=add.locator('xpath=ancestor::div[contains(@class,"budget-stack-section")]');
    const table=panel.locator(':scope > .budget-section-table-wrap > table');
    const widths=()=>table.locator(':scope > thead > tr > th').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().width));
    await table.getByRole('button',{name:'Resize Error Limit column',exact:true}).press('ArrowLeft');
    const initialWidths=await widths();
    await add.click();
    await page.getByRole('button',{name:'Add tabular component',exact:true}).click();
    const tabular=page.getByRole('group',{name:'Tabular uncertainty editor',exact:true});
    await tabular.waitFor();
    const name=page.getByRole('textbox',{name:'Error source name',exact:true});
    assert.equal(await name.evaluate(el=>el===document.activeElement),true,'New component must focus its name');
    await name.fill('Calibration table');
    const afterOpen=await widths();
    assert.ok(afterOpen[1]>initialWidths[1]+200,'The active editor needs temporary column space');
    console.log('WIDTHS',JSON.stringify({initialWidths,afterOpen,table:await table.evaluate(t=>({width:t.style.width,layout:getComputedStyle(t).tableLayout,cols:[...t.querySelectorAll(':scope > colgroup > col')].map(c=>c.style.width)}))}));
    initialWidths.slice(2).forEach((w,i)=>assert.ok(Math.abs(w-afterOpen[i+2])<2,'Editor changed an unrelated column '+i+': '+w+' to '+afterOpen[i+2]));
    await tabular.getByRole('textbox',{name:'Measurement point row 1',exact:true}).fill('50');
    await tabular.getByRole('textbox',{name:'Uncertainty row 1',exact:true}).fill('0.012');
    const unit=tabular.getByRole('button',{name:'Uncertainty unit base unit',exact:true});
    await unit.click();
    await page.locator('.inline-unit-menu').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await tabular.count(),1,'Closing a unit menu must leave the component editor open');
    await tabular.getByRole('button',{name:'Values represent',exact:true}).click();
    await page.getByRole('option',{name:'Error limit (±)',exact:true}).click();
    assert.equal(await tabular.count(),1,'Changing a portaled selector must leave the editor open');
    await tabular.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'tabular-inline-light.png')});
    await tabular.getByRole('textbox',{name:'Uncertainty row 1',exact:true}).press('Enter');
    await page.waitForFunction(()=>window.savedSession().dynamicBudgetDefinitions?.some(d=>d.name==='Calibration table'&&d.rows[0].point==='50'));
    assert.equal(await tabular.count(),0);
    const afterClose=await widths();
    initialWidths.forEach((w,i)=>assert.ok(Math.abs(w-afterClose[i])<2,'Closing an editor must restore saved column widths'));
    console.log('PASS: tabular creation opens directly; shared selectors stay inside the editor; only active columns expand and all saved widths return');
    await add.click();
    await page.getByRole('button',{name:'Add equation component',exact:true}).click();
    const equation=page.getByRole('group',{name:'Equation uncertainty editor',exact:true});
    await equation.waitFor();
    await page.getByRole('textbox',{name:'Error source name',exact:true}).fill('Transfer equation');
    await equation.getByRole('textbox',{name:'Uncertainty equation',exact:true}).fill('x * a + b');
    const binding=equation.getByRole('button',{name:'Use measurement point for x',exact:true});
    await binding.waitFor();
    if(await binding.getAttribute('aria-pressed')!=='true') await binding.click();
    await equation.getByRole('textbox',{name:'a nominal',exact:true}).waitFor();
    assert.equal(await equation.getByRole('button',{name:'Use measurement point for x',exact:true}).getAttribute('aria-pressed'),'true');
    await equation.getByRole('textbox',{name:'a name',exact:true}).fill('Scale factor');
    await equation.getByRole('textbox',{name:'a nominal',exact:true}).fill('0.001');
    await equation.getByRole('textbox',{name:'b nominal',exact:true}).fill('0.002');
    assert.ok((await equation.getByRole('status').innerText()).includes('0.052 V'));
    assert.equal(await page.getByRole('button',{name:'Set uncertainty equation',exact:true}).count(),0);
    await equation.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'equation-inline-light.png')});
    await equation.getByRole('textbox',{name:'b nominal',exact:true}).press('Enter');
    await page.waitForFunction(()=>window.savedSession().dynamicBudgetDefinitions?.some(d=>d.name==='Transfer equation'&&d.variables.b?.value==='0.002'));
    assert.equal(await equation.count(),0);
    const saved=await page.evaluate(()=>window.savedSession().dynamicBudgetDefinitions.find(d=>d.name==='Transfer equation'));
    assert.equal(saved.pointVariable,'x');
    assert.equal(saved.variables.a.name,'Scale factor');
    await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
    await page.getByTitle('Edit equation uncertainty',{exact:true}).click();
    await equation.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'equation-inline-dark.png')});
    console.log('PASS: equation variables appear while typing, preserve descriptions and values, and use a compact measurement-point binding');
    console.log('OUTPUT',output);
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
