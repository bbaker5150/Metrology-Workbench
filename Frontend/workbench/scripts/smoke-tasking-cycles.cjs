// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9241");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "tasking-cycles-"));
app.setPath("userData", path.join(output, "profile"));
const source = `
import '/src/index.css';import '/src/modules/ac-shunt/App.css';
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import axios from 'axios';
import {ThemeProvider} from '/src/shared/ThemeContext.jsx';
import CycleStatisticsTracker from '/src/modules/ac-shunt/components/calibration/CycleStatisticsTracker.jsx';
import SettingsPresets from '/src/modules/ac-shunt/components/calibration/SettingsPresets.jsx';
const rows=Array.from({length:8},(_,i)=>({pair_num:i+1,fwd_cycle_num:i+1,rev_cycle_num:null,fwd_delta:i===7?100:1,rev_delta:null,paired_avg:i===7?100:1}));
function Demo(){const[mode,setMode]=useState('none');const[settings,setSettings]=useState({n_cycles:8,nplc:10});
axios.patch=async(url,data)=>{window.lastAnalyticsPatch=data;setMode(data.outlier_filter_mode||mode);return{data:{}}};
const direction={pair_rows:rows,auto_excluded_pairs:mode==='auto'?[8]:[],flagged_pairs:mode==='auto'?[8]:[],manual_excluded_pairs:[],pair_delta_uut_ppm:mode==='auto'?1:13.375,pair_type_a_uncertainty_ppm:mode==='auto'?0:12.375,n_pairs_used:mode==='auto'?7:8};
const pair={outlier_filter_mode:mode,pair_rows:rows.map(r=>({...r,paired_avg:null})),n_pairs_used:0,pair_delta_uut_ppm:null,directional:{forward:direction,reverse:{pair_rows:[],pair_delta_uut_ppm:null,n_pairs_used:0}}};
return <main className="ac-shunt-module" style={{padding:24}}><div className="settings-form-group settings-form-group--8508"><div className="reader-profile-point-actions">
<span className="reader-profile-point-save-control reader-setting-tooltip-trigger"><button className="reader-profile-point-save">Apply to all points</button></span>
<span className="reader-profile-point-save-control reader-setting-tooltip-trigger"><button className="reader-profile-point-save">Save to this point</button></span>
</div></div><SettingsPresets settings={settings} keys={['n_cycles','nplc']} onApply={setSettings}/><CycleStatisticsTracker focusedTestPoint={{forward:{id:1,results:{pair_analytics:pair,cycles:rows.map(r=>({cycle_index:r.pair_num,delta_uut_ppm:r.fwd_delta}))}}}} sessionId={1}/></main>}
createRoot(document.getElementById('root')).render(<ThemeProvider><Demo/></ThemeProvider>);
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
    const virtual = path.resolve("__tasking-cycles.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.resolve("node_modules/.vite-tasking-cycles"),
      optimizeDeps: { force: false },
      server: { host: "127.0.0.1", port: 4207, strictPort: false, open: false },
      plugins: [
        {
          name: "tasking-cycles",
          resolveId: (id) =>
            id === "/__tasking-cycles.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__tasking-cycles") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__tasking-cycles.jsx"></script></body></html>',
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
        "/__tasking-cycles",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9241");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    assert.equal(await page.getByRole('combobox',{name:'Statistics direction'}).count(),0);
    await page.getByRole('button',{name:'Cycle Statistics Options'}).click();
    await page.getByRole('combobox',{name:'Statistics direction'}).selectOption('forward');
    await page.getByText('13.3750 ppm',{exact:true}).waitFor();
    await page.locator('.cycle-stats-settings-check').first().click();
    await page.getByText('1.0000 ppm',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.lastAnalyticsPatch.outlier_filter_mode),'auto');
    await page.getByRole('button',{name:'Cycle Statistics Options'}).click();
    await page.getByText('Saved setups',{exact:true}).click();
    const setupName=page.getByRole('textbox',{name:'New setup name'});
    assert.ok((await setupName.boundingBox()).width<=230);
    await setupName.fill('Eight cycles');
    await page.getByRole('button',{name:'Save as new setup'}).click();
    await page.getByRole('button',{name:'Use as default'}).click();
    for(const dark of [false,true]){
      await page.evaluate(d=>document.body.classList.toggle('dark-mode',d),dark);
      await page.screenshot({path:path.join(output,dark?'cycles-dark.png':'cycles-light.png')});
    }
    await page.getByRole('button',{name:'Cycle Statistics Options'}).click();
    await page.getByRole('combobox',{name:'Statistics direction'}).selectOption('reverse');
    assert.equal(await page.getByText('1.0000 ppm',{exact:true}).count(),0);
    await page.getByRole('combobox',{name:'Statistics direction'}).selectOption('paired');
    assert.equal(await page.getByText('13.3750 ppm',{exact:true}).count(),0);
    const actionBoxes=await page.locator('.reader-profile-point-save').evaluateAll(es=>es.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,scroll:e.scrollWidth,client:e.clientWidth})));
    assert.equal(actionBoxes[0].y,actionBoxes[1].y);
    assert.ok(actionBoxes.every(b=>b.width>100 && b.scroll<=b.client+1),'Reader labels fit without truncation');
    assert.deepEqual(errors,[]);
    console.log('PASS forward-only chart, live filter, reverse/paired unavailable, saved setup. Artifacts:',output);
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
