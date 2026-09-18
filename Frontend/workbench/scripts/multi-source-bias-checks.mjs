import { readFileSync } from 'node:fs';
import { multiSourceCase } from './multi-source-bias-cases.mjs';
const vectors = JSON.parse(readFileSync(new URL('../src/modules/uncertainty/utils/risk8/suppliedBiasParityVectors.json', import.meta.url))).cases.filter(v => v.type <= 4 && v.calBias === .2);
const columns = { observedReop: 'REOP @ test pt TUR', pfa: 'PFA', pfr: 'PFR', maxReop: 'Max REOP', trueReop: 'R_meas', gbMult: 'GB Mult', gbLow: 'GB Limits', gbPfa: 'PFA with GB', gbPfr: 'PFR with GB', gbCalInt: 'Cal Int with GB', gbMeasRel: 'Targeted REOP w/ GB', noGbPfa: 'PFA w/o GB', noGbPfr: 'PFR w/o GB', noGbCalInt: 'Cal Int w/o GB', noGbMeasRel: 'Targeted REOP w/o GB' };

export function prepareMultiSourceBias(session) {
  session.uuts = []; session.testPoints = [];
  for (const vector of vectors) {
    const fixture = multiSourceCase(vector, true);
    const uut = fixture.session.uuts[0];
    uut.id = `uut-${vector.type}`; uut.description = `Workbook tolerance ${vector.type}`; uut.measurementAreaNames = ['Voltage'];
    Object.assign(uut.ranges[0], { min: 0, max: 200 });
    const point = { ...fixture.point, id: `parity-${vector.type}`, activeUutId: uut.id, associatedUutIds: [uut.id], measurementAreaId: 'voltage', uutRangeId: 'uut-range' };
    point.testPointInfo.parameter.name = 'Voltage';
    session.uuts.push(uut); session.testPoints.push(point);
    session.tmdes = fixture.session.tmdes; session.uncReq = fixture.session.uncReq;
  }
}

