import { checkColumnDialog } from './column-dialog-checks.mjs';
import { prepareInputTasking } from './input-tasking-checks.mjs';
import { editNetBias } from './net-bias-smoke-helpers.mjs';

export function prepareSeptember21Collapse(session) {
  prepareInputTasking(session);
  const uut = session.uuts.find(item => item.id === 'fresh-uut');
  uut.description = 'Unassigned temperature UUT';
  uut.ranges[0].unit = 'degF';
  uut.ranges[0].tolerances = { floor: { high: 2, low: -2, unit: 'degF', distribution: '1.732' } };
}

export async function checkSeptember21Collapse({ frame, page, saved, until, check }) {
  await page.setViewportSize({ width: 1600, height: 1050 });
  const capture = async name => {
    if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) {
      await page.mouse.move(2, 2); await page.waitForTimeout(200);
      await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/${name}.png` });
    }
  };
  const info = frame.getByRole('button', { name: 'Session Info', exact: true });
  if (await info.getAttribute('aria-expanded') === 'true') await info.click();
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  await frame.locator('[data-point-id="point"] [data-sidebar-column="pfa"]').click();
  const summary = frame.getByRole('button', { name: 'Edit net measurement system bias', exact: true });
  const choose = async name => {
    await frame.getByRole('button', { name: 'Input bias display', exact: true }).click();
    await frame.getByRole('option', { name, exact: true }).click();
  };
  await choose('Nominal + Bias');
  await editNetBias(frame);
  await frame.getByRole('button', { name: 'Net measurement system bias units', exact: true }).click();
  await frame.getByRole('option', { name: '%', exact: true }).click();
  const input = frame.getByRole('textbox', { name: 'Net measurement system bias', exact: true });
  await input.fill('5'); await input.press('Enter');
  check('Enter collapses a 5% output bias to nominal plus tolerance-based bias', await until(async () => await summary.innerText() === '5.1 V' && await input.count() === 0 && saved().testPoints[0].measurementBias?.kind === 'percent'));
  await choose('Bias %');
  check('Bias % displays the saved percentage', await summary.innerText() === '5 %');
  await choose('Bias');
  check('Bias displays the converted output offset', await summary.innerText() === '0.1 V');
  await choose('Nominal + Bias');
  await editNetBias(frame);
  check('reopening edits the authored percentage rather than the displayed nominal', await input.inputValue() === '5');
  await input.fill('6');
  await frame.locator('.measurement-equation-input-panel .panel-card-header').click();
  check('outside click commits and collapses to the selected display', await until(async () => await summary.innerText() === '5.12 V') && await input.count() === 0);
  await editNetBias(frame); await input.fill('invalid'); await input.press('Enter');
  check('invalid bias remains editable and preserves the last valid saved value', await input.count() === 1 && saved().testPoints[0].measurementBias.value === '6');
  await input.press('Escape');
  await capture('e4-derived-bias');
  await frame.getByRole('button', { name: 'Remove Net Bias', exact: true }).click();
  check('removal restores automatic source bias in the selected display', await until(async () => await summary.innerText() === '5 V' && !saved().testPoints[0].measurementBias));

  await frame.locator('[data-tour="tab-overview"]').click();
  const area = frame.locator('.measurement-group-container').filter({ has: frame.getByRole('textbox', { name: 'Measurement area name: Fresh Area', exact: true }) });
  await area.getByRole('button', { name: 'Add direct point', exact: true }).click();
  const point = area.locator('.point-grid-item').first();
  await point.locator('input.sidebar-inline-input.value').fill('5'); await point.locator('input.sidebar-inline-input.value').press('Enter');
  const unit = point.getByRole('combobox', { name: 'Measurement point unit', exact: true });
  const freshPoint = () => saved().testPoints.find(p => p.testPointInfo?.measurementArea === 'Fresh Area');
  check('point stays unassigned and unitless despite an existing same-area Fahrenheit UUT', await until(() => freshPoint()?.testPointInfo.parameter.value === '5') && await unit.inputValue() === '' && !freshPoint().associatedUutIds.length);
  await capture('e4-unassigned-unit');
  await point.getByRole('button', { name: 'UUT', exact: true }).click();
  await frame.locator('.inline-unit-menu').getByRole('option', { name: /Unassigned temperature UUT/ }).click();
  check('assigning the specific UUT supplies Fahrenheit and opens its direct budget', await until(async () => await unit.inputValue() === 'degF' && await frame.locator('.measurement-bias-table').count() === 1));
  await choose('Nominal + Bias');
  await editNetBias(frame); await input.fill('.25'); await input.press('Enter');
  check('direct net bias collapses to nominal plus bias too', await until(async () => await summary.innerText() === '5.25 °F' && freshPoint().measurementBias?.value === '.25'));
  await capture('e4-direct-bias');
  await unit.selectOption('');
  check('explicit Units choice remains available after UUT assignment', await until(() => freshPoint().testPointInfo.parameter.unitSelectionExplicit === true) && await unit.inputValue() === '');

  await checkColumnDialog({ frame, page, until, check });
}
