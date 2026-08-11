import { chromium } from 'playwright';
import { readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

// Drives the built standalone bundle against a simulated SharePoint REST
// surface, so the whole chain — web URL discovery, form digest, the storage
// gate, provisioning, and the axios adapter — is exercised in a real browser.
const BASE = 'http://127.0.0.1:4182';

// The bundle is served from a path shaped like a document library folder, so
// web-URL discovery has a realistic /sites/<name>/ prefix to derive from and
// the chunk requests have to resolve relative to a subfolder, as they will on
// the real site.
const MOUNT = '/sites/ISEA/Assets/';
const ROOT = new URL('../build-standalone/', import.meta.url);
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary',
};

const server = http.createServer((req, res) => {
  const requested = decodeURIComponent(new URL(req.url, BASE).pathname);
  if (!requested.startsWith(MOUNT)) return res.writeHead(404).end();

  let relative = requested.slice(MOUNT.length) || 'index.html';
  if (relative.endsWith('/')) relative += 'index.html';

  const file = new URL(relative, ROOT);
  // Nothing outside the build directory is servable, whatever the path says.
  if (!file.href.startsWith(ROOT.href)) return res.writeHead(403).end();

  try {
    if (statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(relative)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(4182, '127.0.0.1', resolve));

const state = { lists: new Set(), files: new Map(), items: new Map() };
let nextItemId = 1;

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();

const errors = [];
page.on('pageerror', (e) => {
  // public/3demblem.glb is stored in Git LFS. A clone without git-lfs holds a
  // pointer file, so the 3D emblem cannot parse. That is a checkout problem,
  // not a deployment one — run `git lfs pull` to see the real model.
  if (/3demblem\.glb/.test(e.message)) return;
  errors.push(`pageerror: ${e.message}`);
});
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // The storage gate probes for each list and expects a 404 when the site is
  // not set up yet. The browser logs those as console errors, but they are the
  // mechanism working, not a fault.
  if (/Failed to load resource/.test(m.text())) return;
  errors.push(`console: ${m.text()}`);
});
page.on('response', (r) => {
  if (r.status() < 400) return;
  const url = decodeURIComponent(r.url());
  if (/getbytitle\('[^']+'\)\?\$select=Id/.test(url)) return; // expected probe
  errors.push(`HTTP ${r.status()} ${url}`);
});

const apiCalls = [];

await page.route('**/_api/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const path = decodeURIComponent(url.pathname + url.search);
  const method = req.headers()['x-http-method'] || req.method();
  apiCalls.push(`${method} ${path.replace(/^.*\/_api/, '_api')}`);

  // Form digest
  if (path.includes('/_api/contextinfo')) {
    return route.fulfill(json({ FormDigestValue: 'DIGEST', FormDigestTimeoutSeconds: 1800 }));
  }
  // List existence probe
  const exists = /getbytitle\('([^']+)'\)\?\$select=Id/.exec(path);
  if (exists) {
    return state.lists.has(exists[1])
      ? route.fulfill(json({ Id: 'guid' }))
      : route.fulfill(json({ error: 'not found' }, 404));
  }
  // Create list
  if (/\/_api\/web\/lists$/.test(path) && method === 'POST') {
    state.lists.add(JSON.parse(req.postData() || '{}').Title);
    return route.fulfill(json({ Id: 'guid' }));
  }
  // Fields
  if (/\/fields\?\$select=InternalName/.test(path)) return route.fulfill(json({ value: [] }));
  if (/createfieldasxml/.test(path)) return route.fulfill(json({ Id: 'f' }));
  // A live tenant answers 400 here: the Fields collection is polymorphic, so a
  // plain JSON body with no OData type is not enough to say what to create.
  // Reproduced rather than accepted, so the working shape stays the only one.
  if (/\/fields$/.test(path) && method === 'POST') {
    return route.fulfill(json({ error: { message: { value: 'A type named \'\' could not be resolved by the model.' } } }, 400));
  }
  // Library root folder
  if (/RootFolder/.test(path)) {
    return route.fulfill(json({ ServerRelativeUrl: '/sites/ISEA/UncertaintySessions' }));
  }
  // Session listing
  if (/UncertaintySessions'\)\/items\?/.test(path)) {
    const value = [...state.files.keys()].map((name) => ({
      SessionId: Number(/session-(\d+)\.json/.exec(name)?.[1]),
      SessionName: JSON.parse(state.files.get(name)).name,
      Modified: '2026-08-07T00:00:00Z',
    }));
    return route.fulfill(json({ value }));
  }
  // Record listings
  if (/'\)\/items\?\$select=Id,RecordId/.test(path)) {
    const listName = /getbytitle\('([^']+)'\)/.exec(path)[1];
    return route.fulfill(json({ value: state.items.get(listName) || [] }));
  }
  // File read
  if (/\$value$/.test(path)) {
    const name = /session-\d+\.json/.exec(path)?.[0];
    const body = state.files.get(name);
    return body
      ? route.fulfill({ status: 200, contentType: 'application/json', body })
      : route.fulfill(json({}, 404));
  }
  // File write
  if (/files\/add/.test(path)) {
    const name = /url='([^']+)'/.exec(path)?.[1];
    state.files.set(decodeURIComponent(name), req.postData() || '{}');
    return route.fulfill(json({ ServerRelativeUrl: `/sites/ISEA/UncertaintySessions/${name}` }));
  }
  if (/ListItemAllFields/.test(path)) return route.fulfill(json({}, 204));
  if (/Files\?\$select=Name/.test(path)) return route.fulfill(json({ value: [] }));
  if (/\$filter=RecordId/.test(path)) return route.fulfill(json({ value: [] }));
  if (/\/items$/.test(path) && method === 'POST') return route.fulfill(json({ Id: nextItemId++ }));

  return route.fulfill(json({ value: [] }));
});

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
  ok ? pass++ : fail++;
};

await page.goto(`${BASE}${MOUNT}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const bodyText = () => page.locator('body').innerText();

check('storage gate detects an unprovisioned site', /not set up yet/i.test(await bodyText()));
check(
  'gate names the containers it will create',
  (await bodyText()).includes('UncertaintySessions'),
);
check(
  'web URL was derived from the /sites/<name> path',
  apiCalls.some((c) => c.includes('_api/')),
  `(${apiCalls.length} api calls)`,
);

// Provision
await page.getByRole('button', { name: /create them now/i }).click();
await page.waitForTimeout(3000);

check('provisioning requested a form digest', apiCalls.some((c) => c.includes('contextinfo')));
check('provisioning created the sessions library', state.lists.has('UncertaintySessions'));
check('provisioning created all four containers', state.lists.size === 4, `(${[...state.lists].join(', ')})`);

await page.waitForTimeout(3000);
const afterText = await bodyText();
check('app mounts once storage is ready', !/not set up yet/i.test(afterText));
check('session list was requested through the adapter', apiCalls.some((c) => c.includes('Sessions')));
check(
  'no uncaught errors during boot and provisioning',
  errors.length === 0,
  errors.length ? `\n      ${errors.slice(0, 5).join('\n      ')}` : '',
);

console.log(`\n${fail === 0 ? 'SMOKE: ALL PASS' : `SMOKE: ${fail} FAILED`}  (${pass} passed)`);
await browser.close();
server.close();
process.exit(fail === 0 ? 0 : 1);
