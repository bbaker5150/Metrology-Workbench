import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';

// Bounded compatibility check, not a tenant integration or Firepit security test.
// Only the public context/fetch contract is mocked. The browser enforces the
// opaque origin and a CSP without eval, external assets or direct networking.
const html = readFileSync(new URL('../build-singlefile/uncertainty-budget.html', import.meta.url), 'utf8');
const web = 'https://sharepoint.example.test/sites/Metrology/Lab';
const calls = [], errors = [], violations = [], external = [];
const sessions = new Map();
function respond({ url, init = {} }) {
  assert.ok(url.startsWith(`${web}/_api/`), `Unexpected destination: ${url}`);
  assert.ok(!Object.keys(init.headers || {}).some(key => /^(x-requestdigest|authorization|content-length)$/i.test(key)), 'Host-owned request header');
  const path = decodeURIComponent(url.slice(web.length));
  calls.push({ path, method: init.method || 'GET', body: init.body });
  const ok = body => ({ status: 200, body: JSON.stringify(body) });
  if (path.includes('/currentuser/groups')) return ok({ value: [{ Title: 'Metrology App Users' }] });
  if (path.includes('/currentuser')) return ok({ Id: 7, Title: 'Fixture Analyst', Email: 'fixture@example.test' });
  if (path.includes('/sitegroups')) return ok({ value: [{ Title: 'Uncertalytics SME' }] });
  if (path.includes('ReadSecurity,WriteSecurity')) return ok(path.includes('PublishedInstruments')
    ? { ReadSecurity: 1, WriteSecurity: 4 } : { ReadSecurity: 2, WriteSecurity: path.includes('InstrumentDrafts') ? 2 : 4 });
  if (path.includes('/fields?')) return ok({ value: [{ InternalName: 'LegacyCatalogMigratedV1' }, { InternalName: 'SubmittedJson' }] });
  if (path.includes('/EffectiveBasePermissions')) return ok({ Low: '0', High: '0' });
  if (path.includes('/RootFolder')) return ok({ ServerRelativeUrl: '/sites/Metrology/Lab/UncertaintySessions' });
  if (path.includes('/files/add(')) {
    assert.match(path, /overwrite=true/);
    sessions.set(/url='([^']+)'/.exec(path)[1], JSON.parse(init.body));
    return ok({ UniqueId: '00000000-0000-4000-8000-000000000123' });
  }
  if (path.includes('/ListItemAllFields')) return ok({ Id: 123 });
  if (path.includes('/ValidateUpdateListItem')) {
    assert.equal(JSON.parse(init.body).bNewDocumentUpdate, false);
    return ok({ value: [] });
  }
  if (path.includes('/items?')) return ok({ value: [] });
  if (path.includes('?$select=Id')) return ok({ Id: '00000000-0000-4000-8000-000000000001' });
  throw new Error(`Unmocked request: ${init.method} ${path}`);
}

const prelude = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none'">
<script>
(() => {
  window.addEventListener('securitypolicyviolation', e => parent.postMessage({kind:'csp', directive:e.violatedDirective, uri:e.blockedURI}, '*'));
  // Firepit provides isolated storage; native storage throws in an opaque frame.
  for (const name of ['localStorage','sessionStorage']) {
    const values = new Map();
    Object.defineProperty(window, name, {value:{getItem:key=>values.get(String(key))??null,setItem:(key,value)=>values.set(String(key),String(value)),removeItem:key=>values.delete(String(key)),clear:()=>values.clear(),key:i=>[...values.keys()][i]??null,get length(){return values.size;}}});
  }
  const pending = new Map(); let sequence = 0;
  window.fetch = (url, init = {}) => new Promise((resolve,reject) => {
    const id = ++sequence; pending.set(id,{resolve,reject});
    parent.postMessage({kind:'request', id, url:String(url),init},'*');
  });
  window.addEventListener('message', e => {
    if(e.source!==parent||e.data.kind!=='response')return;
    const item=pending.get(e.data.id);if(!item)return;pending.delete(e.data.id);
    if(e.data.error)item.reject(new Error(e.data.error));
    else item.resolve(new Response(e.data.body,{status:e.data.status,headers:{'Content-Type':'application/json'}}));
  });
  window.firepit = {sharepoint:{siteUrl:${JSON.stringify(web)},fetch:window.fetch}};
})();
</script>`;
const document = html.replace(/<head\b[^>]*>/i, match => match + prelude);
const host = '<!doctype html><html><body><iframe id="app" sandbox="allow-scripts allow-downloads" style="width:1400px;height:1000px"></iframe></body></html>';
const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(host); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:')) external.push(request.url()); });
  await page.exposeFunction('fixtureRequest', respond);
  await page.exposeFunction('captureViolation', value => violations.push(value));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(content => {
    window.addEventListener('message', async event => {
      if (event.source !== document.querySelector('#app').contentWindow) return;
      if (event.data.kind === 'csp') { window.captureViolation(event.data); return; }
      if (event.data.kind !== 'request') return;
      try { event.source.postMessage({ kind: 'response', id: event.data.id, ...await window.fixtureRequest(event.data) }, '*'); }
      catch(error) { event.source.postMessage({kind:'response',id:event.data.id,error:error.message},'*'); }
    });
    document.querySelector('#app').srcdoc = content;
  }, document);
  const frame = page.frameLocator('#app');
  await frame.getByTitle('Add New Session', { exact: true }).waitFor({ timeout: 45000 });
  assert.equal(await page.frames()[1].evaluate(() => location.origin), 'null');
  await frame.getByTitle('Add New Session', { exact: true }).click();
  await frame.locator('#session-select').waitFor();
  await page.waitForFunction(() => document.querySelector('#app') !== null);
  // Saving is asynchronous. Wait for the host-facing metadata operation,
  // which must follow the complete JSON replacement.
  for (let attempt = 0; attempt < 100 && !calls.some(call => call.path.includes('/ValidateUpdateListItem')); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(sessions.size, 'New session must reach the SharePoint file save');
  assert.ok(calls.some(call => call.path.includes('/ValidateUpdateListItem')), 'Saved session picker metadata must be restored');
  assert.ok(!calls.some(call => call.path.includes('contextinfo')), 'Hosted app must not fetch its own digest');
  assert.deepEqual(external, [], 'Standalone artifact must load without external assets');
  assert.deepEqual(violations, [], 'Artifact must not violate strict CSP');
  assert.deepEqual(errors, [], 'Artifact must boot without browser errors');
  console.log(`Firepit compatibility smoke passed: opaque frame, strict CSP, ${calls.length} mocked SharePoint requests, new session save and metadata restoration, zero external resources.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
