// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9279");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-complete-"));
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
    const virtual = path.resolve("__feedback-complete.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.resolve("node_modules/.vite-feedback-complete"),
      optimizeDeps: { force: false },
      server: { host: "127.0.0.1", port: 4235, strictPort: false, open: false },
      plugins: [
        {
          name: "feedback-complete",
          resolveId: (id) =>
            id === "/__feedback-complete.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__feedback-complete") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__feedback-complete.jsx"></script></body></html>',
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
        "/__feedback-complete",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9279");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("combobox", { name: "Analysis Session" }).waitFor();
    const rows=page.locator('.point-grid-item');
    await rows.first().waitFor();


    await page.locator('[data-tour="tab-overview"]').click();
    const firstRow=page.locator('tr.inline-range-row').first();
    const table=firstRow.locator('xpath=ancestor::table');
    await firstRow.waitFor();
    await firstRow.locator('td[data-range-cell]').click({position:{x:3,y:3}});
    await firstRow.getByRole('button',{name:'Add range',exact:true}).waitFor();
    const customCells=table.locator('.instrument-custom-field-cell');
    assert.equal(await customCells.count(),2);
    await customCells.nth(0).getByTitle('Edit field').click();
    await table.locator('.instrument-custom-field-input').fill('Shared note');
    await table.locator('.instrument-custom-field-input').press('Enter');
    await customCells.nth(1).getByTitle('Edit field').click();
    await table.locator('.instrument-custom-field-input').fill('Shared note');
    await table.locator('.instrument-custom-field-input').press('Enter');
    await page.waitForFunction(()=>document.querySelector('.instrument-custom-field-cell')?.rowSpan===2);
    console.log('PASS: custom fields are separate per range and matching values merge');
    const widths=()=>table.locator('th[data-instrument-column]').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().width));
    const before=await widths();
    const handle=table.getByRole('button',{name:'Resize Description column',exact:true});
    const hb=await handle.boundingBox();
    await page.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await page.mouse.down();await page.mouse.move(hb.x-120,hb.y+hb.height/2,{steps:10});await page.mouse.up();
    const after=await widths();
    assert.ok(after[0]<before[0]);
    after.slice(1).forEach((width,index)=>assert.ok(Math.abs(width-before[index+1])<2,`Column ${index+1} changed from ${before[index+1]} to ${width}`));
    await page.screenshot({path:path.join(output,'instrument-columns.png')});
    console.log('PASS: narrowing one column preserves every other column');
    await table.getByRole('button',{name:'Resize Description column',exact:true}).dblclick();
    await firstRow.getByTitle('Edit range').click();
    await firstRow.getByRole('button',{name:'Range unit prefix',exact:true}).click();
    assert.equal(await page.locator('.unit-prefix-menu [role="option"]').count(),21);
    await page.screenshot({path:path.join(output,'prefix-menu.png')});
    await page.keyboard.press('Escape');
    await page.getByLabel('UI Settings',{exact:true}).click();
    assert.equal(await page.getByRole('radio',{name:'Whole app',exact:true}).getAttribute('aria-checked'),'true');
    await page.getByRole('radio',{name:'Individual sections',exact:true}).click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('workbench:ui-scale-lock')),'false');
    await page.getByRole('radio',{name:'Whole app',exact:true}).click();
    await page.screenshot({path:path.join(output,'scaling-menu.png')});
    await page.mouse.move(1000,400);await page.keyboard.down('Control');await page.mouse.wheel(0,-100);await page.keyboard.up('Control');
    await page.waitForFunction(()=>document.documentElement.style.zoom==='1.1');
    await page.getByRole('button',{name:'Reset to 100%'}).click();
    await page.waitForFunction(()=>document.documentElement.style.zoom==='1');
    await page.getByLabel('UI Settings',{exact:true}).click();
    console.log('PASS: scale lock zooms the whole page over a table and reset restores 100%');
    await rows.first().click();
    await page.locator('[data-tour="tab-budget"]').click();
    const equation=page.getByRole('button',{name:'Edit measurement equation',exact:true});
    await equation.waitFor();
    const card=page.locator('.measurement-equation-card').first();
    const height=(await card.boundingBox()).height;
    await equation.click();
    assert.ok(Math.abs((await card.boundingBox()).height-height)<2,'Equation changes height in edit mode');
    await page.getByTitle('Insert a common metrology equation').click();
    const menu=page.locator('.add-point-symbol-popover').last();
    const rect=await menu.boundingBox();
    assert.ok(rect.y>=0 && rect.y+rect.height<=1000);
    await page.screenshot({path:path.join(output,'equation-menu.png')});
    await page.keyboard.press('Escape');
    const collapse=page.getByRole('button',{name:'Collapse Measurement Equation section'});
    await page.locator('.detail-workspace-section-label').filter({hasText:'Measurement Equation'}).click();
    assert.equal(await collapse.getAttribute('aria-expanded'),'true');
    await collapse.click();
    await page.getByRole('button',{name:'Expand Measurement Equation section'}).waitFor();
    console.log('PASS: equation size remains stable; only the chevron collapses the section');
    await page.getByRole('button',{name:'Add component to budget',exact:true}).first().click();
    const reference=page.locator('.budget-tmde-picker-instrument-name').filter({hasText:'Laboratory multifunction reference calibrator'});
    assert.equal(await reference.isEnabled(),true);
    await reference.click();
    await page.waitForFunction(()=>window.savedSession().testPoints[0].components.length>0);
    const sourceLabel='Precision Instruments REF-2000 Laboratory multifunction reference calibrator - Error Limit';
    const sourceCell=page.locator('.budget-source-cell').filter({hasText:sourceLabel}).first();
    await sourceCell.waitFor();
    await sourceCell.scrollIntoViewIfNeeded();
    assert.equal(await page.getByRole('columnheader',{name:'Tolerance Limit',exact:true}).count(),0);
    assert.ok(await page.getByRole('columnheader',{name:'Error Limit',exact:true}).count()>0);
    await page.mouse.click(580,200);
    const budget=sourceCell.locator('xpath=ancestor::table');
    const budgetPanel=budget.locator('xpath=ancestor::div[contains(@class,"budget-stack-section")]');
    await budget.scrollIntoViewIfNeeded();
    const budgetWidths=()=>budget.locator('thead th').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().width));
    const initialBudgetWidths=await budgetWidths();
    const content=await budget.evaluate(el=>({
      width:el.getBoundingClientRect().width,
      viewport:el.parentElement.clientWidth,
      cells:[...el.querySelectorAll('th,td')].map(cell=>({tag:cell.tagName,text:cell.textContent,space:getComputedStyle(cell).whiteSpace,client:cell.clientWidth,scroll:cell.scrollWidth})),
    }));
    assert.ok(content.width>content.viewport,'Long descriptions should scroll instead of squeezing columns');
    content.cells.forEach(cell=>{assert.equal(cell.space,'nowrap');assert.ok(cell.scroll<=cell.client+(cell.tag==='TH'?5:1),'Default column clips content: '+JSON.stringify(cell));});
    await page.screenshot({path:path.join(output,'full-instrument-budget-name.png')});
    await budget.screenshot({path:path.join(output,'budget-content-fit.png')});
    const budgetHandle=budget.getByRole('button',{name:'Resize Error Source Name column',exact:true});
    await budgetHandle.scrollIntoViewIfNeeded();
    const bh=await budgetHandle.boundingBox();
    await page.mouse.move(bh.x+bh.width/2,bh.y+bh.height/2);await page.mouse.down();
    await page.mouse.move(bh.x+bh.width/2-100,bh.y+bh.height/2,{steps:8});await page.mouse.up();
    const resizedBudgetWidths=await budgetWidths();
    assert.ok(Math.abs(resizedBudgetWidths[0]-initialBudgetWidths[0]+100)<2,'Budget drag must follow pointer');
    resizedBudgetWidths.slice(1).forEach((width,index)=>assert.ok(Math.abs(width-initialBudgetWidths[index+1])<2,'Budget resize changed a neighboring column'));
    await budgetHandle.press('ArrowRight');
    assert.ok(Math.abs((await budgetWidths())[0]-resizedBudgetWidths[0]-12)<2,'Budget keyboard resize');
    // Narrow all columns to check the complete panel follows their total width.
    for(const h of await budget.locator('thead .budget-column-resize-handle').all()) {
      for(let i=0;i<65;i++) await h.press('ArrowLeft');
    }
    const panelBounds=await budgetPanel.boundingBox();
    const tableBounds=await budget.boundingBox();
    assert.ok(Math.abs(panelBounds.width-tableBounds.width-2)<3,'Budget panel leaves empty strip');
    await budgetHandle.dblclick();
    assert.equal(await budget.evaluate(el=>el.classList.contains('has-custom-widths')),false);
    const resetBudgetWidths=await budgetWidths();
    resetBudgetWidths.forEach((width,index)=>assert.ok(Math.abs(width-initialBudgetWidths[index])<2,'Double-click must restore content fitting'));
    await budgetHandle.press('ArrowRight');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('uncert-reset-ui-sizes')));
    assert.equal(await budget.evaluate(el=>el.classList.contains('has-custom-widths')),false);
    const equationTable=page.locator('.budget-resizable-table').filter({has:page.getByRole('columnheader',{name:'Sensitivity Coefficient',exact:true})});
    assert.equal(await equationTable.getByRole('button',{name:'Resize Sensitivity Coefficient column',exact:true}).count(),1);
    console.log('PASS: budget defaults fit all content, drag/keyboard resize preserve neighbors, panel shrinks, and resets restore automatic widths');
    console.log('PASS: clicking a single-range instrument name adds it to the budget');
    const emptyHint=page.locator('.measurement-point-empty-hint');
    await emptyHint.waitFor();
    await emptyHint.scrollIntoViewIfNeeded();
    const arrow=await emptyHint.locator('span').boundingBox();
    const add=await emptyHint.locator('xpath=..').locator('.function-point-add-button').boundingBox();
    assert.ok(Math.abs(arrow.x+arrow.width/2-add.x-add.width/2)<3,'Empty hint arrow must align beneath the add button');
    await page.screenshot({path:path.join(output,'empty-area-hint.png')});
    assert.equal(await emptyHint.evaluate(el=>el.tagName),'DIV');
    const pointCount=await rows.count();
    await emptyHint.click();
    assert.equal(await rows.count(),pointCount,'Instructional text must not add a point');
    await emptyHint.locator('xpath=..').locator('.function-point-add-button').click();
    await page.waitForFunction(()=>document.querySelectorAll('.point-grid-item').length===4);
    assert.equal(await emptyHint.count(),0);
    console.log('PASS: the non-clickable empty-area hint points users to the working add button');
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
