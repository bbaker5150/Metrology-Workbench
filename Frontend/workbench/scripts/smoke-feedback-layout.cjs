// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9281");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-layout-"));
app.setPath("userData", path.join(output, "profile"));
const source = `
import '/src/index.css';import ZoomToast from '/src/shared/ZoomToast.jsx';
import React from 'react';import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router';import axios from 'axios';
import WorkbenchShell from '/src/app/WorkbenchShell.jsx';
import UncertaintyApp from '/src/modules/uncertainty/UncertaintyApp.jsx';
import {ThemeProvider} from '/src/shared/ThemeContext.jsx';
import {NotificationProvider} from '/src/shared/NotificationContext.jsx';
const range={id:'range1',min:0,max:100,unit:'in-ozf',measuringResolution:0.01,measuringResolutionUnit:'in-ozf',measuringResolutionDistribution:'3.464',tolerances:{floor:{high:3,low:-3,unit:'lb-in',distribution:'1.732',symmetric:true},reading:{high:1,low:-1,unit:'%',distribution:'1.732',symmetric:true}}};
const uut={id:'u1',description:'Micrometer',measurementArea:'Length',measurementAreaId:'length',instrument:{id:'def1',manufacturer:'Bench',model:'M1',description:'Micrometer',functions:[{id:'length-fn',name:'Length',unit:'in-ozf',ranges:[range,{...range,id:"range2",min:100,max:200}]}]}};
let session={id:902,name:'September follow-up',measurementAreas:[{id:'length',name:'Length',color:'#4c9ada'}],uuts:[uut,...Array.from({length:5},(_,i)=>({...uut,id:"u"+(i+2),description:"Micrometer "+(i+2)}))],tmdes:[{...uut,id:'t1',name:'Length reference',description:'Length reference'}, {...uut,id:'t-other',measurementAreaId:'other',measurementArea:'Other',measurementAreaNames:['Other'],name:'Length reference',description:'Length reference'}],testPoints:Array.from({length:3},(_,i)=>({id:'p'+i,measurementAreaId:'length',associatedUutIds:['u1'],activeUutId:'u1',measurementType:'direct',testPointInfo:{parameter:{name:'Length',value:i===0?'123456789.123456':String(i+1),unit:i===0?'':'V'}},uutTolerance:{...range,functionId:'length-fn',functionName:'Length',rangeId:'range1'},tmdeTolerances:[],components:[{id:"manual-"+i,name:"Manual source",value:1,value_native:1,unit_native:"V",isBaseUnitValue:false,dof:null}],specifications:{}})),uncReq:{uncertaintyConfidence:95,reliability:95,reqPFA:2,calInt:12}};
session.measurementAreaGroups=[{name:'Length',color:'#25d91a'},{name:'Empty area',color:'#4c9ada'}];session.uuts=[uut];session.tmdes=[{...uut,id:'reference',name:'Single-range reference',description:'Single-range reference',instrument:{...uut.instrument,description:'Single-range reference',functions:[{...uut.instrument.functions[0],ranges:[range]}]}}];session.testPoints=session.testPoints.map((p,i)=>({...p,components:[],testPointInfo:{parameter:{name:'Length',value:String((i+1)*50),unit:'in-ozf'}}}));
session.instrumentCustomColumns={uut:[{key:'notes',label:'Notes',insertAfter:'description'}]}; session.testPoints[0]={...session.testPoints[0],measurementType:'derived',equationString:'',variableMappings:{x:'Voltage'},variableNominals:{x:{value:50,unit:'in-ozf'}}};let issues=[];window.savedSession=()=>session;window.savedIssues=()=>issues;
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
    const virtual = path.resolve("__feedback-layout.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.resolve("node_modules/.vite-feedback-layout"),
      optimizeDeps: { force: false },
      server: { host: "127.0.0.1", port: 4237, strictPort: false, open: false },
      plugins: [
        {
          name: "feedback-layout",
          resolveId: (id) =>
            id === "/__feedback-layout.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__feedback-layout") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__feedback-layout.jsx"></script></body></html>',
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
        "/__feedback-layout",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9281");
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
    const panel=table.locator('xpath=ancestor::div[contains(@class,"panel-card")][1]');
    await page.waitForFunction(()=>{
      const table=document.querySelector('tr.inline-range-row')?.closest('table');
      return Math.abs(table.closest('.panel-card').getBoundingClientRect().width-table.getBoundingClientRect().width-2)<2;
    });
    assert.ok((await panel.boundingBox()).width<before.reduce((a,b)=>a+b,0));
    await page.screenshot({path:path.join(output,'instrument-columns.png')});
    console.log('PASS: narrowing one column preserves every other column');
    await table.getByRole('button',{name:'Resize Description column',exact:true}).dblclick();
    await firstRow.getByTitle('Edit range').click();
    const rangeUnit=firstRow.getByRole('button',{name:'Range unit base unit',exact:true});
    assert.equal(await rangeUnit.locator('span').textContent(),'in·ozf');
    assert.ok(await rangeUnit.locator('span').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.screenshot({path:path.join(output,'full-range-unit.png')});
    await firstRow.getByRole('button',{name:'Range unit prefix',exact:true}).click();
    assert.equal(await page.locator('.unit-prefix-menu [role="option"]').count(),21);
    await page.screenshot({path:path.join(output,'prefix-menu.png')});
    await page.keyboard.press('Escape');
    await firstRow.getByTitle('Edit tolerance',{exact:true}).click();
    const greater=firstRow.getByRole('checkbox',{name:'Whichever is greater'});
    const sidedness=firstRow.getByRole('group',{name:'Tolerance sidedness'});
    const gb=await greater.boundingBox(), sb=await sidedness.boundingBox();
    assert.ok(gb.x>sb.x+sb.width && Math.abs(gb.y+gb.height/2-sb.y-sb.height/2)<2);
    const toggle=firstRow.locator('.inline-tolerance-greater-toggle');
    const symmetry=firstRow.getByRole('group',{name:'Tolerance symmetry'});
    await page.mouse.move(20,20);
    assert.equal(await toggle.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
    await toggle.hover();
    const hoverStyle=await toggle.evaluate(el=>{const s=getComputedStyle(el);return [s.backgroundColor,s.borderTopColor]});
    await firstRow.getByRole('button',{name:'IV tolerance unit',exact:true}).hover();
    assert.deepEqual(hoverStyle,await firstRow.getByRole('button',{name:'IV tolerance unit',exact:true}).evaluate(el=>{const s=getComputedStyle(el);return [s.backgroundColor,s.borderTopColor]}));
    await page.mouse.move(20,20);
    await page.screenshot({path:path.join(output,'green-checkbox-unchecked.png')});
    await greater.check();
    assert.equal(await greater.isChecked(),true);
    await greater.evaluate(el=>el.blur());
    await page.mouse.move(20,20);
    assert.equal(await toggle.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
    const toleranceUnit=firstRow.getByRole('button',{name:'Tolerance unit base unit',exact:true});
    assert.equal(await toleranceUnit.locator('span').textContent(),'lbf·in');
    assert.ok(await toleranceUnit.locator('span').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.screenshot({path:path.join(output,'tolerance-controls.png')});
    await page.keyboard.press('Escape');
    console.log('PASS: full compound units remain visible and the styled checkbox aligns beside SS/DS');
    const scalingButton=page.getByLabel('UI Settings',{exact:true});
    const toolStyle=el=>{const s=getComputedStyle(el);return [s.width,s.height,s.color,s.fontSize]};
    assert.deepEqual(await scalingButton.evaluate(toolStyle),await page.getByRole('button',{name:'Instrument builder',exact:true}).evaluate(toolStyle));
    assert.equal(await scalingButton.locator('.ui-scaling-icon').count(),1);
    await page.getByLabel('UI Settings',{exact:true}).click();
    assert.equal(await page.getByRole('radio',{name:'Whole app',exact:true}).getAttribute('aria-checked'),'true');
    await page.mouse.move(1000,400);await page.keyboard.down('Control');await page.mouse.wheel(0,-100);await page.keyboard.up('Control');
    await page.waitForFunction(()=>document.documentElement.style.zoom==='1.1');
    await page.getByRole('button',{name:'Reset to 100%'}).click();
    await page.waitForFunction(()=>document.documentElement.style.zoom==='1');
    await page.getByLabel('UI Settings',{exact:true}).click();
    console.log('PASS: scale lock zooms the whole page over a table and reset restores 100%');
    const resetPanel=await panel.boundingBox();
    const resetTable=await table.boundingBox();
    assert.ok(Math.abs(resetPanel.width-resetTable.width-2)<2,'Reset must restore a filled panel');
    assert.equal(await page.getByPlaceholder('Add Measurement Area',{exact:true}).count(),3);
    const pointUnit=rows.first().locator('.point-unit-control');
    await page.mouse.move(20,20);
    assert.equal(await pointUnit.locator('.point-unit-chevron').evaluate(el=>getComputedStyle(el).opacity),'0');
    assert.equal(await pointUnit.locator('select').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
    await pointUnit.hover();
    assert.equal(await pointUnit.locator('.point-unit-chevron').evaluate(el=>getComputedStyle(el).opacity),'1');
    await rows.first().click();
    await page.locator('[data-tour="tab-budget"]').click();
    for (const kind of ['UUT', 'TMDE']) {
      const entry=page.getByRole('textbox',{name:`New ${kind} measurement area name`});
      assert.equal(await entry.count(),0);
      const toggle=page.getByRole('button',{name:`Show all ${kind} measurement areas`,exact:true});
      await toggle.scrollIntoViewIfNeeded();
      const header=toggle.locator('xpath=ancestor::div[contains(@class,"instrument-panel-card-header")]');
      const before=await toggle.boundingBox();
      const headerBox=await header.boundingBox();
      assert.ok(headerBox.x+headerBox.width-before.x-before.width<25,'Visibility icon should sit at the right edge');
      assert.ok(before.y-headerBox.y<20,'Visibility icon should sit at the top');
      await toggle.click();
      await entry.waitFor();
      const activeToggle=page.getByRole('button',{name:`Show this ${kind} measurement area`,exact:true});
      const after=await activeToggle.boundingBox();
      assert.ok(Math.abs(after.x-before.x)<2 && Math.abs(after.y-before.y)<2,'Showing the entry should not move the eyeball');
      await activeToggle.click();
      assert.equal(await entry.count(),0);
    }
    console.log('PASS: budget area entry follows each visibility toggle and icons stay at the top right');
    const equation=page.getByRole('textbox',{name:'Measurement equation',exact:true});
    await equation.waitFor();
    assert.equal(await page.locator('.measurement-equation-preview-trigger').count(),0);
    assert.equal(await page.locator('.measurement-equation-block > .equation-workflow-notice').count(),0);
    const font=el=>{const s=getComputedStyle(el);return [s.fontSize,s.fontFamily,s.fontWeight]};
    assert.deepEqual(await equation.evaluate(font),await page.getByPlaceholder('Add Measurement Area',{exact:true}).first().evaluate(font));
    await page.screenshot({path:path.join(output,'empty-equation.png')});
    await page.getByTitle('Insert a common metrology equation').click();
    await page.locator('.add-point-symbol-popover').waitFor();
    await page.locator('.detail-workspace-section-label').filter({hasText:'Measurement Equation'}).click();
    assert.equal(await page.locator('.add-point-symbol-popover').count(),0);
    await equation.pressSequentially('x + y');
    assert.equal(await equation.inputValue(),'x + y');
    await equation.press('Enter');
    await page.getByRole('button',{name:'Edit measurement equation',exact:true}).waitFor();
    console.log('PASS: area accents, hover-only point unit controls, area placeholders, and compact empty equation entry');
    const columnsButton=page.getByRole('button',{name:'Columns',exact:true});
    await columnsButton.click();
    const columnsMenu=page.getByRole('dialog',{name:'Visible measurement point columns',exact:true});
    await columnsMenu.waitFor();
    assert.equal(await columnsMenu.locator('header').count(),0);
    assert.equal(await columnsMenu.getByRole('button',{name:'Reset',exact:true}).count(),1);
    assert.equal(await columnsMenu.getByRole('button',{name:'Close columns menu',exact:true}).count(),0);
    await page.screenshot({path:path.join(output,'column-menu-and-scaling-icon.png')});
    await columnsButton.click();
    assert.equal(await columnsMenu.count(),0);
    await columnsButton.click();
    await page.mouse.click(1400,180);
    assert.equal(await columnsMenu.count(),0);
    console.log('PASS: matching toolbar scaling icon, untinted checkbox with shared hover styling, and header-free column menu dismissal');
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
