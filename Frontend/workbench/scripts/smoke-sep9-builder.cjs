// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9239");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "sep9-builder-"));
app.setPath("userData", path.join(output, "profile"));
const source = `
import '/src/index.css';
import React from 'react';import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router';import axios from 'axios';
import WorkbenchShell from '/src/app/WorkbenchShell.jsx';
import UncertaintyApp from '/src/modules/uncertainty/UncertaintyApp.jsx';
import {ThemeProvider} from '/src/shared/ThemeContext.jsx';
import {NotificationProvider} from '/src/shared/NotificationContext.jsx';
let session={id:902,name:'September builder',measurementAreaGroups:[],measurementAreas:[],uuts:[],tmdes:[],testPoints:[],uncReq:{uncertaintyConfidence:95,reliability:95,reqPFA:2,calInt:12}};
let savedInstruments=[];window.savedInstruments=()=>savedInstruments;
let issues=[];window.savedSession=()=>session;window.savedIssues=()=>issues;
axios.get=async url=>({data:String(url).includes('/sessions/')?[session]:String(url).includes('/uncertainty/bug_reports/')?[]:String(url).includes('/bug_reports/')?issues:[]});
axios.put=async(url,data)=>{if(String(url).includes('/sessions/'))session=structuredClone(data);return {data};};
axios.post=async(url,data)=>{if(String(url).includes('/instruments/'))savedInstruments.push(structuredClone(data));if(String(url).includes('/bug_reports/')){if(window.failIssueSave){window.failIssueSave=false;throw Error('offline');}const saved={...data,id:issues.length+1,created_at:new Date().toISOString()};issues.push(saved);return {data:saved};}return {data};};
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
    const virtual = path.resolve("__sep9-builder.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.join(output, "vite"),
      server: { host: "127.0.0.1", port: 4205, strictPort: false, open: false },
      plugins: [
        {
          name: "sep9-builder",
          resolveId: (id) =>
            id === "/__sep9-builder.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__sep9-builder") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__sep9-builder.jsx"></script></body></html>',
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
        "/__sep9-builder",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9239");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("combobox", { name: "Analysis Session" }).waitFor();
    await page.getByText("Add your first Measurement Point",{exact:true}).waitFor();
    assert.equal(await page.getByText("Add a Measurement Area to get started.",{exact:true}).count(),2);
    await page.locator('[data-tour="tab-budget"]').click();
    await page.getByText("Select a Measurement Point.",{exact:true}).waitFor();
    await page.locator('[data-tour="tab-overview"]').click();
    const addArea=async(kind,name)=>{
      await page.locator(`[data-tour="${kind}-add-function"]`).click();
      await page.getByPlaceholder("New measurement area").fill(name);
      await page.getByPlaceholder("New measurement area").press("Enter");
    };
    await addArea('uut','Torque');await addArea('uut','Length');await addArea('tmde','Reference');
    assert.equal(await page.locator('.instrument-first-hint').count(),2);
    assert.equal(await page.locator('.function-header-collapse-btn').count(),0);
    await page.screenshot({path:path.join(output,'empty-areas.png')});
    await page.locator('[data-tour="uut-add-instrument"]').first().click();
    await page.waitForFunction(()=>document.querySelectorAll('.instrument-first-hint').length===1);
    await page.waitForFunction(()=>window.savedSession().instrumentOnboarding?.uut?.completed);
    await page.getByRole('button',{name:'Instrument builder',exact:true}).click();
    const search=page.getByRole('textbox',{name:'Search instruments'});
    await search.fill('Length');
    const geometry=await search.evaluate(e=>({padding:parseFloat(getComputedStyle(e).paddingLeft),left:e.getBoundingClientRect().left,iconRight:e.parentElement.querySelector('.search-icon').getBoundingClientRect().right}));
    assert.ok(geometry.left+geometry.padding>geometry.iconRight+4,'Search content clears magnifier');
    await page.screenshot({path:path.join(output,'builder-search.png')});
    await page.getByTitle('Create Instrument',{exact:true}).click();
    const identity=page.locator('.identity-grid input[type="text"]');
    await identity.nth(0).fill('Bench');await identity.nth(1).fill('Fixture');await identity.nth(2).fill('Torque tooling');
    await page.getByTitle('Add Function',{exact:true}).click();
    await page.getByLabel('Function name',{exact:true}).fill('Length');
    const row=page.locator('.builder-range-row').first();
    await row.locator('td').nth(0).getByRole('button',{name:'Not Set',exact:true}).click();
    await row.getByPlaceholder('min',{exact:true}).fill('0');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').getAttribute('placeholder'),'max');
    await page.keyboard.type('10');await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').getAttribute('aria-label'),'Range unit base unit');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').getAttribute('aria-label'),'Range unit prefix');
    await page.keyboard.press('Tab');
    await row.locator('.inline-tolerance-editor').waitFor();
    assert.ok(await row.locator('.inline-tolerance-editor input').first().evaluate(e=>e===document.activeElement),'Range Tab hands focus to tolerance');
    await page.keyboard.type('0.5');
    await row.locator('td').nth(3).getByRole('button',{name:'Set resolution',exact:true}).click();
    await row.locator('.inline-resolution-input').fill('0.01');
    assert.ok(await row.locator('.inline-resolution-editor').evaluate(e=>[...e.children].every(child=>child.getBoundingClientRect().right<=e.closest('td').getBoundingClientRect().right+1)),'Resolution controls stay in their cell');
    await page.screenshot({path:path.join(output,'builder-resolution.png')});
    await page.getByTitle('Add Function',{exact:true}).click();
    await page.getByTitle('Add Function',{exact:true}).click();
    assert.equal(await page.getByLabel('Function name',{exact:true}).count(),3);
    assert.deepEqual(await page.getByLabel('Function name',{exact:true}).evaluateAll(elements=>elements.map(e=>e.value)),['Length','New Function','New Function 2']);
    await page.getByLabel('Function name',{exact:true}).nth(1).fill('Weight');
    await page.getByLabel('Function name',{exact:true}).nth(2).fill('Torque');
    // Repeated add remains available without collapsing or losing blank rows.
    const add=page.getByRole('button',{name:'Add range to Length',exact:true});
    const box=await add.boundingBox();
    for(let i=0;i<6;i++)await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    assert.equal(await page.locator('.function-spec-section').first().locator('.builder-range-row').count(),7);
    await page.screenshot({path:path.join(output,'builder-functions.png')});
    // Last focused invalid range must be committed before checkmark validation.
    const last=page.locator('.function-spec-section').first().locator('.builder-range-row').last();
    await last.locator('td').first().getByRole('button',{name:'Not Set',exact:true}).click();
    await last.getByPlaceholder('min',{exact:true}).fill('bad');
    await page.getByRole('button',{name:'Save configuration',exact:true}).click();
    await page.getByRole('alertdialog',{name:'Complete required fields'}).waitFor();
    await page.screenshot({path:path.join(output,'builder-validation.png')});
    await page.getByRole('alertdialog',{name:'Complete required fields'}).getByRole('button',{name:'Close',exact:true}).last().click();
    await last.locator('td').first().getByRole('button').first().click();
    await last.getByPlaceholder('min',{exact:true}).fill('20');
    await page.keyboard.press('Tab');await page.keyboard.type('30');
    await page.getByRole('button',{name:'Save configuration',exact:true}).click();
    await page.waitForFunction(()=>window.savedInstruments().length===1);
    const saved=await page.evaluate(()=>window.savedInstruments()[0]);
    assert.equal(saved.functions.length,3);assert.equal(saved.functions[0].ranges.length,7);
    assert.equal(Number(saved.functions[0].ranges[0].max),10);
    assert.equal(Number(saved.functions[0].ranges[0].resolution),0.01);
    assert.equal(Number(saved.functions[0].ranges[0].tolerances.reading.high),0.5);
    assert.equal(Number(saved.functions[0].ranges[6].max),30);
    assert.ok(saved.functions[0].ranges.slice(1,6).every(range=>range.min===''&&range.max===''));
    await page.evaluate(()=>{document.body.classList.remove('light-mode');document.body.classList.add('dark-mode');});
    await page.getByRole('button',{name:'Instrument builder',exact:true}).click();
    await page.getByRole('textbox',{name:'Search instruments'}).waitFor();
    await page.screenshot({path:path.join(output,'builder-dark.png')});
    assert.deepEqual(errors, []);
    console.log(
      "PASS new task UI: empty budget and tables, per-table hints, search spacing, builder Tab and click-away, repeated function/range additions, save validation. Artifacts:",
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
