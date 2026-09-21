import { authorNetBias } from './net-bias-smoke-helpers.mjs';
import { prepareBiasSession } from './measurement-bias-checks.mjs';

export function prepareInputTasking(session) {
  prepareBiasSession(session);
  delete session.tmdes[0].ranges[0].tolerances.bias;
  const point = session.testPoints[0];
  Object.assign(point, { measurementType: 'derived', equationString: 'a', variableMappings: { a: 'Voltage' }, variableNominals: { a: { value: 5, unit: 'V' } } });
  point.components[0].variableType = 'Voltage';
  // A selectable area unit that is incompatible with this point's actual UUT.
  session.tmdes.push({ id: 'unused-current', description: 'Unused current reference', measurementAreaNames: ['Voltage'], ranges: [{ id: 'current', unit: 'A', min: 0, max: 10 }] });
  session.measurementAreaGroups.push({ name: 'Fresh Area', color: '#3388cc' });
  session.uuts.push({ id: 'fresh-uut', description: 'Blank unit UUT', measurementAreaNames: ['Fresh Area'], ranges: [{ id: 'fresh-range', unit: '', min: 0, max: 10 }] });
}

export async function checkInputTasking({ frame, page, check, until, saved }) {
  await page.setViewportSize({ width: 1600, height: 1050 });
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const first = frame.locator('[data-point-id="point"]');
  await first.locator('[data-sidebar-column="pfa"]').click();
  const inputs = frame.locator('.measurement-inputs-table');
  check('Measurement Inputs always displays Bias', await until(async () => await inputs.locator('thead th').count() === 4) && await frame.getByRole('button', { name: 'Input bias display', exact: true }).count() === 1);
  const tmde = frame.locator('.instrument-equipment-table').nth(1);
  await tmde.locator('.cell-tolerance .inline-tolerance-summary').first().click();
  await tmde.getByRole('button', { name: 'Bias', exact: true }).click();
  const bias = frame.getByRole('textbox', { name: 'Range source bias', exact: true });
  await bias.fill('0'); await bias.press('Enter');
  check('instrument bias retains the four-column table', await until(async () => await inputs.locator('thead th').count() === 4));
  await bias.fill(''); await bias.press('Enter');
  check('clearing source bias retains the net editor', await until(async () => await inputs.locator('thead th').count() === 4));
  await authorNetBias(frame);
  check('a manual net bias retains a correctly aligned four-column table', await until(async () => await inputs.locator('thead th').count() === 4 && await inputs.locator('.measurement-output-row > td').count() === 4 && await inputs.locator('.measurement-output-row .measurement-net-bias-value').count() === 1));
  await frame.getByRole('button', { name: 'Remove Net Bias', exact: true }).click();
  check('removing net bias preserves the always-visible column', await until(async () => await inputs.locator('thead th').count() === 4));

  const pointUnit = first.getByRole('combobox', { name: 'Measurement point unit', exact: true });
  await pointUnit.selectOption('A');
  check('incompatible UUT units suppress point limits and risk', await until(async () => await first.evaluate(row => {
    const cells = ['lowLimit', 'highLimit', 'pfa', 'pfr'];
    return cells.every(key => { const cell = row.querySelector(`[data-sidebar-column="${key}"]`); return cell && !/\d/.test(cell.textContent); });
  })));
  check('incompatible UUT units suppress the final uncertainty total', await until(async () => {
    const point = saved().testPoints.find(p => p.id === 'point');
    return point.is_detailed_uncertainty_calculated === false && point.expanded_uncertainty_absolute_base == null;
  }));
  await pointUnit.selectOption('V');
  check('restoring compatible units restores the point calculation', await until(async () => await first.locator('[data-sidebar-column="pfa"]').textContent().then(value => /\d/.test(value))));

  await frame.getByRole('button', { name: 'Edit measurement equation', exact: true }).click();
  await frame.getByLabel('Measurement equation', { exact: true }).fill('a+b');
  await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  const results = frame.locator('.budget-results-zoom-surface');
  check('unnamed input budgets say Results; only the final point says Final Results', await until(async () => await results.evaluateAll(nodes => nodes.length === 3 && nodes.filter(node => node.textContent.includes('Final Results')).length === 1 && nodes.at(-1).textContent.includes('Final Results'))));

  // New unitless points must be distinguishable from an explicit Units choice.
  const freshArea = frame.locator('.measurement-group-container').filter({ has: frame.getByRole('textbox', { name: 'Measurement area name: Fresh Area', exact: true }) });
  await freshArea.getByRole('button', { name: 'Add direct point', exact: true }).click();
  const fresh = freshArea.locator('.point-grid-item').first();
  const value = fresh.locator('input.sidebar-inline-input.value');
  check('blank point editor displays Value', await value.getAttribute('placeholder') === 'Value');
  await value.press('Enter');
  check('blank point display says Value', await until(async () => await fresh.locator('.point-value-number:not([aria-hidden])').textContent() === 'Value'));
  await fresh.locator('.point-value-number').click();
  await value.fill('5'); await value.press('Tab');
  check('new unitless points are eligible to inherit the first UUT unit', await until(() => saved().testPoints.some(p => p.testPointInfo?.measurementArea === 'Fresh Area' && !p.testPointInfo.parameter.unit && !p.testPointInfo.parameter.unitSelectionExplicit)));
  await frame.locator('[data-tour="tab-overview"]').click();
  const uut = frame.locator('.instrument-equipment-table').first();
  const freshInstrument = uut.locator('tr.instrument-function-row').filter({ hasText: 'Blank unit UUT' });
  await freshInstrument.locator('[data-range-cell] .inline-tolerance-summary').click();
  await freshInstrument.getByRole('button', { name: 'Range unit base unit', exact: true }).click();
  await frame.locator('.inline-unit-search').fill('volt');
  await frame.getByRole('option', { name: /^V\s+Voltage$/ }).click();
  check('assigning the first UUT unit fills the existing point automatically', await until(async () => await fresh.getByRole('combobox', { name: 'Measurement point unit', exact: true }).inputValue() === 'V'));
  const freshUnit = fresh.getByRole('combobox', { name: 'Measurement point unit', exact: true });
  await freshUnit.selectOption('');
  check('Units remains a selectable explicit choice', await until(() => saved().testPoints.some(p => p.testPointInfo?.measurementArea === 'Fresh Area' && p.testPointInfo.parameter.unit === '' && p.testPointInfo.parameter.unitSelectionExplicit)));

  // Use raw down/up at a fixed coordinate so Playwright cannot retarget a moved
  // button after blur. Exercise an editor with a focused, dirty input.
  for (const column of ['range', 'tolerance']) {
    const row = uut.locator('tr.instrument-function-row').first();
    if (column === 'range') await row.locator('[data-range-cell] .inline-tolerance-summary').click();
    else await row.locator('.cell-tolerance .inline-tolerance-summary').click();
    const editor = row.locator(column === 'range' ? '.inline-range-editor input' : '.cell-tolerance input').first();
    await editor.fill('0.1');
    const count = await uut.locator('thead th').count();
    const header = uut.locator('th[data-instrument-column="description"]');
    await header.hover();
    const button = header.locator('.instrument-column-insert-button');
    const box = await button.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.up();
    check(`one press creates a column while ${column} is expanded`, await until(async () => await uut.locator('thead th').count() === count + 1));
    const name = uut.locator('.instrument-custom-column-name-input').first();
    check(`new ${column} custom-column name is immediately ready for typing`, await until(async () => await name.count() === 1 && await name.evaluate(node => node === document.activeElement)));
    await name.fill(`Audit ${column}`); await name.press('Enter');
    check(`new ${column} custom-column name persists`, await until(() => saved().instrumentCustomColumns?.uut?.some(item => item.label === `Audit ${column}`) === true));
  }
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/input-tasking.png` });
  await frame.locator('[data-tour="tab-overview"]').click();
}
