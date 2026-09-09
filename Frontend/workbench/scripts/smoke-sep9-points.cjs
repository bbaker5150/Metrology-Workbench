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
    const swatch=page.getByLabel('Color for Length measurement area');
    await swatch.fill('#9b59b6');
    await page.waitForFunction(()=>window.savedSession().measurementAreaGroups?.some(a=>a.name==='Length') && window.savedSession().measurementAreaGroups.filter(a=>a.name==='Length').every(a=>a.color==='#9b59b6'));
    await page.locator('[data-tour="tab-overview"]').click();
    const tableColors=page.locator('.instrument-equipment-table .instrument-area-section-row:has-text("Length") input[type="color"]');
    assert.ok((await tableColors.evaluateAll(items=>items.map(e=>e.value))).every(value=>value==='#9b59b6'));
    await tableColors.first().fill('#3498db');
    await page.waitForFunction(()=>document.querySelector('.sidebar-area-color-swatch input')?.value==='#3498db');
    await page.mouse.move(5,5);
    const arrow=rows.first().locator('.point-unit-chevron');
    assert.equal(await arrow.evaluate(e=>getComputedStyle(e).opacity),'0');
    await rows.first().locator('.point-unit-control').hover();
    assert.equal(await arrow.evaluate(e=>getComputedStyle(e).opacity),'1');
    for (const dark of [false,true]) {
      await page.evaluate(dark=>document.body.classList.toggle('dark-mode',dark),dark);
      await rows.first().locator('.point-unit-select').focus();
      await page.waitForTimeout(250);
      const styles=await rows.first().locator('.point-unit-select').evaluate(e=>{
        const select=getComputedStyle(e),wrapper=getComputedStyle(e.closest('.point-edit-affordance'));
        return {border:select.borderTopWidth,shadow:select.boxShadow,wrapperShadow:wrapper.boxShadow,wrapperBorder:wrapper.borderTopColor};
      });
      assert.equal(styles.border,'0px');
      assert.equal(styles.shadow,'none');
      assert.equal(styles.wrapperShadow,'none');
      assert.equal(styles.wrapperBorder,'rgba(0, 0, 0, 0)');
      await page.screenshot({path:path.join(output,dark?'unit-focus-dark.png':'unit-focus-light.png')});
    }
    await page.evaluate(()=>document.body.classList.remove('dark-mode'));


    await page.locator('[data-tour="tab-overview"]').click();
    const tableWidths=await page.locator('.instrument-panel-table-container').evaluateAll(items=>items.map(e=>({width:e.clientWidth,scroll:e.scrollWidth,table:e.querySelector('table')?.getBoundingClientRect().width,min:e.querySelector('table')?.style.minWidth})));
    console.log('Table geometry',tableWidths);
    assert.ok(tableWidths.length===2 && tableWidths.every(e=>e.scroll<=e.width+1),'Instrument tables fit the available panel without unnecessary scrolling');
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
    for (const dark of [false,true]) {
      await page.evaluate(dark=>document.body.classList.toggle('dark-mode',dark),dark);
      const widths=await page.locator('.sidebar-column-resizer').evaluateAll(items=>items.map(e=>getComputedStyle(e,'::after').width));
      assert.ok(widths.length>1 && widths.every(width=>width==='1px'),'All dividers are uniformly one pixel wide');
    }
    await page.evaluate(()=>document.body.classList.remove('dark-mode'));
    const handle=await resize.boundingBox();
    await page.evaluate(()=>{
      window.resizeMismatches=[];window.recordResize=true;
      const sample=()=>{
        const header=document.querySelector('.sidebar-column-headers');
        const row=document.querySelector('.point-grid-item');
        if(header && row && getComputedStyle(header).gridTemplateColumns!==getComputedStyle(row).gridTemplateColumns)
          window.resizeMismatches.push([getComputedStyle(header).gridTemplateColumns,getComputedStyle(row).gridTemplateColumns]);
        if(window.recordResize) requestAnimationFrame(sample);
      };requestAnimationFrame(sample);
    });
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
    await page.mouse.down();
    for (const offset of [120,30,170,60]) await page.mouse.move(handle.x+handle.width/2+offset,handle.y+handle.height/2,{steps:2});
    await page.mouse.up();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const mismatches=await page.evaluate(()=>{window.recordResize=false;return window.resizeMismatches;});
    assert.deepEqual(mismatches,[],'Header and row tracks stay synchronized during rapid resizing');
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
    await page.keyboard.press('Escape');
    await rows.first().click({position:{x:3,y:3}});
    await rows.nth(1).click({position:{x:3,y:3},modifiers:['Control']});
    assert.equal(await page.locator('.point-grid-item.active').count(),2);
    await rows.first().click({button:'right',position:{x:3,y:3}});
    await page.getByText('Copy 2 Points',{exact:true}).click();
    await rows.nth(1).click({button:'right',position:{x:3,y:3}});
    await page.getByText('Paste 2 Points',{exact:true}).click();
    await page.waitForFunction(()=>window.savedSession().testPoints.length===7);
    const pasted=await page.evaluate(()=>window.savedSession().testPoints);
    assert.deepEqual(pasted.slice(0,2).map(p=>p.id),['p0','p1']);
    assert.deepEqual(pasted.slice(2,4).map(p=>p.testPointInfo.parameter.value),['11','2']);
    assert.equal(pasted[4].id,order[2]);
    assert.ok(pasted.slice(2,4).every(p=>Number.isFinite(p.combined_uncertainty_absolute_base) && Number.isFinite(p.expanded_uncertainty_absolute_base)),'Every pasted point has uncertainty results before being opened');
    await page.keyboard.press('Escape');
    await rows.first().click({position:{x:3,y:3}});
    await rows.nth(1).click({position:{x:3,y:3},modifiers:['Control']});
    await page.keyboard.press('Control+c');
    await rows.first().click({position:{x:3,y:3}});
    await page.keyboard.press('Control+v');
    await page.waitForFunction(()=>window.savedSession().testPoints.length===9);
    const keyboardPaste=await page.evaluate(()=>window.savedSession().testPoints);
    assert.deepEqual(keyboardPaste.slice(1,3).map(p=>p.testPointInfo.parameter.value),['11','2']);
    assert.equal(keyboardPaste[3].id,'p1');
    await rows.first().locator('.point-unit-select').selectOption('');
    await page.waitForFunction(()=>window.savedSession().testPoints[0].testPointInfo.parameter.unit==='');
    await rows.first().locator('.point-unit-select').selectOption('degF');
    await page.waitForFunction(()=>window.savedSession().testPoints[0].testPointInfo.parameter.unit==='degF');
    await page.getByRole('button',{name:'Add component to budget',exact:true}).first().click();
    await page.locator('.budget-tmde-picker-instrument').first().waitFor();
    assert.equal(await page.locator('.budget-tmde-picker-instrument').count(),1,'Only the current area TMDE appears, despite an identical instrument in another area');
    await page.screenshot({path:path.join(output,'budget-area-options.png')});
    await page.keyboard.press('Escape');
    await page.mouse.move(5,5);
    const collapse=page.locator('.function-sidebar-collapse-button').first();
    assert.equal(await collapse.evaluate(e=>getComputedStyle(e).opacity),'0');
    await collapse.locator('..').hover();
    assert.equal(await collapse.evaluate(e=>getComputedStyle(e).opacity),'1');
    const chevronBox=await collapse.boundingBox();
    const colorBox=await page.locator('.sidebar-area-color-swatch').first().boundingBox();
    assert.ok(colorBox.x-(chevronBox.x+chevronBox.width)>=6,'Chevron has a separate gutter before the color selector');
    await page.screenshot({path:path.join(output,'area-chevron-gutter.png')});

    await page.getByRole('button',{name:'Add Measurement Area from points'}).click();
    for (const dark of [false,true]) {
      await page.evaluate(dark=>document.body.classList.toggle('dark-mode',dark),dark);
      await page.screenshot({path:path.join(output,dark?'area-menu-dark.png':'area-menu-light.png')});
      const menu=await page.locator('.sidebar-add-area-form').boundingBox();
      assert.ok(menu.width<=260 && menu.x>=0 && menu.x+menu.width<=1500,'Inline area entry stays compact');
      assert.ok((await page.getByRole('textbox',{name:'New Measurement Area name'}).boundingBox()).width<=120,'Area name input stays small');
      assert.ok(await page.locator('.sidebar-actions-group .sidebar-add-area-form').count(),'Area entry stays inline with the buttons');
    }
    await page.evaluate(()=>document.body.classList.remove('dark-mode'));
    await page.getByRole('textbox',{name:'New Measurement Area name'}).fill('Quick calculation');
    await page.locator('.sidebar-add-area-form').getByRole('button',{name:'Add',exact:true}).click();
    await page.waitForFunction(()=>window.savedSession().measurementAreaGroups.some(area=>area.name==='Quick calculation'));
    console.log('Areas after creation',await page.locator('.area-header-sticky').allTextContents(),await page.evaluate(()=>window.savedSession().measurementAreaGroups));
    await page.locator('.area-header-sticky').filter({hasText:/Quick calculation/i}).locator('[data-tour="add-measurement-point"]').click();
    await page.locator('.sidebar-inline-input.value').fill('10');
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.savedSession().testPoints.some(point=>point.testPointInfo.measurementArea==='Quick calculation' && point.testPointInfo.parameter.value==='10'));
    const quick=await page.evaluate(()=>window.savedSession().testPoints.find(point=>point.testPointInfo.measurementArea==='Quick calculation'));
    assert.equal(quick.testPointInfo.parameter.unit,'');
    assert.deepEqual(quick.associatedUutIds,[]);
    await rows.last().getByRole('button',{name:'UUT',exact:true}).click();
    await page.screenshot({path:path.join(output,'uut-menu-header-action.png')});
    await page.locator('.inline-menu-select-menu').getByRole('button',{name:'Add UUT to this measurement area',exact:true}).click();
    await page.waitForFunction(()=>window.savedSession().uuts.length===2);
    const created=await page.evaluate(()=>window.savedSession().uuts.at(-1));
    assert.deepEqual(created.measurementAreaNames,['Quick calculation']);
    assert.equal(created.instrument.functions[0].ranges.length,1);
    assert.equal(created.description,'');
    await page.waitForFunction(()=>window.savedSession().testPoints.at(-1).associatedUutIds[0]===window.savedSession().uuts.at(-1).id);
    await page.locator('[data-tour="tab-overview"].active').waitFor();
    assert.ok(await page.locator('.instrument-equipment-table tr:is(.instrument-selected,.selected-row)').count(),'New instrument is selected in overview');
    await page.screenshot({path:path.join(output,'area-and-unit-workflow.png')});
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
