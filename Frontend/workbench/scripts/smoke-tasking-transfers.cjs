// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9247");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "tasking-transfers-"));
app.setPath("userData", path.join(output, "profile"));
const source = `
import '/src/index.css';import '/src/modules/uncertainty/App.css';document.body.classList.add('uncertainty-active');
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import UncertaintyPanel from '/src/modules/uncertainty/features/analysis/components/UncertaintyPanel.jsx';
const item=(id,name,area)=>({id,name,description:name,measurementAreaNames:[area],instrument:{id:id+'-def',description:name,functions:[{name:'Voltage',unit:'V',ranges:[{id:id+'-r1',min:0,max:10,unit:'V',tolerances:{reading:{high:1,low:-1,unit:'%',symmetric:true,distribution:'1.732'}}},{id:id+'-r2',min:10,max:20,unit:'V',tolerances:{reading:{high:2,low:-2,unit:'%',symmetric:true,distribution:'1.732'}}}]}]}});
const initial={id:'transfer',name:'Transfer test',measurementAreaGroups:[{name:'Source',color:'#3498db'},{name:'Target',color:'#2ecc71'}],uuts:[item('u1','First UUT','Source'),item('u2','Second UUT','Source')],tmdes:[item('t1','First TMDE','Source'),item('t2','Target TMDE','Target')],testPoints:[],uncReq:{}};
function Demo(){const [session,setSession]=useState(initial),[selected,setSelected]=useState([]),[view,setView]=useState('session');window.savedSession=()=>session;window.resetSession=()=>{setSession(structuredClone(initial));setSelected([])};window.setView=setView;
return <main className="uncertainty-module" style={{display:'block',padding:24,fontFamily:'var(--main-font)'}}><UncertaintyPanel sessionData={session} onSessionSave={setSession} testPointData={{id:'point',viewMode:view,measurementType:'derived',testPointInfo:{measurementArea:'Source',parameter:{name:'Voltage',unit:'V'}},associatedUutIds:[],components:[],tmdeTolerances:[],specifications:{}}} currentUutSelection={selected} setCurrentUutSelection={setSelected} tmdeTolerancesData={[]} uutNominal={{value:5,unit:'V'}} onUpdateTestPoint={()=>{}} setNotification={()=>{}}/></main>}
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
    const virtual = path.resolve("__tasking-transfers.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.resolve("node_modules/.vite-tasking-transfers"),
      optimizeDeps: { force: false },
      server: { host: "127.0.0.1", port: 4213, strictPort: false, open: false },
      plugins: [
        {
          name: "tasking-transfers",
          resolveId: (id) =>
            id === "/__tasking-transfers.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__tasking-transfers") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__tasking-transfers.jsx"></script></body></html>',
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
      width: 1600,
      height: 1500,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    await win.loadURL(
      "http://127.0.0.1:" +
        server.httpServer.address().port +
        "/__tasking-transfers",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9247");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const drag = async (from,to) => {
      await from.scrollIntoViewIfNeeded();await to.scrollIntoViewIfNeeded();
      const a=await from.boundingBox(),b=await to.boundingBox();
      await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
      await page.mouse.move(a.x+a.width/2+10,a.y+a.height/2+10,{steps:3});
      await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:18});await page.mouse.up();
    };
    for(const view of ['session','point']) {
      await page.evaluate(view=>{window.resetSession();window.setView(view)},view);
      if(view==='point') {
        await page.getByRole('button',{name:'Show all UUT measurement areas'}).click();
        await page.getByRole('button',{name:'Show all TMDE measurement areas'}).click();
      }
      await page.getByRole('button',{name:'First UUT',exact:true}).waitFor();
      for(const name of ['First UUT','Second UUT','First TMDE']) await page.getByRole('button',{name,exact:true}).click({modifiers:['Control']});
      await page.keyboard.press('Control+x');
      await page.waitForFunction(()=>window.savedSession().uuts.length===0 && window.savedSession().tmdes.length===1);
      await page.getByRole('button',{name:'Target TMDE',exact:true}).click({modifiers:['Control']});
      await page.keyboard.press('Control+v');
      await page.waitForFunction(()=>window.savedSession().tmdes.length===4);
      assert.deepEqual(await page.evaluate(()=>window.savedSession().tmdes.filter(i=>i.id!=='t2').map(i=>i.measurementAreaNames)),[['Target'],['Target'],['Target']]);
      console.log('PASS mixed cut/paste',view);
      await page.evaluate(()=>window.resetSession());
      await page.keyboard.press("Escape");
      const tables=page.locator('.instrument-equipment-table');
      const target=tables.nth(1).locator('.instrument-area-section-row').filter({hasText:'Target'});
      for(const name of ['First UUT','First TMDE']) await page.getByRole('button',{name,exact:true}).click({modifiers:['Control']});
      await drag(page.locator('tr[data-range-group="uut:u1"]').nth(1).locator('.cell-tolerance'),target);
      await page.waitForFunction(()=>window.savedSession().uuts.length===1 && window.savedSession().tmdes.filter(i=>['u1','t1'].includes(i.id)).every(i=>i.measurementAreaNames[0]==='Target'));
      assert.equal(await page.evaluate(()=>window.savedSession().tmdes.length),3);
      console.log('PASS mixed drag',view);
      await page.evaluate(()=>window.resetSession());
      await page.keyboard.press("Escape");
      const tolerance=page.locator('tr[data-range-group="uut:u1"]').nth(1).locator('.cell-tolerance');
      await drag(tolerance,target);
      await page.waitForFunction(()=>window.savedSession().uuts.length===1 && window.savedSession().tmdes.some(i=>i.id==='u1' && i.measurementAreaNames[0]==='Target'));
      console.log('PASS tolerance drag UUT to TMDE',view);
      const source=tables.first().locator('.instrument-area-section-row').filter({hasText:'Source'});
      const range=page.locator('tr[data-range-group="tmde:u1"]').nth(1).locator('[data-range-cell]');
      await drag(range,source);
      await page.waitForFunction(()=>window.savedSession().uuts.length===2 && !window.savedSession().tmdes.some(i=>i.id==='u1'));
      console.log('PASS range drag TMDE to UUT',view);
      await page.screenshot({path:path.join(output,view+'.png')});
    }
    assert.deepEqual(errors,[]);
    console.log('PASS mixed instrument clipboard and bidirectional range/tolerance dragging in both views. Artifacts:',output);
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
