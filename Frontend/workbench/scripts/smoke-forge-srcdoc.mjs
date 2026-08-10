import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import http from 'node:http';

// ---------------------------------------------------------------------------
// Simulates how Forge hosts an app, to prove the single-file build survives it.
// ---------------------------------------------------------------------------
// Forge injects the app's HTML into an `<iframe srcdoc>` on a SharePoint page.
// That container has two properties the ordinary build cannot cope with:
//
//   1. The frame has no URL of its own — location.pathname is "srcdoc" — so
//      every relative asset request fails, and the /sites/<name> path trick
//      for discovering the web is unavailable.
//   2. It does inherit the parent page's origin, so same-origin requests to
//      /_api/ carry cookies and the parent's _spPageContextInfo is readable.
//
// This drives both: the app must boot with zero subresource requests, and it
// must find the SharePoint web by reading the parent frame.

const PORT = 4190;
const WEB = `http://127.0.0.1:${PORT}/sites/ISEA`;
const appHtml = readFileSync(new URL('../build-singlefile/uncertainty-budget.html', import.meta.url), 'utf8');

// Host page: a stand-in for the SharePoint page Forge renders into, complete
// with the _spPageContextInfo SharePoint puts on every page.
const hostPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>Forge host</title></head>
<body style="margin:0">
  <script>
    window._spPageContextInfo = { webAbsoluteUrl: ${JSON.stringify(WEB)} };
  </script>
  <iframe id="app" style="width:100%;height:900px;border:0"></iframe>
  <script>
    // Forge assigns the app HTML as srcdoc, exactly as the console log showed.
    document.getElementById('app').srcdoc = window.__APP_HTML__;
  </script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/sites/ISEA/pages/app.aspx')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(hostPage);
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();

const subresourceFailures = [];
const apiCalls = [];
const pageErrors = [];

page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('requestfailed', (r) => subresourceFailures.push(r.url()));
page.on('response', (r) => {
  const u = r.url();
  if (r.status() >= 400 && !u.includes('/_api/')) subresourceFailures.push(`${r.status()} ${u}`);
});

const lists = new Set();
await page.route('**/_api/**', async (route) => {
  const url = decodeURIComponent(new URL(route.request().url()).pathname + new URL(route.request().url()).search);
  apiCalls.push(url);
  const ok = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  if (url.includes('contextinfo')) return ok({ FormDigestValue: 'D', FormDigestTimeoutSeconds: 1800 });
  const probe = /getbytitle\('([^']+)'\)\?\$select=Id/.exec(url);
  if (probe) {
    return lists.has(probe[1])
      ? ok({ Id: 'g' })
      : route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  }
  if (/\/_api\/web\/lists$/.test(url)) {
    lists.add(JSON.parse(route.request().postData() || '{}').Title);
    return ok({ Id: 'g' });
  }
  if (/RootFolder/.test(url)) return ok({ ServerRelativeUrl: '/sites/ISEA/UncertaintySessions' });
  return ok({ value: [] });
});

// Inject the app HTML for the host page to assign as srcdoc.
await page.addInitScript((html) => {
  window.__APP_HTML__ = html;
}, appHtml);

await page.goto(`http://127.0.0.1:${PORT}/sites/ISEA/pages/app.aspx`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

const frame = page.frames().find((f) => f.url() === 'about:srcdoc');
const frameText = frame ? await frame.locator('body').innerText().catch(() => '') : '';

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
  ok ? pass++ : fail++;
};

check('app runs inside an about:srcdoc frame', frame ? (await frame.evaluate(() => location.href)) === 'about:srcdoc' : false);
check('zero failed subresource requests', subresourceFailures.length === 0,
  subresourceFailures.length ? `\n      ${subresourceFailures.slice(0, 4).join('\n      ')}` : '');
check('app rendered content', frameText.trim().length > 20, `(${frameText.trim().length} chars)`);
check('discovered the web URL from the parent frame', apiCalls.some((c) => c.startsWith('/sites/ISEA/_api/')),
  apiCalls.length ? `(first: ${apiCalls[0].slice(0, 60)})` : '(no api calls)');
check('storage gate detected the unprovisioned site', /not set up yet/i.test(frameText));

if (/not set up yet/i.test(frameText)) {
  await frame.getByRole('button', { name: /create them now/i }).click();
  await page.waitForTimeout(3500);
  check('provisioning created all four containers', lists.size === 4, `(${lists.size})`);
  const after = await frame.locator('body').innerText();
  check('app mounted after provisioning', !/not set up yet/i.test(after));
}

check('no uncaught errors', pageErrors.length === 0,
  pageErrors.length ? `\n      ${pageErrors.slice(0, 3).join('\n      ')}` : '');

console.log(`\n${fail === 0 ? 'FORGE SMOKE: ALL PASS' : `FORGE SMOKE: ${fail} FAILED`}  (${pass} passed)`);
await browser.close();
server.close();
process.exit(fail === 0 ? 0 : 1);
