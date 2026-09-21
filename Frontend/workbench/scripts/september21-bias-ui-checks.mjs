import { editNetBias } from './net-bias-smoke-helpers.mjs';
import { prepareInputTasking } from './input-tasking-checks.mjs';

export function prepareSeptember21BiasUi(session) {
  prepareInputTasking(session);
  session.uuts = session.uuts.filter(item => item.id !== 'fresh-uut');
  session.tmdes.push({ id: 'fresh-current', description: 'Current reference only', measurementAreaNames: ['Fresh Area'], ranges: [{ id: 'fresh-current-r', unit: 'A', min: 0, max: 10 }] });
  // Imported/group metadata can carry a TMDE unit before any UUT exists.
  Object.assign(session.measurementAreaGroups.find(area => area.name === 'Fresh Area'), { unit: 'A', units: ['A'] });
}

export async function checkSeptember21BiasUi({ frame, page, saved, until, check }) {
  await page.setViewportSize({ width: 1600, height: 1050 });
  const capture = async name => { if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) { await page.mouse.move(5, 5); await page.waitForTimeout(250); await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/${name}.png` }); } };
  const info = frame.getByRole('button', { name: 'Session Info', exact: true });
  if (await info.getAttribute('aria-expanded') === 'false') await info.click();
  check('session defaults omit redundant explanatory text', await frame.getByText('Defaults for points without overrides', { exact: true }).count() === 0);
  check('Analyst and Document Date align with default input values', await frame.locator('.session-info-content').evaluate(node => {
    const row = label => [...node.querySelectorAll('.session-header-field')].find(row => row.querySelector('.session-header-label > span')?.textContent === label);
    const x = label => row(label).querySelector('.session-field-size').getBoundingClientRect().left;
    return Math.abs(x('Analyst') - x('Uncertainty Confidence (%)')) < 1 && Math.abs(x('Document Date') - x('PFA Required')) < 1;
  }));
  await capture('d661-session-defaults');
  await info.click();
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const point = frame.locator('[data-point-id="point"]');
  await point.locator('[data-sidebar-column="pfa"]').click();
  const inputs = frame.locator('.measurement-inputs-table');
  const net = frame.getByRole('textbox', { name: 'Net measurement system bias', exact: true });
  check('derived inputs always show Bias without an add button or saved override', await inputs.locator('thead th').count() === 4 && await frame.getByRole('button', { name: 'Add Net Bias', exact: true }).count() === 0 && !saved().testPoints[0].measurementBias);
  await page.mouse.move(5, 5); await page.waitForTimeout(250);
  check('output row has the same surface as equation input rows', await inputs.evaluate(table => {
    const rows = table.tBodies[0].rows;
    return getComputedStyle(rows[0]).backgroundColor === getComputedStyle(rows[1]).backgroundColor && getComputedStyle(rows[0].cells[0]).backgroundColor === getComputedStyle(rows[1].cells[0]).backgroundColor;
  }));
  await frame.getByRole('button', { name: 'Edit output variable', exact: true }).click();
  await frame.getByRole('textbox', { name: 'Output variable', exact: true }).fill('I');
  await frame.getByRole('textbox', { name: 'Output variable', exact: true }).press('Enter');
  check('measurand symbol changes only equation LHS', await until(() => saved().testPoints[0].equationString === 'I = a') && Object.keys(saved().testPoints[0].variableMappings).join() === 'a');
  await editNetBias(frame); await net.fill('.25'); await net.press('Enter');
  check('derived net bias persists in output units', await until(() => saved().testPoints[0].measurementBias?.value === '.25'));
  await frame.getByRole('button', { name: 'Remove Net Bias', exact: true }).click();
  check('removing net bias preserves editor and column', await frame.getByRole('button', { name: 'Edit net measurement system bias', exact: true }).count() === 1 && await inputs.locator('thead th').count() === 4 && await until(() => !saved().testPoints[0].measurementBias));
  await capture('d661-derived');
  await frame.locator('[data-tour="tab-overview"]').click();

  const freshArea = frame.locator('.measurement-group-container').filter({ has: frame.getByRole('textbox', { name: 'Measurement area name: Fresh Area', exact: true }) });
  await freshArea.getByRole('button', { name: 'Add direct point', exact: true }).click();
  const fresh = freshArea.locator('.point-grid-item').first();
  await fresh.locator('input.sidebar-inline-input.value').fill('5'); await fresh.locator('input.sidebar-inline-input.value').press('Enter');
  const unit = fresh.getByRole('combobox', { name: 'Measurement point unit', exact: true });
  check('TMDE and area metadata cannot preassign a new point unit', await unit.inputValue() === '' && await unit.locator('option[value="A"]').count() === 1);
  await fresh.getByRole('button', { name: 'UUT', exact: true }).click();
  await frame.locator('.inline-unit-menu').getByRole('button', { name: 'Add UUT to this measurement area', exact: true }).click();
  const direct = frame.locator('.measurement-bias-table');
  check('assigning a newly created UUT opens the specific direct point budget', await until(async () => await direct.count() === 1 && await frame.locator('[data-tour="tab-budget"]').getAttribute('class').then(text => text.includes('active'))));
  check('direct Measurement Bias contains one row and Name, Nominal, Bias', await frame.getByText('Measurement Bias', { exact: true }).count() === 1 && JSON.stringify(await direct.locator('thead th').allTextContents()) === JSON.stringify(['Name', 'Nominal', 'Bias']) && await direct.locator('tbody tr').count() === 1 && await direct.locator('tbody td').nth(1).innerText() === '5');
  const uut = frame.locator('.instrument-equipment-table').first();
  await uut.locator('[data-range-cell] .inline-tolerance-summary').first().click();
  await uut.getByRole('button', { name: 'Range unit base unit', exact: true }).click();
  await frame.locator('.inline-unit-search').fill('volt');
  await frame.getByRole('option', { name: /^V\s+Voltage$/ }).click();
  check('first UUT unit updates the existing Units placeholder', await until(async () => await unit.inputValue() === 'V'));
  await editNetBias(frame); await net.fill('.5'); await net.press('Enter');
  const freshPoint = () => saved().testPoints.find(p => p.testPointInfo?.measurementArea === 'Fresh Area');
  check('direct net bias saves without adding a component or equation', await until(() => freshPoint().measurementBias?.value === '.5') && !(freshPoint().components || []).length && !freshPoint().equationString);
  await capture('d661-direct');
  await editNetBias(frame); await net.fill(''); await net.press('Enter');
  check('clearing direct net bias restores inheritance', await until(() => !freshPoint().measurementBias) && await frame.getByRole('button', { name: 'Edit net measurement system bias', exact: true }).count() === 1);
  await unit.selectOption('');
  check('Units remains a deliberate selectable opt-out', await until(() => freshPoint().testPointInfo.parameter.unitSelectionExplicit === true) && await unit.inputValue() === '');
  await unit.selectOption('V');
  await uut.locator('.cell-tolerance .inline-tolerance-summary').first().click();
  await uut.getByTitle('Asymmetric tolerance', { exact: true }).click();
  await uut.getByRole('button', { name: 'SS', exact: true }).click();
  check('expanded single-sided controls say Known value and Unknown value', await uut.getByRole('radio', { name: 'Known value', exact: true }).count() === 1 && await uut.getByRole('radio', { name: 'Unknown value', exact: true }).count() === 1 && await uut.getByText('Measurement known', { exact: true }).count() === 0);
  await capture('d661-known-unknown');
  await frame.locator('[data-tour="tab-overview"]').click();
  await point.getByRole('button', { name: 'UUT', exact: true }).click();
  await frame.getByRole('option', { name: /Smoke uut/ }).click();
  check('assigning an existing UUT opens the clicked derived point', await until(async () => await frame.getByText('Measurement Inputs', { exact: true }).count() === 1 && await frame.locator('.measurement-bias-table').count() === 0));
}
