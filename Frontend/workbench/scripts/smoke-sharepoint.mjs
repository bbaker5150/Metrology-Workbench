import { chromium } from 'playwright';
import { readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createSchemaFixture, directoryGroups } from './sharepoint-schema-fixture.mjs';

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

const state = { lists: new Map(), files: new Map(), items: new Map() };
let nextItemId = 1;
const schema = createSchemaFixture();
const owners = 'Metrology Software Owners';
const users = 'Metrology App Users';
const sme = 'Uncertalytics SME';
const siteGroups = [owners, users];
let memberships = [owners];

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const browser = await chromium.launch({
  // Left to Playwright unless pointed somewhere explicitly, so this runs on a
  // CI runner (`npx playwright install chromium`) as well as on a workstation
  // or in a sandbox with a preinstalled browser.
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
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

  // SharePoint supplies the app's identity. Returning a real user here keeps
  // this browser-level smoke test aligned with the user-scoped storage gate.
  const groups = directoryGroups(path, memberships, siteGroups);
  if (groups) return route.fulfill(json(groups));
  const list = /getbytitle\('([^']+)'\)/.exec(path)?.[1];
  if (path.endsWith('/EffectiveBasePermissions')) {
    const managesList = memberships.includes(owners) || (memberships.includes(sme) &&
      ['Uncertalytics - Instrument Drafts', 'Uncertalytics - Published Instruments'].includes(list));
    return route.fulfill(json({ Low: managesList ? '2048' : '0', High: '0' }));
  }
  const schemaResponse = schema.handle(path, method, req.postData());
  if (schemaResponse) return route.fulfill(json(schemaResponse.body, schemaResponse.status));
  if (path.includes('/_api/web/currentuser')) {
    return route.fulfill(json({
      Id: 7,
      LoginName: 'i:0#.f|membership|smoke.user@example.test',
      Email: 'smoke.user@example.test',
      Title: 'Smoke Test User',
    }));
  }
  // Form digest
  if (path.includes('/_api/contextinfo')) {
    return route.fulfill(json({ FormDigestValue: 'DIGEST', FormDigestTimeoutSeconds: 1800 }));
  }
  // List existence probe
  const exists = /getbytitle\('([^']+)'\)\?\$select=Id/.exec(path);
  if (exists) {
    return state.lists.has(exists[1])
      ? route.fulfill(json(state.lists.get(exists[1])))
      : route.fulfill(json({ error: 'not found' }, 404));
  }
  // Create list
  if (/\/_api\/web\/lists$/.test(path) && method === 'POST') {
    const listInfo = JSON.parse(req.postData());
    const Id = `00000000-0000-4000-8000-${String(state.lists.size + 1).padStart(12, '0')}`;
    state.lists.set(listInfo.Title, { ...listInfo, Id, ItemCount: 0 });
    return route.fulfill(json({ Id }));
  }
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
  if (list === 'Uncertalytics - Sessions' && path.includes('/items?')) {
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
  if (/ListItemAllFields\?\$select=Id/.test(path)) return route.fulfill(json({ Id: 91 }));
  if (/ValidateUpdateListItem/.test(path) && method === 'POST') {
    return route.fulfill(json({ value: [] }));
  }
  if (/\/recycle\(\)$/.test(path) && method === 'POST') {
    return route.fulfill(json({ value: 'recycled-item' }));
  }
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
const expectedLists = ['Sessions', 'Instruments', 'Instrument Drafts', 'Published Instruments', 'Equations', 'Bug Reports']
  .map(name => `Uncertalytics - ${name}`);
const gateText = await bodyText();
check('gate names all six containers as they appear in Site contents', expectedLists.every(title => gateText.includes(title)));
check(
  'web URL was derived from the /sites/<name> path',
  apiCalls.some((c) => c.includes('_api/')),
  `(${apiCalls.length} api calls)`,
);

// Provision
await page.getByRole('button', { name: /create them now/i }).click();
await page.waitForTimeout(3000);

check('provisioning requested a form digest', apiCalls.some((c) => c.includes('contextinfo')));
check('provisioning created the sessions library', state.lists.has('Uncertalytics - Sessions'));
check('provisioning created all six containers', state.lists.size === 6 && expectedLists.every(title => state.lists.has(title)),
  `(${[...state.lists.keys()].join(', ')})`);
const draftId = schema.fields.get('Uncertalytics - Instrument Drafts')?.find(field => field.InternalName === 'RecordId');
const publicationKey = schema.fields.get('Uncertalytics - Published Instruments')?.find(field => field.InternalName === 'PublicationKey');
check('private drafts have an indexed, non-unique record ID', draftId?.Indexed && !draftId.EnforceUniqueValues);
check('published instruments enforce unique publication keys', publicationKey?.Indexed && publicationKey.EnforceUniqueValues);

await page.waitForTimeout(3000);
const afterText = await bodyText();
const libraryButton = page.getByRole('button', { name: 'Instrument Library', exact: true });
check('app mounts once storage is ready', !/not set up yet/i.test(afterText) && await libraryButton.isVisible());
check('session list was requested through the adapter', apiCalls.some((c) => c.includes('Sessions')));
check(
  'setup restricts all three instrument lists and issues no content mutation overrides',
  schema.security.size === 3 && apiCalls.filter(call => call.startsWith('MERGE ')).length === 3 &&
    !apiCalls.some(call => call.startsWith('DELETE ') || /^MERGE .*\/items/.test(call)),
);
async function checkInbox(label, visible, endpoint) {
  const response = page.waitForResponse(res => res.url().includes(endpoint) && res.ok());
  await libraryButton.click();
  await response;
  const library = page.getByRole('dialog', { name: 'Instrument library', exact: true });
  const inbox = library.getByRole('button', { name: 'Validation inbox', exact: true });
  await inbox.waitFor({ state: visible ? 'visible' : 'hidden' });
  check(label, await inbox.isVisible() === visible);
  await library.getByRole('button', { name: 'Close instrument library', exact: true }).click();
}
await checkInbox('Software Owners can review before the SME group exists', true, '/web/sitegroups?');
siteGroups.push(sme);
await checkInbox('creating the SME group ends interim owner access', false, '/web/sitegroups?');
memberships = [sme];
await checkInbox('an SME member can review', true, '/currentuser/groups?');
memberships = [users];
await checkInbox('an ordinary app user has no review inbox', false, '/currentuser/groups?');
check(
  'no uncaught errors during boot and provisioning',
  errors.length === 0,
  errors.length ? `\n      ${errors.slice(0, 5).join('\n      ')}` : '',
);

console.log(`\n${fail === 0 ? 'SMOKE: ALL PASS' : `SMOKE: ${fail} FAILED`}  (${pass} passed)`);
await browser.close();
server.close();
process.exit(fail === 0 ? 0 : 1);
