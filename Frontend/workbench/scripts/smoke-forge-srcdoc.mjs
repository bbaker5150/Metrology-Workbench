import { prepareWorkspacePolish, checkWorkspacePolish } from "./workspace-polish-checks.mjs";
import { prepareTaskingTypeB, checkTaskingTypeB } from "./tasking-type-b-checks.mjs";
import { prepareSeptember21, checkSeptember21 } from "./september21-checks.mjs";
import { prepareSeptember21Followup, checkSeptember21Followup } from "./september21-followup-checks.mjs";
import { prepareSeptember21BiasUi, checkSeptember21BiasUi } from "./september21-bias-ui-checks.mjs";
import { prepareSeptember21Collapse, checkSeptember21Collapse } from "./september21-collapse-checks.mjs";
import { prepareSeptember22, checkSeptember22 } from './september22-checks.mjs';
import { prepareInputTasking, checkInputTasking } from './input-tasking-checks.mjs';
import { preparePointPolish, checkPointPolish } from './point-polish-checks.mjs';
import { preparePointUsability, checkPointUsability } from "./point-usability-checks.mjs";
import { preparePointHighlight, checkPointHighlight } from "./point-highlight-checks.mjs";
import { prepareMultiSourceBias, checkMultiSourceBias } from "./multi-source-bias-checks.mjs";
import { prepareSeptember18, checkSeptember18 } from "./september18-checks.mjs";
import { prepareTaskingLayout, checkTaskingLayout } from "./tasking-layout-checks.mjs";
import { prepareGrowingInputs, checkGrowingInputs } from "./growing-inputs-checks.mjs";
import { prepareInstrumentInteractions, checkInstrumentInteractions } from "./instrument-interaction-checks.mjs";
import { prepareSeptember17Interactions, checkSeptember17Interactions } from "./september17-interaction-checks.mjs";
import { prepareFieldStability, checkFieldStability } from "./field-stability-checks.mjs";
import { prepareIndependentColumns, checkIndependentColumns } from "./independent-columns-checks.mjs";
import { prepareBiasSession, checkMeasurementBias } from "./measurement-bias-checks.mjs";
import { prepareSeptember16Layout, checkSeptember16 } from "./september16-checks.mjs";
import { prepareSharedEquationSession, checkSharedEquations } from "./shared-equation-checks.mjs";
import { prepareDynamicEquationSession, checkDynamicEquationCopies } from "./dynamic-equation-copy-checks.mjs";
import { prepareFollowupSession, checkTaskingFollowup } from "./tasking-followup-checks.mjs";
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { assertSanitiserSafe } from './hardenInlineHtml.mjs';
import { checkInstrumentAutoHeight } from './instrument-layout-checks.mjs';
import { prepareFeedbackSession, checkTaskingFeedback } from './tasking-feedback-checks.mjs';

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
//
// What a real browser cannot reproduce is Forge's own sanitiser, which reads
// the document before the browser does and killed the first ship attempt by
// cutting the bundle at a `<script` that was only ever a string. Playwright is
// too forgiving to catch that, so the file is checked statically as well.

const PORT = Number(process.env.FORGE_SMOKE_PORT || 4190);
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
  ...(process.env.INSTRUMENT_CLASSIC_SCROLLBARS ? {
    headless: false,
    args: ['--window-position=-32000,-32000', '--disable-features=OverlayScrollbar,FluentOverlayScrollbar'],
  } : {}),
  // Left to Playwright unless pointed somewhere explicitly, so this runs on a
  // CI runner (`npx playwright install chromium`) as well as on a workstation
  // or in a sandbox with a preinstalled browser.
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
});
const page = await browser.newPage();
if (process.env.MEASUREMENT_BIAS_SMOKE || process.env.TASKING_FEEDBACK_SMOKE || process.env.TASKING_FOLLOWUP_SMOKE || process.env.DYNAMIC_EQUATION_COPY_SMOKE || process.env.SHARED_EQUATION_SMOKE || process.env.SEPTEMBER16_SMOKE) await page.setViewportSize({ width: 1440, height: 1000 });

const subresourceFailures = [];
const apiCalls = [];
const pageErrors = [];
const dialogs = [];
const destructiveCalls = [];
page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });

