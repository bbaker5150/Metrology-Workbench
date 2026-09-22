import { checkColumnDialog } from './column-dialog-checks.mjs';
import { authorNetBias } from './net-bias-smoke-helpers.mjs';
import { prepareInputTasking } from './input-tasking-checks.mjs';
export function prepareSeptember21(session) {
  prepareInputTasking(session);
  Object.assign(session.uuts[0].ranges[0].tolerances, { whicheverIsGreater: true,
    reading: { high: 1, low: -1, unit: '%', symmetric: true, distribution: '1.732' } });
  session.tmdes.push({ id: 'bare', name: 'Unitless reference', description: 'Unitless reference', measurementAreaNames: ['Voltage'], ranges: [{ id: 'bare-r', unit: '', tolerances: {} }] });
  session.tmdes.push({ id: 'ohms', name: 'Ohm reference', description: 'Ohm reference', measurementAreaNames: ['Voltage'], ranges: [{ id: 'ohm-r', unit: 'Ω', min: 0, max: 10,
    tolerances: { floor: { high: 2, low: -2, unit: 'Ω', symmetric: true, distribution: '1.732' } } }] });
}
export async function checkSeptember21({ frame, page, check, until, saved }) {
  await page.setViewportSize({ width: 1600, height: 1050 });
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const point = frame.locator('[data-point-id="point"]');
  await point.locator('[data-sidebar-column="pfa"]').click();
  const inputs = frame.locator('.measurement-inputs-table');
  check('output is the first row, with its nominal and no extra input', await inputs.locator('tbody tr').first().getAttribute('class') === 'measurement-output-row' && await inputs.locator('tbody tr').count() === 2);
  await frame.getByRole('button', { name: 'Edit measurement equation', exact: true }).click();
  await frame.getByLabel('Measurement equation', { exact: true }).fill('τ = a');
  await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  check('optional Unicode output symbol saves on the LHS only', await until(() => saved().testPoints[0].equationString === 'τ = a') && Object.keys(saved().testPoints[0].variableMappings).join() === 'a');
  await frame.getByRole('button', { name: 'Rename equation variable a', exact: true }).focus();
  const symbol = frame.getByRole('textbox', { name: 'Equation variable a', exact: true });
  check('tab-focus opens and selects the equation symbol', await symbol.evaluate(node => node === document.activeElement && node.selectionStart === 0 && node.selectionEnd === node.value.length));
  await symbol.fill('E'); await symbol.press('Enter');
  check('capital E stays an input after save and recalculation', await until(() => saved().testPoints[0].equationString === 'τ = E' && saved().testPoints[0].variableNominals.E.value === 5));
  await frame.getByRole('button', { name: 'Edit name for equation variable E', exact: true }).focus();
  const name = frame.getByRole('textbox', { name: 'Display name for equation variable E', exact: true });
  check('tab-focus opens and selects the equation name', await name.evaluate(node => node === document.activeElement && node.selectionEnd === node.value.length));
  await name.fill(''); await name.press('Tab');
  check('Tab opens the next nominal field without Enter', await until(async () => await frame.getByRole('spinbutton', { name: 'Nominal value for equation variable E', exact: true }).evaluate(node => node === document.activeElement)));
  await frame.getByRole('button', { name: 'Edit measurement equation', exact: true }).click();
  const equation = frame.getByLabel('Measurement equation', { exact: true });
  await equation.fill('τ = 1'); await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  await frame.getByRole('button', { name: 'Edit measurement equation', exact: true }).click();
  await equation.fill('τ = E'); await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  check('explicitly cleared names do not return when a variable is re-added', await until(() => saved().testPoints[0].variableMappings.E === ''));
  check('incomplete inputs retain their budget and omit the old instruction banner', await frame.getByText(/Name every variable and enter/).count() === 0 && await frame.locator('.budget-section-title-row h4').filter({ hasText: /^E Uncertainty Budget$/ }).count() === 1);
  await frame.getByRole('button', { name: 'Edit measurement equation', exact: true }).click();
  await equation.fill('τ = π'); await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  const greekHeading = frame.locator('.budget-section-title-row h4').filter({ hasText: /^π Uncertainty Budget$/ });
  check('unnamed Greek budget heading retains lowercase π', await until(async () => await greekHeading.count() === 1) && await greekHeading.evaluate(node => getComputedStyle(node).textTransform === 'none'));
  check('editing incomplete equation inputs does not launch a bias warning', await frame.getByRole('alertdialog').count() === 0);
  await frame.getByRole('button', { name: 'Edit measurement equation', exact: true }).click();
  await equation.fill('τ = E'); await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  // Restore a complete input before inspecting linked TMDE limits.
  await frame.getByRole('button', { name: 'Edit name for equation variable E', exact: true }).click();
  await name.fill('Voltage'); await name.press('Tab');
  const nominal = frame.getByRole('spinbutton', { name: 'Nominal value for equation variable E', exact: true });
  await nominal.fill('5');
  await inputs.getByRole('button', { name: 'Nominal unit for equation variable E base unit', exact: true }).click();
  await frame.locator('.inline-unit-search').fill('volt');
  await frame.getByRole('option', { name: /^V\s+Voltage$/ }).click();
  await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  await authorNetBias(frame);
  check('net bias lives in the output row, with all cells aligned', await inputs.locator('.measurement-output-row > td').count() === 4 && await inputs.locator('.measurement-output-row .measurement-net-bias-value').count() === 1 && await inputs.locator('tbody tr').count() === 2);
  const linkedRow = frame.locator('.uncertainty-budget-table tbody tr').filter({ hasText: 'Smoke tmde' }).first();
  check('imported TMDE source displays its valid 0.2 V limit after equation edits', await until(async () => /0\.2000+ V/.test(await linkedRow.locator('td').nth(1).innerText())));
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) {
    await inputs.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/measurement-output.png` });
  }
  await frame.getByRole('button', { name: 'Remove Net Bias', exact: true }).click();
  const uut = frame.locator('.instrument-equipment-table').first();
  check('collapsed whichever-greater tolerance shows all authored terms', /1% IV, or ±2 V, whichever is greater/.test(await uut.locator('.cell-tolerance .inline-tolerance-summary').first().innerText()));
  await uut.locator('.cell-tolerance .inline-tolerance-summary').first().click();
  await uut.getByRole('button', { name: 'Bias', exact: true }).click();
  check('turning Bias off removes its persisted value', await until(() => !saved().uuts[0].ranges[0].tolerances.bias));
  await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  await uut.locator('.cell-tolerance .inline-tolerance-summary').first().click();
  check('Bias remains off after collapse/reopen', await uut.getByRole('button', { name: 'Bias', exact: true }).getAttribute('aria-pressed') === 'false' && await uut.locator('.instrument-bias-editor').count() === 0);
  await uut.getByRole('button', { name: 'Tolerance unit base unit', exact: true }).click();
  check('unit picker opens alone', await frame.locator('.inline-unit-menu').count() === 1);
  await uut.getByRole('button', { name: 'Tolerance unit prefix', exact: true }).click();
  check('prefix picker closes the base-unit picker', await frame.locator('.inline-unit-menu').count() === 1 && await frame.locator('.inline-unit-search').count() === 0);
  await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  // Incomplete and dimensionally incompatible linked sources keep their own
  // authored limit text, while standard uncertainty remains unavailable.
  for (const label of ['Unitless reference', 'Ohm reference']) {
    await frame.getByRole('button', { name: 'Add component to budget', exact: true }).first().click();
    await frame.locator('.budget-tmde-picker-menu').getByRole('button', { name: new RegExp('^' + label) }).click();
    const budgetRow = frame.locator('.uncertainty-budget-table tbody tr').filter({ hasText: label }).first();
    await budgetRow.waitFor();
    const text = await budgetRow.locator('td').nth(1).innerText();
    check(`${label} displays its own error limit without borrowing the UUT unit`, label === 'Unitless reference' ? text === 'Not Set' : /2\s*Ω/.test(text) && !text.includes(' V'));
    check(`${label} remains unresolved`, await budgetRow.locator('.budget-pending-uncertainty').count() === 1);
  }
  await frame.locator('[data-tour="tab-overview"]').click();
  for (const index of [0, 1]) {
    const table = frame.locator('.instrument-equipment-table').nth(index);
    const header = table.locator('.instrument-area-section-row').first();
    await header.click({ position: { x: 300, y: 15 } });
    check(`${index ? 'TMDE' : 'UUT'} area header is highlighted with its instruments`, await header.getAttribute('data-area-selected') === 'true' && await header.locator('td').evaluate(node => getComputedStyle(node).boxShadow !== 'none'));
    await header.press('Escape');
    check('Escape clears the complete instrument area selection', await until(async () => await table.locator('[data-area-selected="true"], [data-range-selected="true"]').count() === 0));
  }
  // Prime the old point clipboard, then replace it with a cut instrument.
  await point.click({ button: 'right' }); await frame.getByText('Copy Point', { exact: true }).click();
  await frame.locator('[data-tour="tab-overview"]').click();
  const table = frame.locator('.instrument-equipment-table').nth(1);
  const row = table.locator('tr.instrument-function-row').filter({ hasText: 'Ohm reference' }).first();
  await row.locator('.cell-description').click({ button: 'right' });
  await frame.getByText('Cut Instrument', { exact: true }).click();
  check('cut removes the source immediately', await until(() => !saved().tmdes.some(item => item.id === 'ohms')));
  const destination = table.locator('.instrument-area-section-row').first();
  await destination.click({ position: { x: 300, y: 15 } });
  const count = saved().tmdes.length, pointCount = saved().testPoints.length;
  await destination.press('Control+v');
  check('first instrument paste restores the cut object', await until(() => saved().tmdes.length === count + 1));
  await destination.press('Control+v');
  check('second instrument paste creates another instrument, never the old point', await until(() => saved().tmdes.length === count + 2) && saved().testPoints.length === pointCount);
  await point.locator('[data-sidebar-column="pfa"]').click();
  await point.press('Control+v');
  check('point-list paste ignores an instrument clipboard', saved().testPoints.length === pointCount);
  await checkColumnDialog({ frame, page, until, check });
  await frame.locator('[data-tour="tab-overview"]').click();
  const scroller = frame.locator('.analysis-content').first();
  // Place each table's body underneath its sticky column header, then hit-test
  // the header. No Add Instrument action or row content may sit on top of it.
  for (const tableIndex of [0, 1]) {
    const instrumentTable = frame.locator('.instrument-equipment-table').nth(tableIndex);
    await instrumentTable.evaluate(table => {
      const panel = table.closest('.analysis-content');
      const r = table.getBoundingClientRect(), p = panel.getBoundingClientRect();
      panel.scrollTop += r.top - p.top + 18;
    });
    check(`sticky ${tableIndex ? 'TMDE' : 'UUT'} header covers instrument rows and actions`, await until(async () => await instrumentTable.evaluate(table => {
      const rect = table.tHead.getBoundingClientRect();
      return [0.15, 0.5, 0.85].every(fraction => {
        const x = Math.min(innerWidth - 5, rect.left + rect.width * fraction);
        const hit = document.elementFromPoint(x, rect.top + Math.min(8, rect.height / 2));
        return hit?.closest('thead') === table.tHead;
      });
    })));
  }
  await scroller.evaluate(node => { node.scrollTop = 0; });
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/september21.png` });
  await frame.locator('[data-tour="tab-overview"]').click();
}
