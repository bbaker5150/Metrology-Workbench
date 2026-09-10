// Actual workbench shell, module, CSS and dialogs with isolated in-memory data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9245");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "tasking-budget-edit-"));
app.setPath("userData", path.join(output, "profile"));
const source = `
import '/src/index.css';document.body.classList.add('uncertainty-active');import '/src/modules/uncertainty/App.css';
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import UncertaintyBudgetTable from '/src/modules/uncertainty/features/analysis/components/UncertaintyBudgetTable.jsx';
import {InlineToleranceCell,applyToleranceCaseChange,getSpecRows} from '/src/modules/uncertainty/features/analysis/components/UncertaintyPanel.jsx';
import {normalizeInlineManualComponent} from '/src/modules/uncertainty/features/analysis/utils/manualComponentUtils.js';
const nominal={name:'Voltage',value:10,unit:'V'};
function Demo(){const [component,setComponent]=useState({id:'manual',name:'',type:'B',isManual:true,isInlineManual:true,inlineDraft:true,originalInput:{inputMode:'tolerance',toleranceLimit:'',unit:'V',errorDistributionDivisor:'1.732'}});
window.savedComponent=()=>component;
return <main className="uncertainty-module" style={{padding:24,display:"block",fontFamily:"var(--main-font)",minHeight:"100vh",background:"var(--background-color)",color:"var(--text-color)"}}><button>Outside budget</button><UncertaintyBudgetTable measurementType="direct" referencePoint={nominal} onMoveComponent={()=>{}} components={[{id:'prop',name:'Taylor Series',isPropagationSummary:true,value_native:1,unit_native:'V'},{id:'res',name:'UUT Resolution',value_native:1,unit_native:'V'},component,{id:'linked',sourceTmdeId:'t1',isBudgetInstance:true,name:'M1 - Accuracy',type:'B',value_native:1,unit_native:'V',distribution:'Rectangular',distributionDivisor:'1.732'}]} budgetInstruments={[{id:'t1',description:'Mock DMM',model:'M1'}]} ToleranceEditorComponent={InlineToleranceCell} applyToleranceChange={applyToleranceCaseChange} formatToleranceSummary={getSpecRows} onComponentUpdate={(id,patch)=>setComponent(current=>normalizeInlineManualComponent({component:current,draft:patch.inlineManualDraft,referencePoint:nominal}))}/><div id="asymmetric"><InlineToleranceCell editable={false} tolerance={{floor:{high:'3',low:'0',unit:'V',symmetric:false,distribution:'1.732'}}}/></div></main>}
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
    const virtual = path.resolve("__tasking-budget-edit.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.resolve("node_modules/.vite-tasking-budget-edit"),
      optimizeDeps: { force: false },
      server: { host: "127.0.0.1", port: 4211, strictPort: false, open: false },
      plugins: [
        {
          name: "tasking-budget-edit",
          resolveId: (id) =>
            id === "/__tasking-budget-edit.jsx" ? virtual : undefined,
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__tasking-budget-edit") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__tasking-budget-edit.jsx"></script></body></html>',
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
        "/__tasking-budget-edit",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9245");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByLabel('Error source name',{exact:true}).fill('Thermal drift');
    assert.equal(await page.getByLabel('Error limit distribution',{exact:true}).count(),0);
    await page.getByLabel('Error source name',{exact:true}).press('Tab');
    const row=page.locator('.budget-inline-manual-row');
    await page.waitForFunction(()=>document.querySelector('.budget-inline-manual-row')?.classList.contains('is-editing-tolerance'));
    assert.equal(await page.getByLabel('Error source name',{exact:true}).count(),0);
    assert.equal(await row.locator('.budget-source-cell').evaluate(e=>getComputedStyle(e).textAlign),'center');
    const inputs=row.locator('.inline-tolerance-editor input');
    await inputs.first().fill('2');
    await inputs.first().press('Tab');
    await page.screenshot({path:path.join(output,'expanded-light.png')});
    await page.evaluate(()=>document.body.classList.add('dark-mode'));
    await page.waitForTimeout(500);
    await page.screenshot({path:path.join(output,'expanded-dark.png')});
    await page.evaluate(()=>document.body.classList.remove('dark-mode'));
    await page.waitForTimeout(500);
    await row.getByRole('button',{name:'Edit distribution',exact:true}).click();
    await page.getByLabel('Error limit distribution',{exact:true}).selectOption('1.960');
    await page.getByLabel('Error limit distribution',{exact:true}).press('Tab');
    await page.getByLabel('Uncertainty type',{exact:true}).waitFor();
    await page.getByLabel('Uncertainty type',{exact:true}).press('Shift+Tab');
    await page.getByLabel('Error limit distribution',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Outside budget'}).click();
    await page.waitForFunction(()=>window.savedComponent().name==='Thermal drift' && !window.savedComponent().inlineDraft);
    assert.equal(await page.getByText('Mock DMM - Tolerance',{exact:true}).count(),1);
    const positions=await page.locator('.budget-source-cell').evaluateAll(cells=>cells.map(cell=>{
      const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);let node;
      while(node=walker.nextNode()){if(node.textContent.trim() && !node.parentElement.closest('.budget-order-controls')){const range=document.createRange();range.selectNodeContents(node);return {text:node.textContent,x:range.getBoundingClientRect().x};}}
    }).filter(Boolean));
    assert.ok(positions.length>=4,JSON.stringify(positions));
    assert.ok(Math.max(...positions.map(p=>p.x))-Math.min(...positions.map(p=>p.x))<1,JSON.stringify(positions));
    console.log('PASS aligned source labels',JSON.stringify(positions));
    const saved=await page.evaluate(()=>window.savedComponent());
    assert.ok(JSON.stringify(saved.originalInput.tolerance).includes('2'),'Tolerance retained after column switch');
    const asymmetric=await page.locator('#asymmetric').innerText();
    assert.ok(!/[()]/.test(asymmetric),asymmetric);
    assert.equal(await page.locator('#asymmetric .stacked-tolerance-limits').count(),1);
    await page.screenshot({path:path.join(output,'light.png')});
    await page.evaluate(()=>document.body.classList.add('dark-mode'));
    await page.waitForTimeout(500);
    await page.screenshot({path:path.join(output,'dark.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS manual field expansion, keyboard navigation, blur persistence, source labels and stacked limits. Artifacts:',output);
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