page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('requestfailed', (r) => subresourceFailures.push(r.url()));
page.on('response', (r) => {
  const u = r.url();
  if (r.status() >= 400 && !u.includes('/_api/')) subresourceFailures.push(`${r.status()} ${u}`);
});

const lists = new Set();
const rangeInstrument = id => ({
  id, rangeId: `${id}-low`, ranges: [{ id: `${id}-low`, min: 0, max: 10, unit: 'V' }], description: `Range action ${id}`, measurementArea: 'Voltage', measurementAreaId: 'voltage',
  instrument: { manufacturer: 'Smoke', model: id, description: `Range action ${id}`,
    functions: [{ id: 'voltage-fn', name: 'Voltage', unit: 'V', ranges: [
      { id: `${id}-low`, min: 0, max: 10, unit: 'V' },
      { id: `${id}-high`, min: 10, max: 20, unit: 'V' },
    ] }],
  },
});
const sessions = new Map([201, 202].map(id => [`session-7-${id}.json`, {
  id, name: `Archive smoke ${id}`, uuts: [rangeInstrument('uut')], tmdes: [rangeInstrument('tmde')],
  measurementAreaGroups: [{ name: 'Voltage', color: '#cc3030' }],
  testPoints: [{ id: 'point', measurementAreaId: 'voltage', uutRangeId: 'uut-low', associatedUutIds: ['uut'], activeUutId: 'uut', measurementType: 'direct',
    testPointInfo: { parameter: { name: 'Voltage', value: '5', unit: 'V' } },
    uutTolerance: { functionId: 'voltage-fn', functionName: 'Voltage', rangeId: 'uut-low', min: 0, max: 10, unit: 'V' },
    tmdeTolerances: [], components: [], specifications: {},
  }], measurementAreas: [{id:'voltage',name:'Voltage',unit:'V'}], uncReq: {},
}]));
// Optional full exported-session fixture for reproducing large imported sessions.
if (process.env.INSTRUMENT_SESSION_JSON) {
  const imported = JSON.parse(readFileSync(process.env.INSTRUMENT_SESSION_JSON, 'utf8'));
  for (const [name, doc] of sessions) sessions.set(name, { ...structuredClone(imported), id: doc.id });
}
if (process.env.TASKING_FEEDBACK_SMOKE || process.env.TASKING_FOLLOWUP_SMOKE) for (const session of sessions.values()) prepareFeedbackSession(session);
if (process.env.TASKING_FOLLOWUP_SMOKE) for (const session of sessions.values()) prepareFollowupSession(session);
if (process.env.DYNAMIC_EQUATION_COPY_SMOKE) for (const session of sessions.values()) prepareDynamicEquationSession(session);
if (process.env.SHARED_EQUATION_SMOKE) for (const session of sessions.values()) prepareSharedEquationSession(session);
if (process.env.SEPTEMBER16_LAYOUT_ONLY) for (const session of sessions.values()) prepareSeptember16Layout(session);
if (process.env.TASKING_LAYOUT_SMOKE) for (const session of sessions.values()) prepareTaskingLayout(session);
if (process.env.INDEPENDENT_COLUMNS_SMOKE) for (const session of sessions.values()) prepareIndependentColumns(session);
if (process.env.FIELD_STABILITY_SMOKE) for (const session of sessions.values()) prepareFieldStability(session);
if (process.env.GROWING_INPUTS_SMOKE) for (const session of sessions.values()) prepareGrowingInputs(session);
if (process.env.INSTRUMENT_INTERACTION_SMOKE) for (const session of sessions.values()) prepareInstrumentInteractions(session);
if (process.env.SEPTEMBER17_INTERACTION_SMOKE) for (const session of sessions.values()) prepareSeptember17Interactions(session);
if (process.env.MEASUREMENT_BIAS_SMOKE) for (const session of sessions.values()) prepareBiasSession(session);
if (process.env.SEPTEMBER21_SMOKE) for (const session of sessions.values()) prepareSeptember21(session);
if (process.env.SEPTEMBER21_FOLLOWUP_SMOKE) for (const session of sessions.values()) prepareSeptember21Followup(session);
if (process.env.SEPTEMBER21_BIAS_UI_SMOKE) for (const session of sessions.values()) prepareSeptember21BiasUi(session);
if (process.env.SEPTEMBER21_COLLAPSE_SMOKE) for (const session of sessions.values()) prepareSeptember21Collapse(session);
if (process.env.WORKSPACE_POLISH_SMOKE) for (const session of sessions.values()) prepareWorkspacePolish(session);
if (process.env.TASKING_TYPE_B_SMOKE) for (const session of sessions.values()) prepareTaskingTypeB(session);
if (process.env.SEPTEMBER22_SMOKE) for (const session of sessions.values()) prepareSeptember22(session);
if (process.env.INPUT_TASKING_SMOKE) for (const session of sessions.values()) prepareInputTasking(session);
if (process.env.POINT_POLISH_SMOKE) for (const session of sessions.values()) preparePointPolish(session);
if (process.env.POINT_USABILITY_SMOKE) for (const session of sessions.values()) preparePointUsability(session);
if (process.env.POINT_HIGHLIGHT_SMOKE) for (const session of sessions.values()) preparePointHighlight(session);
if (process.env.SEPTEMBER18_SMOKE) for (const session of sessions.values()) prepareSeptember18(session);
if (process.env.MULTI_SOURCE_BIAS_SMOKE) for (const session of sessions.values()) prepareMultiSourceBias(session);
const instrumentItems = [301, 302].map(id => ({
  Id: id, AuthorId: 7, RecordId: `instrument-${id}`,
  PayloadJson: JSON.stringify({ id: `instrument-${id}`, manufacturer: 'Smoke', model: `DMM-${id}`, description: 'Archive smoke instrument', scope: 'validated', functions: [] }),
}));
await page.route('**/_api/**', async (route) => {
  const url = decodeURIComponent(new URL(route.request().url()).pathname + new URL(route.request().url()).search);
  apiCalls.push(url);
  const ok = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const request = route.request();
  const method = request.headers()['x-http-method'] || request.method();
  if (/DELETE|MERGE/i.test(method) || /recycle|delete|\$batch/i.test(url)) {
    destructiveCalls.push(`${method} ${url}`);
    return route.fulfill({ status: 400, body: 'Unexpected destructive operation' });
  }

  // The single-file build uses SharePoint's existing signed-in identity to
  // scope sessions and local instruments. Keep that authentication handshake
  // in the smoke environment so the storage gate can proceed to its list
  // probes just as it does on a real tenant.
  if (url.includes('/_api/web/currentuser')) {
    return ok({
      Id: 7,
      LoginName: 'i:0#.f|membership|smoke.user@example.test',
      Email: 'smoke.user@example.test',
      Title: 'Smoke Test User',
    });
  }
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
  if (/createfieldasxml/.test(url)) return ok({ Id: 'f' });
  // What the live tenant answered: the Fields collection is polymorphic, so a
  // plain JSON body carries no way to tell what kind of column to create.
  if (/\/fields$/.test(url) && route.request().method() === 'POST') {
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: { value: "A type named '' could not be resolved by the model." } } }),
    });
  }
  if (/RootFolder/.test(url)) return ok({ ServerRelativeUrl: '/sites/ISEA/UncertaintySessions' });
  if (/UncertaintySessions'\)\/items\?/.test(url)) return ok({ value: [...sessions].map(([name, doc]) => ({
    SessionId: doc._uncertaintyArchive ? null : doc.id, SessionName: doc.name, AuthorId: 7, FileLeafRef: name,
  })) });
  if (/UncertaintyInstruments'\)\/items\?/.test(url)) {
    const recordId = /\$filter=RecordId eq '([^']+)'/.exec(url)?.[1];
    return ok({ value: instrumentItems.filter(item => !recordId || item.RecordId === recordId) });
  }
  if (/UncertaintyInstruments'\)\/items$/.test(url) && request.method() === 'POST') {
    const item = { Id: 1000 + instrumentItems.length, AuthorId: 7, ...JSON.parse(request.postData()) };
    instrumentItems.push(item);
    return ok(item);
  }
  if (/getfilebyserverrelativeurl/.test(url)) {
    const name = /session-7-\d+\.json/.exec(url)?.[0];
    if (/ListItemAllFields/.test(url)) return ok({ Id: sessions.get(name)?.id });
    if (/\$value$/.test(url) && sessions.has(name)) return ok(sessions.get(name));
  }
  if (/files\/add/.test(url)) {
    const name = /url='([^']+)'/.exec(url)?.[1];
    sessions.set(name, JSON.parse(request.postData()));
    return ok({});
  }
  if (/ValidateUpdateListItem/.test(url)) {
    const itemId = Number(/items\((\d+)\)/.exec(url)?.[1]);
    const item = instrumentItems.find(item => item.Id === itemId);
    if (item && url.includes('UncertaintyInstruments')) {
      for (const field of JSON.parse(request.postData()).formValues) item[field.FieldName] = field.FieldValue;
    }
    return ok({ value: [] });
  }
  return ok({ value: [] });
});

