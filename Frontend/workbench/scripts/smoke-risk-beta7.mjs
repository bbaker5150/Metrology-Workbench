import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const output = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-beta7-browser-'));
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, open: false },
  plugins: [{ name: 'risk-beta7-preview', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (req.url !== '/__risk-beta7') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await vite.transformIndexHtml(req.url,
        '<!doctype html><html><head><meta charset="utf-8"></head><body class="uncertainty-active light-mode"><div id="root"></div><script type="module" src="/scripts/risk-beta7-preview.jsx"></script></body></html>'));
    });
  } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__risk-beta7`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.riskPreviewReady === true, null, { timeout: 60000 });
  const cases = [];
  const metrics = ['inputs','tur','tar','pfa','pfr','observedreop','maxreop','truereop',
    'gbinputs','gblow','gbhigh','gbmult','gbpfa','gbpfr','gbcalint','gbmeasrel','nogbpfa','nogbpfr','calint','measrel'];
  for (const shape of ['symmetric','asymmetric','lower','upper']) {
    for (const metric of metrics) {
      if ((shape === 'lower' && metric === 'gbhigh') || (shape === 'upper' && metric === 'gblow')) continue;
      cases.push([`${shape}/E1/centered/tur1-ref4/res0.01`, metric]);
    }
    for (const model of ['E2','D','W1','W2'])
      for (const metric of ['calint','gbcalint']) cases.push([`${shape}/${model}/centered/tur1-ref4/res0.01`, metric]);
  }
  for (const shape of ['lowerUnknown','upperUnknown'])
    cases.push([`${shape}/resolution`, 'pfa'], [`${shape}/resolution`, shape === 'lowerUnknown' ? 'gblow' : 'gbhigh']);
  cases.push(['symmetric/assumed-0.99','pfa'], ['lower/target-0.5','gbcalint'], ['physical/asymmetric-voltage','gblow'], ['physical/pressure','gbcalint']);
  for (const [id, metric] of cases) {
    await page.evaluate(([id, metric]) => window.renderRiskCase(id, metric), [id, metric]);
    await page.locator(`[data-case="${id}/${metric}"]`).waitFor({ state: "attached" });
    const body = page.locator('[data-testid="risk8-breakdown"]');
    await body.waitFor();
    // Allow React's math-rendering effect to finish before checking KaTeX.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const text = await body.innerText();
    assert(!/Risk 8|engine status|mitigation status|REOP-only status/i.test(text), `${id}/${metric}: implementation wording`);
    assert(!/NaN|undefined/.test(text), `${id}/${metric}: invalid display value`);
    if (!['symmetric/assumed-0.99', 'lower/target-0.5'].includes(id)) assert(await body.locator('.katex').count() > 0, `${id}/${metric}: equations not rendered`);
    assert.equal(await body.locator('.katex-error').count(), 0, `${id}/${metric}: invalid equation`);
    if (metric === 'gbcalint' && ['lower','upper'].some(shape => id.startsWith(`${shape}/E1/`)))
      assert(text.includes('2R − 1'), 'Missing single-sided reliability floor');
    if (id === 'symmetric/assumed-0.99') assert(text.includes('reference TUR can support'));
    if (id === 'lower/target-0.5') assert(text.includes('must exceed 50%'));
    if (id.startsWith('physical/')) await page.screenshot({ path: path.join(output, `${id.split('/')[1]}.png`) });
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: cases.length, cases, errors }, null, 2));
  console.log(JSON.stringify({ passed: cases.length, output }));
} finally {
  await browser?.close();
  await server.close();
}
