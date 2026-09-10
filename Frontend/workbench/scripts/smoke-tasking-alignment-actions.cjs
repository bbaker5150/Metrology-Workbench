// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9246");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "tasking-alignment-actions-"));
app.setPath("userData", path.join(output, "profile"));
const source = `
import '/src/index.css';import '/src/modules/ac-shunt/App.css';import '/src/modules/uncertainty/App.css';
import React from 'react';import {createRoot} from 'react-dom/client';import axios from 'axios';
import {SidebarPointItem} from '/src/modules/uncertainty/App.jsx';
import Calibration from '/src/modules/ac-shunt/components/calibration/Calibration.jsx';
import {ThemeProvider} from '/src/shared/ThemeContext.jsx';
axios.get=async()=>({data:{}});
const point={key:'p',current:1,frequency:1000,forward:{id:1,settings:{},results:{}},reverse:{id:2,settings:{},results:{}}};
const diagnostics=[[],[{category:'warning',message:'Check tolerance'}],[{category:'input',message:'Enter nominal'},{category:'info',message:'One-sided'}]];
function Demo(){return <ThemeProvider><div className="uncertainty-module" style={{display:'block','--point-diagnostics-width':'33px',padding:24}}>{diagnostics.map((items,i)=><SidebarPointItem key={i} point={{id:String(i),testPointInfo:{parameter:{value:i===2?123456789:5,unit:'V'}}}} diagnostics={items} visibleColumns={{value:true}} onSave={()=>{}} onSelect={()=>{}}/>)}</div><Calibration orderedTestPoints={[point]} sharedFocusedTestPoint={point} sharedSelectedTPs={new Set()} activeDirection="Forward" showNotification={()=>{}} onDataUpdate={()=>{}} setSharedFocusedTestPoint={()=>{}}/></ThemeProvider>}
createRoot(document.getElementById('root')).render(<Demo/>);
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
    const virtual = path.resolve("__tasking-alignment-actions.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.resolve("node_modules/.vite-tasking-alignment-actions"),
      optimizeDeps: { force: false },
      server: { host: "127.0.0.1", port: 4212, strictPort: false, open: false },
      plugins: [
        {
          name: "tasking-alignment-actions",
          resolveId: (id) =>
            id === "/__tasking-alignment-actions.jsx" ? virtual : undefined,
          load: (id) => {
            if (id.replaceAll("\\", "/").endsWith("/ac-shunt/contexts/InstrumentContext.jsx")) return `export const useInstruments=()=>({selectedSessionId:1,stdReaderModel:'5790A',tiReaderModel:'8508A',liveReadings:[],tiLiveReadings:[],initialLiveReadings:[],discoveredInstruments:[],collectionProgress:{},activeCollectionDetails:{},stabilizationStatus:'',slidingWindowStatus:{},timerState:{},setFailedTPKeys:()=>{}});`;
            return id === virtual ? source : undefined;
          },
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__tasking-alignment-actions") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__tasking-alignment-actions.jsx"></script></body></html>',
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
        "/__tasking-alignment-actions",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9246");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole('button',{name:'Save settings for this point',exact:true}).waitFor();
    const positions=await page.locator('.point-value-number').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().x));
    assert.equal(positions.length,3);assert.ok(Math.max(...positions)-Math.min(...positions)<1,JSON.stringify(positions));
    const gutters=await page.locator('.point-diagnostics').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));
    assert.deepEqual(gutters,[33,33,33]);
    const general=page.locator('.settings-form-group').filter({has:page.getByText('General',{exact:true})});
    const actions=general.locator('.general-settings-actions');
    assert.equal(await actions.locator('button').count(),3);
    const geometry=await general.evaluate(e=>{const b=e.getBoundingClientRect(),a=e.querySelector('.general-settings-actions').getBoundingClientRect();return {bottom:b.bottom-a.bottom,right:b.right-a.right};});
    assert.ok(Math.abs(geometry.bottom)<2 && Math.abs(geometry.right)<2,JSON.stringify(geometry));
    const buttons=page.locator('.reader-profile-point-save');
    const borders=await buttons.evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).borderTopWidth));
    assert.ok(borders.every(width=>width==='0px'),JSON.stringify(borders));
    const saveIcon=await page.getByRole('button',{name:'Save settings for this point',exact:true}).locator('svg').innerHTML();
    assert.equal(await page.getByRole('button',{name:'Save 5790 settings for this test point',exact:true}).locator('svg').innerHTML(),saveIcon);
    await page.screenshot({path:path.join(output,'light.png')});
    await page.evaluate(()=>document.body.classList.add('dark-mode'));await page.waitForTimeout(500);
    await page.screenshot({path:path.join(output,'dark.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS aligned indicators and values, General action placement and uniform borderless save icons. Artifacts:',output);
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