// Inject the app HTML for the host page to assign as srcdoc.
await page.addInitScript((html) => {
  window.__APP_HTML__ = html;
}, appHtml);
if (process.env.INSTRUMENT_ZOOM_LEVEL) {
  await page.addInitScript(zoom => {
    localStorage.setItem('uncertalytics.uiSizing.v1', JSON.stringify({
      scopedZoomLevels: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`panel-table-container:${i}`, zoom])),
    }));
  }, Number(process.env.INSTRUMENT_ZOOM_LEVEL));
}

await page.goto(`http://127.0.0.1:${PORT}/sites/ISEA/pages/app.aspx`, { waitUntil: 'networkidle' });
// Wait for the actual boot result rather than sampling a loading screen on
// slower browsers. The unprovisioned-site assertion below remains unchanged.
await page.frameLocator('iframe#app').getByText(/not set up yet/i).waitFor({ timeout: 30000 });

const frame = page.frames().find((f) => f.url() === 'about:srcdoc');
const frameText = frame ? await frame.locator('body').innerText().catch(() => '') : '';

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
  ok ? pass++ : fail++;
};

let sanitiserSafe = true;
let sanitiserProblem = '';
try {
  assertSanitiserSafe(appHtml);
} catch (error) {
  sanitiserSafe = false;
  sanitiserProblem = error.message.split('\n').slice(0, 2).join('\n      ');
}
check('nothing in the file can be mistaken for markup', sanitiserSafe, sanitiserProblem);

