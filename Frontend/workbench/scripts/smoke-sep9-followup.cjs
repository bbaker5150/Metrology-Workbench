// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9238");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "sep9-followup-"));
app.setPath("userData", path.join(output, "profile"));
const source = `
import '/src/index.css';
import React from 'react';import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router';import axios from 'axios';
import WorkbenchShell from '/src/app/WorkbenchShell.jsx';
import UncertaintyApp from '/src/modules/uncertainty/UncertaintyApp.jsx';
import {ThemeProvider} from '/src/shared/ThemeContext.jsx';
import {NotificationProvider} from '/src/shared/NotificationContext.jsx';
const range={id:'range1',min:0,max:100,unit:'um',tolerances:{reading:{high:1,low:-1,unit:'%',distribution:'1.732',symmetric:true}}};
const uut={id:'u1',description:'Micrometer',measurementArea:'Length',measurementAreaId:'length',instrument:{id:'def1',manufacturer:'Bench',model:'M1',description:'Micrometer',functions:[{id:'length-fn',name:'Length',unit:'um',ranges:[range]}]}};
let session={id:902,name:'September follow-up',measurementAreas:[{id:'length',name:'Length',color:'#4c9ada'}],uuts:[uut],tmdes:[{...uut,id:'t1',name:'Length reference',description:'Length reference'}],testPoints:Array.from({length:45},(_,i)=>({id:'p'+i,measurementAreaId:'length',associatedUutIds:['u1'],activeUutId:'u1',measurementType:'direct',testPointInfo:{parameter:{name:'Length',value:i?String(i):'',unit:'um'}},uutTolerance:{...range,functionId:'length-fn',functionName:'Length',rangeId:'range1'},tmdeTolerances:[],components:[],specifications:{}})),uncReq:{uncertaintyConfidence:95,reliability:95,reqPFA:2,calInt:12}};
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
    const virtual = path.resolve("__sep9-followup.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.join(output, "vite"),
      server: { host: "127.0.0.1", port: 4204, strictPort: false, open: false },
      plugins: [
        {
          name: "sep9-followup",
          resolveId: (id) =>
            id === "/__sep9-followup.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__sep9-followup") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__sep9-followup.jsx"></script></body></html>',
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
        "/__sep9-followup",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9238");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("combobox", { name: "Analysis Session" }).waitFor();
    await page.locator(".point-grid-item").first().waitFor();
    const chip = page.locator(".function-header-unit-chip").first();
    assert.equal((await chip.textContent()).trim(), "µm");
    assert.equal(
      await chip.evaluate((e) => getComputedStyle(e).textTransform),
      "none",
    );
    const table = page.locator(".measurement-points-table");
    const scrollSize = await table.evaluate((e) => ({
      scroll: e.scrollHeight,
      client: e.clientHeight,
      height: e.getBoundingClientRect().height,
      content: e.firstElementChild.getBoundingClientRect().height,
      overflow: getComputedStyle(e).overflowY,
    }));
    console.log("Point table geometry:", scrollSize);
    assert.ok(
      scrollSize.scroll <= scrollSize.client + 1,
      "Point table does not create a second vertical scroll region",
    );
    assert.equal(await table.locator(".point-grid-item").count(), 45);
    await page.locator(".point-grid-item").first().click();
    await page.locator('[data-tour="tab-budget"]').click();
    await page
      .getByRole("button", { name: "Add component to budget", exact: true })
      .first()
      .click();
    await page
      .locator('[data-tour="budget-component-menu"]')
      .getByRole("button", { name: /0 to 100/ })
      .click();
    await page.keyboard.press("Escape");
    await page.locator(".budget-pending-uncertainty").first().waitFor();
    assert.ok(
      (await page.locator(".budget-pending-uncertainty").count()) >= 3,
      "Component, combined, and expanded uncertainty each explain the missing value",
    );
    await page
      .locator(".uncertainty-budget-table")
      .first()
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "blank-budget.png") });
    await page
      .locator(".point-grid-item")
      .first()
      .locator(".point-value-number")
      .click();
    await page.locator(".sidebar-inline-input.value").fill("5");
    await page.locator(".sidebar-inline-input.value").press("Enter");
    await page
      .locator(".budget-pending-uncertainty")
      .first()
      .waitFor({ state: "hidden" });
    assert.equal(
      await page.locator(".uncertainty-budget-table tbody tr").count(),
      1,
      "The same source resolves when the value is supplied",
    );
    await page.getByRole("button", { name: "Workbench issue tracker" }).click();
    const dialog = page.getByRole("dialog", { name: "Issues & feedback" });
    await dialog.waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Report an issue", exact: true })
        .count(),
      1,
      "Only the global tracker entry is shown",
    );
    assert.equal(
      await dialog.getByLabel("Module", { exact: true }).inputValue(),
      "Uncertalytics",
    );
    const beforeDelete = await page.evaluate(() =>
      JSON.stringify(window.savedSession()),
    );
    await dialog
      .getByRole("button", { name: "Report an issue", exact: true })
      .focus();
    await page.keyboard.press("Delete");
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.savedSession())),
      beforeDelete,
      "Tracker keyboard cannot mutate the background session",
    );
    await dialog
      .getByLabel("Title", { exact: true })
      .fill("Range selection report");
    await dialog
      .getByLabel("Description", { exact: true })
      .fill("Selection did not remain highlighted after a range change.");
    await page.evaluate(() => (window.failIssueSave = true));
    await dialog
      .getByRole("button", { name: "Submit issue", exact: true })
      .click();
    await dialog.getByText(/Could not save this issue/).waitFor();
    assert.equal(
      await dialog.getByLabel("Title", { exact: true }).inputValue(),
      "Range selection report",
    );
    await dialog
      .getByRole("button", { name: "Submit issue", exact: true })
      .click();
    await dialog.getByText("Issue submitted.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.savedIssues().length), 1);
    await page.screenshot({ path: path.join(output, "issues-light.png") });
    await page.evaluate(() => {
      document.body.classList.remove("light-mode");
      document.body.classList.add("dark-mode");
    });
    await page.screenshot({ path: path.join(output, "issues-dark.png") });
    await page.setViewportSize({ width: 650, height: 700 });
    assert.ok(
      await dialog.evaluate(
        (e) =>
          e.getBoundingClientRect().right <= innerWidth &&
          e.getBoundingClientRect().bottom <= innerHeight,
      ),
      "Dialog fits small viewport",
    );
    await page.screenshot({ path: path.join(output, "issues-small.png") });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS follow-up UI: blank budget, SI unit labels, single vertical scroll, global issue save/retry and responsive dialog. Artifacts:",
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
