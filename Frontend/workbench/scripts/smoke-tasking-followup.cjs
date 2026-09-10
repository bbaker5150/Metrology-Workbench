// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9243");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "tasking-followup-"));
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
let session={id:902,name:'September follow-up',measurementAreas:[{id:'length',name:'Length',color:'#4c9ada'}],uuts:[uut,...Array.from({length:5},(_,i)=>({...uut,id:"u"+(i+2),description:"Micrometer "+(i+2)}))],tmdes:[{...uut,id:'t1',name:'Length reference',description:'Length reference'}, {...uut,id:'t-other',measurementAreaId:'other',measurementArea:'Other',measurementAreaNames:['Other'],name:'Length reference',description:'Length reference'}],testPoints:Array.from({length:3},(_,i)=>({id:'p'+i,measurementAreaId:'length',associatedUutIds:['u1'],activeUutId:'u1',measurementType:'direct',testPointInfo:{parameter:{name:'Length',value:String(i+1),unit:'degF'}},uutTolerance:{...range,functionId:'length-fn',functionName:'Length',rangeId:'range1'},tmdeTolerances:[],components:[{id:"manual-"+i,name:"Manual source",value:1,value_native:1,unit_native:"degF",isBaseUnitValue:false,dof:null}],specifications:{}})),uncReq:{uncertaintyConfidence:95,reliability:95,reqPFA:2,calInt:12}};
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
    const virtual = path.resolve("__tasking-followup.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.resolve("node_modules/.vite-tasking-followup"),
      optimizeDeps: { force: false },
      server: { host: "127.0.0.1", port: 4209, strictPort: false, open: false },
      plugins: [
        {
          name: "tasking-followup",
          resolveId: (id) =>
            id === "/__tasking-followup.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__tasking-followup") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__tasking-followup.jsx"></script></body></html>',
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
        "/__tasking-followup",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9243");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("combobox", { name: "Analysis Session" }).waitFor();
    const rows=page.locator('.point-grid-item');
    await rows.first().waitFor();
    await page.locator('[data-tour="tab-budget"]').click();
    await page.getByRole('button',{name:'Add component to budget',exact:true}).first().click();
    const resolution=page.locator('.budget-picker-section--tmde-resolution button').first();
    await resolution.click();
    await page.waitForFunction(()=>window.savedSession().testPoints[0].components.some(c=>c.isResolution));
    const added=await page.evaluate(()=>window.savedSession().testPoints[0].components.find(c=>c.isResolution));
    assert.ok(Math.abs(added.value_native-0.01/Math.sqrt(12))<1e-9,'TMDE resolution contributes its selected distribution');
    console.log('PASS TMDE resolution addition',added.value_native);
    await page.keyboard.press('Escape');
    const entry=page.getByRole('textbox',{name:'New Measurement Area name'});
    await entry.fill('Blank area');
    const focus=await entry.evaluate(e=>({outline:getComputedStyle(e).outlineColor,accent:getComputedStyle(e).getPropertyValue('--primary-color').trim()}));
    console.log('Area focus',focus);
    await page.getByRole('button',{name:'Add Measurement Area from points',exact:true}).click();
    const typography=async locator=>locator.evaluate(e=>{const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.fontWeight,s.letterSpacing,s.color,s.textTransform];});
    const pointStyle=await typography(page.locator('.sidebar-sort-header').first());
    for(const header of await page.locator('.uncertainty-budget-table thead th').all()) assert.deepEqual(await typography(header),pointStyle,'Budget and approximation header typography');
    await page.locator('[data-tour="tab-overview"]').click();
    const uutTable=page.locator('.instrument-equipment-table').first();
    const tmdeTable=page.locator('.instrument-equipment-table').last();
    for(const table of [uutTable,tmdeTable]) {
      await table.locator('.cell-tolerance .inline-tolerance-summary').first().click();
      await table.locator('.inline-tolerance-editor').first().waitFor();
      await table.locator('.inline-desc-combined').first().click();
      await table.locator('.inline-desc-fields input').first().waitFor();
      assert.equal(await table.locator('.inline-tolerance-editor').count(),0,'Tolerance closes after one description click');
      await page.keyboard.press('Escape');
    }
    console.log('PASS tolerance to description handoff for UUT and TMDE');
    console.log('Header styles',{pointStyle,uut:await typography(uutTable.locator('thead th').first())});
    assert.deepEqual(await typography(uutTable.locator('thead th').first()),pointStyle);
    await uutTable.locator('tr.instrument-function-row').first().click({position:{x:4,y:4}});
    await uutTable.locator('tr.instrument-function-row').nth(4).click({position:{x:4,y:4},modifiers:['Shift']});
    assert.equal(await page.evaluate(()=>window.getSelection().toString()),'','Shift selection never selects text');
    assert.ok(await uutTable.locator('tr.selected-row').count()>=5,'Shift click selects instruments');
    await uutTable.locator('tr.instrument-function-row').first().click({position:{x:4,y:4}});
    await uutTable.locator('tr.instrument-function-row').first().click({button:'right',position:{x:4,y:4}});
    await page.getByText('Copy Instrument',{exact:true}).click();
    const area=uutTable.locator('.instrument-area-section-row').filter({hasText:'Blank area'});
    const areaBox=await area.boundingBox();
    await area.click({button:'right',position:{x:areaBox.width-100,y:areaBox.height/2}});
    await page.getByText('Paste Instrument',{exact:true}).click();
    await page.waitForFunction(()=>window.savedSession().uuts.length===7);
    assert.ok(await page.evaluate(()=>window.savedSession().uuts.at(-1).measurementAreaNames.includes('Blank area')));
    console.log('PASS full-row area paste and instrument Shift selection');
    const handle=page.getByRole('button',{name:'Resize UUT table height',exact:true});
    const container=uutTable.locator('..');
    await handle.scrollIntoViewIfNeeded();
    let h=await handle.boundingBox();
    await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();
    await page.mouse.move(h.x+h.width/2,h.y-150,{steps:5});await page.mouse.up();
    assert.equal(await handle.getAttribute('data-sizing-mode'),'manual');
    h=await handle.boundingBox();
    await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();
    await page.mouse.move(h.x+h.width/2,h.y+180,{steps:5});await page.mouse.up();
    assert.equal(await handle.getAttribute('data-sizing-mode'),'auto');
    const beforeHeight=await container.evaluate(e=>e.clientHeight);
    await area.locator('button').last().click();
    await page.waitForFunction(()=>window.savedSession().uuts.length===8);
    const geometry=await container.evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight,maxHeight:getComputedStyle(e).maxHeight}));
    assert.ok(geometry.height>beforeHeight,'Auto height grows with added instruments');
    assert.ok(geometry.scroll<=geometry.height+1,'Auto height has no vertical scrollbar');
    console.log('PASS auto-height restoration and growth',geometry);
    for(const [query,unit] of [['micrometer','um'],['gram','g']]) {
      await uutTable.locator('.inline-range-editor.is-editing .inline-unit-base-button').last().click();
      await page.getByPlaceholder('Search units...').fill(query);
      await page.locator('.inline-unit-options [role="option"]').first().click();
      await page.waitForFunction(unit=>window.savedSession().uuts.at(-1).instrument.functions[0].ranges[0].unit===unit,unit);
    }
    console.log('PASS full-name searches select micrometer and gram');
    await page.keyboard.press('Escape');
    await page.screenshot({path:path.join(output,'light.png')});
    await page.evaluate(()=>document.body.classList.add('dark-mode'));
    assert.deepEqual(await typography(uutTable.locator('thead th').first()),await typography(page.locator('.sidebar-sort-header').first()));
    await page.screenshot({path:path.join(output,'dark.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS tasking follow-up. Artifacts:',output);
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
