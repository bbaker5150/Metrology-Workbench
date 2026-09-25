// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9283");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "menu-toggles-"));
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
    const virtual = path.resolve("__menu-toggles.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.resolve("node_modules/.vite-menu-toggles"),
      optimizeDeps: { force: false },
      server: { host: "127.0.0.1", port: 4239, strictPort: false, open: false },
      plugins: [
        {
          name: "menu-toggles",
          resolveId: (id) =>
            id === "/__menu-toggles.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__menu-toggles") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__menu-toggles.jsx"></script></body></html>',
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
        "/__menu-toggles",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9283");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("combobox", { name: "Analysis Session" }).waitFor();
    const rows=page.locator('.point-grid-item');
    await rows.first().waitFor();



    const styles=el=>{const s=getComputedStyle(el);return {color:s.color,background:s.backgroundColor,border:s.borderColor,shadow:s.boxShadow};};
    const settle=async()=>{await page.mouse.move(1475,150);await page.waitForTimeout(180);};
    const toggle=async(button, attribute='aria-expanded')=>{
      await button.scrollIntoViewIfNeeded();
      await settle();
      const closed=await button.evaluate(styles);
      assert.equal(await button.getAttribute(attribute),'false');
      await button.click();
      await settle();
      assert.equal(await button.getAttribute(attribute),'true');
      const active=await button.evaluate(styles);
      assert.notEqual(active.background,closed.background,'Open trigger needs a visible active background');
      await button.click();
      await settle();
      assert.equal(await button.getAttribute(attribute),'false');
      assert.deepEqual(await button.evaluate(styles),closed,'Closing must restore the inactive styling');
      return active;
    };
    const filterStyle=await toggle(page.getByRole('button',{name:'Columns',exact:true}));
    for(const name of ['Unit converter','Reverse traceability','Instrument builder']) {
      assert.deepEqual(await toggle(page.getByRole('button',{name,exact:true})),filterStyle,`${name} active style should match the filter`);
    }
    const scaling=page.getByLabel('UI Settings',{exact:true});
    await scaling.click();await settle();
    assert.deepEqual(await scaling.evaluate(styles),filterStyle,'Scaling summary should share the same active style');
    await scaling.click();
    assert.equal(await page.locator('.ui-settings').getAttribute('open'),null);
    console.log('PASS: toolbar windows, scaling, and filter have matching active styles and click-to-close behavior');
    await rows.first().click();
    await page.locator('[data-tour="tab-budget"]').click();
    for(const kind of ['UUT','TMDE']) {
      const show=page.getByRole('button',{name:`Show all ${kind} measurement areas`,exact:true});
      await show.click();await settle();
      const hide=page.getByRole('button',{name:`Show this ${kind} measurement area`,exact:true});
      assert.deepEqual(await hide.evaluate(styles),filterStyle);
      await hide.click();
    }
    await page.getByRole('button',{name:'Edit measurement equation',exact:true}).click();
    for(const title of ['Insert function or symbol','Insert a common metrology equation']) {
      assert.deepEqual(await toggle(page.getByTitle(title,{exact:true})),filterStyle);
    }
    await page.getByTitle('Insert a common metrology equation',{exact:true}).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByTitle('Insert a common metrology equation',{exact:true}).getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('.budget-contribution-button').count(), 0);
    const breakdown=page.getByRole('button',{name:'Calculation breakdown',exact:true});
    assert.deepEqual(await toggle(breakdown),filterStyle);
    const add=page.getByRole('button',{name:'Add component to budget',exact:true}).first();
    assert.deepEqual(await toggle(add),filterStyle);
    const picker=page.getByRole('dialog',{name:'Add component to budget',exact:true});
    assert.equal(await picker.count(),0);
    await add.click();await picker.waitFor();
    await page.mouse.click(1400,180);
    assert.equal(await add.getAttribute('aria-expanded'),'false');
    assert.equal(await picker.count(),0);
    await add.click();await picker.waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await add.getAttribute('aria-expanded'),'false');
    await add.click();
    const allAdds=page.getByRole('button',{name:'Add component to budget',exact:true});
    if(await allAdds.count()>1){
      await allAdds.last().scrollIntoViewIfNeeded();
      if(await picker.count()) await page.keyboard.press('Escape');
      await allAdds.last().click();
      assert.equal(await add.getAttribute('aria-expanded'),'false');
      assert.equal(await allAdds.last().getAttribute('aria-expanded'),'true');
      assert.equal(await picker.count(),1);
      await allAdds.last().click();
    } else await add.click();
    console.log('PASS: equation menus, visibility toggles, and budget add menus expose matching active states, toggle closed, and clear on dismissal');
    await page.screenshot({path:path.join(output,'menu-toggles.png')});
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
