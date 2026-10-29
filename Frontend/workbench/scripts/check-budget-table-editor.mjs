// Focused regression for the shared tabular editor in automatic and saved budget columns.
// Run from Frontend/workbench: node scripts/check-budget-table-editor.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';

const source = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '/src/index.css';
import '/src/modules/uncertainty/App.css';
import ResizableBudgetTable from '/src/modules/uncertainty/features/analysis/components/ResizableBudgetTable.jsx';
import DynamicBudgetComponentRow from '/src/modules/uncertainty/features/analysis/components/DynamicBudgetComponentRow.jsx';
import {InlineToleranceCell} from '/src/modules/uncertainty/features/analysis/components/UncertaintyPanel.jsx';
import {createDynamicDefinition, createDynamicComponent} from '/src/modules/uncertainty/utils/dynamicBudgetComponents.js';
const point={value:10,unit:'A'};
const columns=[{key:'source',label:'Source'},{key:'limit',label:'Error Limit'},{key:'distribution',label:'Distribution'},{key:'type',label:'Type'},{key:'standard',label:'Standard Uncertainty'},{key:'actions',label:'Actions'}];
localStorage.removeItem('uncertalytics:budget-column-widths:v1:check');
if(new URLSearchParams(location.search).has('fixed')) localStorage.setItem('uncertalytics:budget-column-widths:v1:check',JSON.stringify({source:160,limit:90,distribution:130,type:40,standard:140,actions:36}));
function Fixture(){
 const [definition,setDefinition]=useState(()=>({...createDynamicDefinition('table',point), name:'Variability',distribution:'1.732'}));
 const [autoEdit,setAutoEdit]=useState(false);
 const create=kind=>{setAutoEdit(true);setDefinition({...createDynamicDefinition(kind,point),name:'New component',distribution:'1.732'});};
 window.savedTableDefinition=definition;
 const component=createDynamicComponent(definition);
 component.id='fixture-component';
 return <div className="uncertainty-module" style={{padding:20,fontFamily:'Arial'}}><button id="outside">Outside</button><button id="new-table" onClick={()=>create('table')}>New table</button><button id="new-equation" onClick={()=>create('equation')}>New equation</button><h3>Budget</h3><div className="budget-section-table-wrap" style={{width:650}}><ResizableBudgetTable scope="check" columns={columns}><tbody><DynamicBudgetComponentRow key={definition.id} autoEdit={autoEdit} component={component} referencePoint={point} ToleranceEditorComponent={InlineToleranceCell} onKindChange={create} onCommit={setDefinition}/></tbody></ResizableBudgetTable></div></div>
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const virtual = path.resolve('__table-editor-check.jsx').replaceAll('\\', '/');
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, open: false },
  plugins: [{
    name: 'table-editor-check',
    resolveId: id => id === '/__table-editor-check.jsx' ? virtual : undefined,
    load: id => id === virtual ? source : undefined,
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/__table-editor-check?')) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<html><body class="light-mode"><div id="root"></div><script type="module" src="/__table-editor-check.jsx"></script></body></html>'));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const fixed of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__table-editor-check?${fixed ? 'fixed' : ''}`);
    const budget = page.locator('.budget-section-table-wrap');
    const table = budget.locator('table').first();
    const savedWidths = () => page.evaluate(() => localStorage.getItem('uncertalytics:budget-column-widths:v1:check'));
    const authored = await savedWidths();
    const open = () => budget.locator('.dynamic-tolerance-cell > .inline-tolerance-readview > button').click();
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const checkLayout = async () => {
      await settle();
      const width = await table.evaluate(el => el.offsetWidth);
      assert.ok(width < 1800, `Budget must stay compact, got ${width}px`);
      await page.waitForTimeout(200);
      assert.equal(await table.evaluate(el => el.offsetWidth), width, 'Observer passes must not grow the table');
      const cells = await budget.locator('.dynamic-lookup-table th:not(:last-child)').evaluateAll(nodes => nodes.map(cell => {
        const heading = cell.querySelector('.dynamic-column-heading');
        return { cell: cell.clientWidth, content: heading.scrollWidth };
      }));
      assert.ok(cells.length >= 2 && cells.every(cell => cell.cell >= cell.content), `Every heading and unit control must fit its column: ${JSON.stringify(cells)}`);
      const scroll = await budget.locator('.dynamic-table-scroll').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
      assert.ok(scroll.scroll <= scroll.client + 2, 'Lookup controls must not be clipped by an inner scrollbar');
    };
    const checkVisible = async () => {
      await page.waitForFunction(() => {
        const viewport = document.querySelector('.budget-section-table-wrap');
        const editor = viewport.querySelector('.inline-tolerance-editor');
        if (!editor) return false;
        const v = viewport.getBoundingClientRect(), e = editor.getBoundingClientRect();
        return e.left >= v.left - 1 && e.right <= v.right - 30;
      });
    };
    const checkScrollbar = async () => {
      const width = await table.evaluate(el => el.offsetWidth);
      // Native scrollbar events target the scroll container itself. Include
      // focusin as well: focus movement used to dismiss the outer row.
      await budget.dispatchEvent('pointerdown', { button: 0 });
      await budget.dispatchEvent('focusin');
      await budget.dispatchEvent('pointerup', { button: 0 });
      await budget.dispatchEvent('click', { button: 0 });
      await budget.evaluate(el => { el.scrollLeft += 25; });
      await page.waitForTimeout(100);
      assert.equal(await budget.locator('.inline-tolerance-editor').count(), 1, 'Scrollbar interaction must preserve the editor');
      assert.equal(await table.evaluate(el => el.offsetWidth), width, 'Scrollbar interaction must preserve the expanded column');
    };
    await open();
    await checkLayout();
    await checkVisible();
    await budget.getByLabel('Uncertainty row 1', { exact: true }).fill('0.012');
    await checkScrollbar();
    assert.equal(await budget.getByLabel('Uncertainty row 1', { exact: true }).inputValue(), '0.012');
    await budget.getByRole('button', { name: 'Edit point unit', exact: true }).click();
    await checkLayout();
    await budget.getByLabel('Uncertainty row 1', { exact: true }).click();
    await budget.getByTitle('Asymmetric tolerance', { exact: true }).click();
    await checkLayout();
    await budget.getByLabel('Low row 1', { exact: true }).fill('-0.01');
    await budget.getByLabel('High row 1', { exact: true }).fill('0.02');
    await budget.getByRole('button', { name: 'Add table row after row 1', exact: true }).click();
    await budget.getByLabel('Measurement point row 2', { exact: true }).fill('20');
    await budget.getByLabel('Low row 2', { exact: true }).fill('-0.03');
    await budget.getByLabel('High row 2', { exact: true }).fill('0.04');
    await checkLayout();
    // Higher scoped zoom and the dark theme must use the same layout widths.
    await page.evaluate(() => { document.body.className = 'dark-mode'; document.querySelector('.budget-section-table-wrap > table').style.zoom = '1.25'; });
    await checkLayout();
    await page.locator('#outside').click();
    await budget.locator('.inline-tolerance-editor').waitFor({ state: 'detached' });
    await settle();
    assert.equal(await savedWidths(), authored, 'Temporary editor expansion must preserve saved column widths');
    if (fixed) assert.equal(await table.locator(':scope > colgroup > col').nth(1).evaluate(el => el.style.width), '90px');
    const saved = await page.evaluate(() => window.savedTableDefinition);
    assert.equal(saved.rows.length, 2);
    assert.equal(saved.rows[1].values[saved.columns[0].id].high, '0.04');
    await open();
    assert.equal(await budget.getByLabel('High row 2', { exact: true }).inputValue(), '0.04');
    await checkLayout();
    await budget.getByRole('button', { name: 'Resize Error Limit column', exact: true }).dblclick();
    // Header clicks commit the shared editor. Fitting must remain bounded,
    // and reopening must still show the complete grid and saved values.
    await budget.locator('.inline-tolerance-editor').waitFor({ state: 'detached' });
    assert.ok(await table.evaluate(el => el.offsetWidth) < 1800);
    await open();
    assert.equal(await budget.getByLabel('High row 2', { exact: true }).inputValue(), '0.04');
    await checkLayout();
    await budget.getByRole('button', { name: 'Delete table row 2', exact: true }).click();
    await page.locator('#outside').click();
    await budget.locator('.inline-tolerance-editor').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.savedTableDefinition.rows.length), 1);
    // Newly created and switched editors must be brought fully into view,
    // including at scoped zoom, without the user moving the scrollbar.
    await page.locator('#new-table').click();
    await checkVisible();
    await checkScrollbar();
    await budget.getByRole('button', { name: 'Change uncertainty type', exact: true }).click();
    await budget.getByRole('button', { name: 'Equation', exact: true }).click();
    await budget.getByLabel('Uncertainty equation', { exact: true }).waitFor();
    await checkVisible();
    await checkScrollbar();
    await page.locator('#new-equation').click();
    await checkVisible();
    await budget.getByRole('button', { name: 'Change uncertainty type', exact: true }).click();
    await budget.getByRole('button', { name: 'Table', exact: true }).click();
    await checkVisible();
    await checkLayout();
    assert.deepEqual(errors, []);
    console.log(`PASS: ${fixed ? 'saved narrow' : 'automatic'} columns; editing, units, symmetry, rows, zoom, persistence, fit, scrollbar, new/switch editor visibility`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