// The build does Forge's ship step itself. The host page decides whether to
// show its "Not Secured" banner by looking for the globals this runtime
// installs, so a page that boots without them is one that ships with the
// banner — which is the whole reason the runtime is vendored.
check('the manifest is the first line of the file', appHtml.startsWith('<!--WFC-MANIFEST:'));
const devConsoleLive = frame ? await frame.evaluate(() => typeof window.__PseudoDevConsole !== 'undefined') : false;
check('the Forge runtime installed its globals', devConsoleLive);
const buildStamp = frame ? await frame.evaluate(() => window.__UNCERTAINTY_BUILD__) : undefined;
check('the page carries a build stamp', Boolean(buildStamp), `(${buildStamp})`);

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

  // Every image has to be embedded, not addressed. A src the frame cannot
  // resolve fails silently — the element is simply blank — so the check is on
  // whether the bytes actually decoded, not on whether a request 404'd.
  const images = await frame.evaluate(() => [...document.images].map((img) => ({
    embedded: img.currentSrc.startsWith('data:') || img.currentSrc.startsWith('blob:'),
    decoded: img.naturalWidth > 0,
  })));
  check('every image is embedded and decoded', images.length > 0 && images.every((i) => i.embedded && i.decoded),
    `(${images.length} images, ${images.filter((i) => !i.embedded).length} addressed, ${images.filter((i) => !i.decoded).length} blank)`);

  const until = async predicate => {
    for (let i = 0; i < 50 && !(await predicate()); i++) await page.waitForTimeout(100);
    return predicate();
  };
  // Exercise the shipped HTML, including its real SharePoint adapter and
  // frame coordinates. Component-only fixtures miss host/layout regressions.
  const sessionId = await frame.getByRole('combobox', { name: 'Analysis Session' }).inputValue();
  const saved = () => [...sessions.values()].find(doc => String(doc.id) === sessionId);
  if (process.env.TASKING_FEEDBACK_SMOKE) await checkTaskingFeedback({ frame, page, saved, until, check });
  if (process.env.TASKING_FOLLOWUP_SMOKE) await checkTaskingFollowup({ frame, page, saved, until, check });
  if (process.env.DYNAMIC_EQUATION_COPY_SMOKE) await checkDynamicEquationCopies({ frame, page, saved, until, check });
  if (process.env.SHARED_EQUATION_SMOKE) await checkSharedEquations({ frame, page, saved, until, check });
  if (process.env.SEPTEMBER16_SMOKE) await checkSeptember16({ frame, page, check });
  if (process.env.MEASUREMENT_BIAS_SMOKE) await checkMeasurementBias({ frame, page, saved, until, check });
  if (process.env.TASKING_LAYOUT_SMOKE) await checkTaskingLayout({ frame, page, saved, until, check });
  if (process.env.INDEPENDENT_COLUMNS_SMOKE) await checkIndependentColumns({ frame, page, saved, until, check });
  if (process.env.FIELD_STABILITY_SMOKE) await checkFieldStability({ frame, page, saved, until, check });
  if (process.env.GROWING_INPUTS_SMOKE) await checkGrowingInputs({ frame, page, saved, until, check });
  if (process.env.INSTRUMENT_INTERACTION_SMOKE) await checkInstrumentInteractions({ frame, page, saved, until, check });
  if (process.env.SEPTEMBER17_INTERACTION_SMOKE) await checkSeptember17Interactions({ frame, page, saved, until, check });
  if (process.env.SEPTEMBER21_SMOKE) await checkSeptember21({ frame, page, saved, until, check });
  if (process.env.SEPTEMBER21_FOLLOWUP_SMOKE) await checkSeptember21Followup({ frame, page, saved, until, check });
  if (process.env.SEPTEMBER21_BIAS_UI_SMOKE) await checkSeptember21BiasUi({ frame, page, saved, until, check });
  if (process.env.SEPTEMBER21_COLLAPSE_SMOKE) await checkSeptember21Collapse({ frame, page, saved, until, check });
  if (process.env.WORKSPACE_POLISH_SMOKE) await checkWorkspacePolish({ frame, page, saved, until, check });
  if (process.env.TASKING_TYPE_B_SMOKE) await checkTaskingTypeB({ frame, page, saved, until, check });
  if (process.env.SEPTEMBER22_SMOKE) await checkSeptember22({ frame, page, saved, until, check });
  if (process.env.INPUT_TASKING_SMOKE) await checkInputTasking({ frame, page, saved, until, check });
  if (process.env.POINT_POLISH_SMOKE) await checkPointPolish({ frame, page, saved, until, check });
  if (process.env.POINT_USABILITY_SMOKE) await checkPointUsability({ frame, page, saved, until, check });
  if (process.env.POINT_HIGHLIGHT_SMOKE) await checkPointHighlight({ frame, page, saved, until, check });
  if (process.env.SEPTEMBER18_SMOKE) await checkSeptember18({ frame, page, saved, until, check });
  if (process.env.MULTI_SOURCE_BIAS_SMOKE) await checkMultiSourceBias({ frame, page, saved, until, check });
  for (const view of ['overview', 'point']) {
    if (view === 'overview') await frame.locator('[data-tour="tab-overview"]').click();
    else {
      const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
      if (await expand.count()) await expand.first().click();
      await frame.locator('.point-grid-item').first().click();
    }
    await checkInstrumentAutoHeight({ frame, page, check, view });
    for (const [tableIndex, kind] of ['uut', 'tmde'].entries()) {
      const table = frame.locator('.instrument-equipment-table').nth(tableIndex);
      const row = table.locator('tr.instrument-function-row').first();
      await row.locator('td').first().click({ position: { x: 3, y: 3 } });
      const geometry = await table.evaluate(async table => {
        const widths = [];
        for (let i = 0; i < 20; i++) {
          await new Promise(requestAnimationFrame);
          widths.push(table.getBoundingClientRect().width);
        }
        return widths;
      });
      check(`${view} ${kind} table stays stable while hovered`, Math.max(...geometry) - Math.min(...geometry) < 1, JSON.stringify(geometry));
      const rowCount = await table.locator('tr.instrument-function-row').count();
      const positions = [];
      for (const index of [...new Set([0, Math.min(1, rowCount - 1), Math.min(3, rowCount - 1), 0])]) {
        await table.locator('tr.instrument-function-row').nth(index).locator('td').first().hover();
        positions.push(await table.evaluate(async t => {
          await new Promise(requestAnimationFrame);
          return [...t.tHead.rows[0].cells].flatMap(cell => {
            const rect = cell.getBoundingClientRect(); return [rect.x, rect.width];
          });
        }));
      }
      check(`${view} ${kind} columns do not shift between hovered instruments`, positions.every(p => p.every((x, i) => Math.abs(x - positions[0][i]) < 1)));
      await row.locator('td').first().hover();
      check(`${view} ${kind} whole-instrument selection hides range actions`, await table.getByRole('button', { name: 'Add range', exact: true }).count() === 0);
      await row.locator('[data-range-cell]').click({ position: { x: 3, y: 3 } });
      await row.locator('[data-range-cell]').hover();
      const list = `${kind}s`;
      const before = saved()[list][0].ranges.length;
      const visibleBefore = await table.locator('tr.instrument-function-row').count();
      await table.getByRole('button', { name: 'Add range', exact: true }).first().click({ timeout: 5000 });
      check(`${view} ${kind} range + persists through the HTML adapter`, await until(() => saved()[list][0].ranges.length === before + 1));
      check(`${view} ${kind} added range is visible`, await table.locator('tr.instrument-function-row').count() === visibleBefore + 1);
      const blank = table.locator('tr.inline-range-row').filter({ has: frame.locator('[data-range-cell] .is-empty') }).first();
      await blank.locator('[data-range-cell]').click({ position: { x: 3, y: 3 } });
      await blank.locator('.range-row-cell').hover();
      await blank.getByRole('button', { name: 'Delete range', exact: true }).click({ timeout: 5000 });
      check(`${view} ${kind} range × persists through the HTML adapter`, await until(() => saved()[list][0].ranges.length === before));
    }
  }
  await frame.getByTitle('Delete Session', { exact: true }).click();
  check('session deletion archives the full document without a dialog', await until(() => [...sessions.values()].some(doc => doc._uncertaintyArchive)) && dialogs.length === 0);
  await frame.getByRole('button', { name: 'Instrument builder', exact: true }).click();
  const selectedLibraryRecords = instrumentItems.filter(item => ['instrument-301', 'instrument-302'].includes(item.RecordId));
  const retainedLibraryRecords = instrumentItems.filter(item => !selectedLibraryRecords.includes(item)).map(item => [item.RecordId, item.PayloadJson]);
  const retainedLibraryRecordsUnchanged = () => retainedLibraryRecords.every(([id, payload]) => instrumentItems.find(item => item.RecordId === id)?.PayloadJson === payload);
  const first = frame.getByText('DMM-301', { exact: true });
  const second = frame.getByText('DMM-302', { exact: true });
  await first.click();
  await second.click({ modifiers: ['Control'] });
  await page.keyboard.press('Delete');
  check('builder bulk removal archives only the selected records without a dialog', await until(() => selectedLibraryRecords.length === 2 && selectedLibraryRecords.every(item => JSON.parse(item.PayloadJson)._uncertaintyArchive)) && retainedLibraryRecordsUnchanged() && dialogs.length === 0);
  await page.reload({ waitUntil: 'networkidle' });
  // The iframe can attach after navigation's network-idle event. Resolve it
  // lazily so the following action waits for the reloaded application.
  const reloaded = page.frameLocator('iframe#app');
  await reloaded.getByRole('button', { name: 'Instrument builder', exact: true }).click();
  check('archived instruments stay absent after reload', await reloaded.getByText('DMM-301', { exact: true }).count() === 0 && await reloaded.getByText('DMM-302', { exact: true }).count() === 0);
  check('records remain recoverable in SharePoint', sessions.size === 2 && selectedLibraryRecords.every(item => JSON.parse(item.PayloadJson).description === 'Archive smoke instrument') && retainedLibraryRecordsUnchanged());
}

check('no delete, recycle, bulk, or mutation override requests', destructiveCalls.length === 0, destructiveCalls.join('\n'));
check('no native browser dialogs', dialogs.length === 0, dialogs.join('\n'));

check('no uncaught errors', pageErrors.length === 0,
  pageErrors.length ? `\n      ${pageErrors.slice(0, 3).join('\n      ')}` : '');

console.log(`\n${fail === 0 ? 'FORGE SMOKE: ALL PASS' : `FORGE SMOKE: ${fail} FAILED`}  (${pass} passed)`);
await browser.close();
server.close();
process.exit(fail === 0 ? 0 : 1);