export async function checkMultiSourceBias({ frame, page, saved, until, check }) {
  await page.setViewportSize({ width: 1600, height: 1050 });
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  for (const label of Object.values(columns)) {
    const add = frame.getByRole('button', { name: `Add ${label} column`, exact: true });
    if (await add.count()) await add.click();
  }
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  const read = row => row.evaluate(node => Object.fromEntries([...node.querySelectorAll('[data-sidebar-column]')].map(cell => [cell.dataset.sidebarColumn, Number(cell.title)])));
  for (const vector of vectors) {
    const row = frame.locator(`[data-point-id="parity-${vector.type}"]`);
    await until(async () => Number.isFinite((await read(row)).pfa));
    const sources = await read(row);
    for (const key of [...Object.keys(columns), 'gbHigh', 'tar', 'tur']) {
      if (key === 'tar') continue; // Tested separately: independent worst-case bounds sum.
      const expected = vector.expected[key];
      if (expected === undefined) { check(`unbounded type ${vector.type} ${key} remains unavailable`, Number.isNaN(sources[key])); continue; }
      check(`two TMDE biases / Excel type ${vector.type} ${key}`, Math.abs(sources[key] - expected) <= 1e-8 + Math.abs(expected) * 1e-8, `${sources[key]} / ${expected}`);
    }
    await row.locator('[data-sidebar-column="pfa"]').click();
    const cards = frame.locator('.budget-decision-card dd[aria-label]');
    check(`detailed budget agrees with point list type ${vector.type}`, await until(async () => (await cards.allTextContents()).some(text => text.includes(vector.expected.pfa.toPrecision(4)))));
    const components = JSON.stringify(saved().testPoints.find(p => p.id === `parity-${vector.type}`).components);
    await frame.getByRole('button', { name: 'Add Net Bias', exact: true }).click();
    check(`source sum initializes manual net type ${vector.type}`, await until(() => Math.abs(Number(saved().testPoints.find(p => p.id === `parity-${vector.type}`).measurementBias?.value) - 2) < 1e-12));
    const after = await read(row);
    check(`equivalent manual net preserves every displayed metric type ${vector.type}`, Object.keys(columns).every(key => Object.is(sources[key], after[key])));
    check(`net replacement preserves the two-source budget type ${vector.type}`, components === JSON.stringify(saved().testPoints.find(p => p.id === `parity-${vector.type}`).components));
    await frame.getByRole('button', { name: 'Remove Net Bias', exact: true }).click();
    check(`removing net restores two source biases type ${vector.type}`, await until(() => !saved().testPoints.find(p => p.id === `parity-${vector.type}`).measurementBias));
  }
  const first = frame.locator('[data-point-id="parity-1"]');
  const before = await read(first);
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  check('point requirements are optional columns, hidden initially', await frame.getByRole('button', { name: 'Add Confidence (%) column', exact: true }).count() === 1);
  await frame.getByRole('button', { name: 'Add Confidence (%) column', exact: true }).click();
  await frame.getByRole('button', { name: 'Add PFA Required column', exact: true }).click();
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  check('column menu trigger remains clickable after adding many columns', await frame.getByRole('dialog', { name: 'Visible measurement point columns' }).count() === 0);
  await first.getByRole('button', { name: 'Edit Uncertainty Confidence (%)', exact: true }).click();
  const confidence = first.getByRole('spinbutton', { name: 'Uncertainty Confidence (%)', exact: true });
  await confidence.fill('90'); await confidence.press('Enter');
  check('point requirement edit persists only on that point', await until(() => saved().testPoints[0].riskRequirements?.uncertaintyConfidence === '90') && saved().uncReq.uncertaintyConfidence === 95 && !saved().testPoints[1].riskRequirements);
  check('point override recalculates risk and displays a default-deviation indicator', await until(async () => (await read(first)).tur !== before.tur) && await first.getByLabel('Differs from session default', { exact: true }).count() === 1);
  await first.locator('[data-sidebar-column="pfa"]').click();
  check('detailed risk uses the same point-specific confidence', await until(async () => { const expected = (await read(first)).pfa.toPrecision(4); return (await frame.locator('.budget-decision-card dd[aria-label]').allTextContents()).some(text => text.includes(expected)); }));
  await first.getByRole('button', { name: 'Edit Uncertainty Confidence (%)', exact: true }).click();
  await confidence.fill(''); await confidence.press('Enter');
  check('blank restores session defaults and original workbook result', await until(async () => Math.abs((await read(first)).tur - before.tur) < 1e-10) && await first.getByLabel('Differs from session default', { exact: true }).count() === 0);
  check('calibration interval has at most two displayed decimals and keeps raw hover precision', await first.locator('[data-sidebar-column="gbCalInt"]').evaluate(node => /^\d+(\.\d{1,2})?$/.test(node.textContent.trim()) && node.title.length > node.textContent.trim().length));
  for (const dark of [false, true]) {
    await frame.evaluate(dark => { document.body.classList.remove('light-mode', 'dark-mode'); document.body.classList.add(dark ? 'dark-mode' : 'light-mode'); }, dark);
    await page.waitForTimeout(250);
    check(`${dark ? 'dark' : 'light'} risk text keeps contrast with status glow`, await first.locator('[data-sidebar-column="pfa"]').evaluate((node, dark) => {
      const css = getComputedStyle(node);
      return css.color === (dark ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)') && Number(css.fontWeight) >= 600 && css.textShadow !== 'none';
    }, dark));
    if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/bias-followup-${dark ? 'dark' : 'light'}.png` });
  }
  await frame.evaluate(() => { document.body.classList.remove('dark-mode'); document.body.classList.add('light-mode'); });
  await frame.locator('[data-tour="tab-overview"]').click();
  const table = frame.locator('.instrument-equipment-table').first();
  await table.locator('.cell-tolerance .inline-tolerance-summary').first().click();
  const biasToggle = table.getByRole('button', { name: 'Bias', exact: true });
  if (await biasToggle.getAttribute('aria-pressed') !== 'true') await biasToggle.click();
  const bias = table.getByRole('textbox', { name: 'Range UUT bias', exact: true });
  await bias.fill('10'); await bias.press('Enter');
  check('editing UUT bias refreshes unselected point results', await until(async () => Math.abs((await read(first)).pfa - before.pfa) > 1e-6));
  await page.keyboard.press('Escape');

}
