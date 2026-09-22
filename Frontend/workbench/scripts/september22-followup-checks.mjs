export async function checkSeptember22Followup({ frame, page, saved, until, check }) {
  const capture = async name => { if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/${name}.png` }); };
  const divider = frame.getByRole('separator', { name: 'Resize measurement point list' });
  await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  check('divider arrow is hidden at rest', await divider.evaluate(node => getComputedStyle(node, '::after').opacity === '0'));
  await divider.hover();
  check('divider arrow appears on hover', await divider.evaluate(node => getComputedStyle(node, '::after').opacity === '1'));

  const settings = frame.getByRole('button', { name: 'Voltage measurement area settings', exact: true });
  await settings.locator("..").hover(); await settings.click();
  const biasToggle = frame.getByRole('checkbox', { name: /Show measurement bias/ });
  await biasToggle.uncheck();
  check('turning off area bias hides the derived Bias column', await until(async () => await frame.locator('.measurement-inputs-table thead th').count() === 3));
  await settings.locator("..").hover(); await settings.click();
  await frame.locator('[data-point-id="direct-polish"] [data-sidebar-column="pfa"]').click();
  check('the same area setting hides the direct Measurement Bias section', await frame.locator('.measurement-bias-table').count() === 0 && await frame.getByRole('button', { name: 'Collapse Measurement Bias section', exact: true }).count() === 0);
  check('hiding bias retains the authored value', saved().testPoints.find(p => p.id === 'direct-polish').measurementBias?.value === '.25');
  await frame.evaluate(() => location.reload());
  await frame.getByRole('combobox', { name: 'Analysis Session' }).waitFor();
  await settings.locator("..").hover(); await settings.click();
  check('area bias preference survives refresh', !await biasToggle.isChecked());
  await biasToggle.check(); await settings.locator("..").hover(); await settings.click();
  await frame.locator('[data-point-id="point"] [data-sidebar-column="pfa"]').click();
  check('enabling area bias restores its derived controls', await until(async () => await frame.locator('.measurement-inputs-table thead th').count() === 4));
  await frame.getByRole('button', { name: 'Fresh Area measurement area settings', exact: true }).locator('..').hover();
  await frame.getByRole('button', { name: 'Fresh Area measurement area settings', exact: true }).click();
  check('a new area defaults to hidden bias', !await biasToggle.isChecked());
  await frame.getByRole('button', { name: 'Fresh Area measurement area settings', exact: true }).locator('..').hover();
  await frame.getByRole('button', { name: 'Fresh Area measurement area settings', exact: true }).click();

  await frame.getByRole('button', { name: 'Edit measurement equation', exact: true }).click();
  const equation = frame.getByRole('textbox', { name: 'Measurement equation', exact: true });
  await equation.fill('/asd'); await equation.press('Enter');
  check('invalid equation remains visible after blur with its error below', await frame.getByRole('button', { name: 'Edit measurement equation', exact: true }).innerText() === '/asd' && await frame.getByText(/Equation does not parse/).isVisible());
  await capture('followup-invalid-equation');
  await frame.getByRole('button', { name: 'Edit measurement equation', exact: true }).click();
  await equation.fill('a'); await equation.press('Enter');

  const table = frame.locator('.instrument-equipment-table').first();
  const row = table.locator('tr[data-selection-key="uut:uut"]').first();
  const range = row.locator('[data-range-cell]').first();
  await range.click({ position: { x: 3, y: 3 } });
  await range.locator('.inline-tolerance-summary').click();
  // Simulate the user's unusually wide column without changing stored widths.
  await table.locator('col').nth(1).evaluate(node => node.style.setProperty('--instrument-live-column-width', '600px'));
  const geometry = await range.evaluate(node => {
    const min = node.querySelector('[placeholder="min"]').getBoundingClientRect();
    const max = node.querySelector('[placeholder="max"]').getBoundingClientRect();
    const unit = node.querySelector('.inline-unit-select').getBoundingClientRect();
    const remove = node.querySelector('.range-row-delete')?.getBoundingClientRect();
    return { min, max, unit, remove, cell: node.getBoundingClientRect() };
  });
  check('range bounds share the first line and units occupy the second', Math.abs(geometry.min.y - geometry.max.y) < 2 && geometry.unit.y >= geometry.min.bottom);
  check('expanded range actions stay at the right edge of a wide cell', geometry.remove && geometry.cell.right - geometry.remove.right < 20, JSON.stringify(geometry));
  await capture('followup-range-layout');
  await range.locator('[placeholder="min"]').press('Escape');
  await table.locator('col').nth(1).evaluate(node => node.style.removeProperty('--instrument-live-column-width'));

  await row.getByRole('button', { name: 'Set resolution', exact: true }).click();
  const resolution = row.locator('.instrument-resolution-editor');
  check('resolution distribution sits below its value and units', await resolution.evaluate(node => {
    const input = node.querySelector('input').getBoundingClientRect(), unit = node.querySelector('.inline-unit-select').getBoundingClientRect(), distribution = node.querySelector('.inline-resolution-dist').getBoundingClientRect();
    return Math.abs(input.y - unit.y) < 3 && distribution.y >= input.bottom;
  }));
  await capture('followup-resolution-layout');
  await resolution.locator('input').press('Escape');

  await frame.getByRole('button', { name: 'Add component to budget', exact: true }).first().click();
  await frame.getByRole('dialog', { name: 'Add component to budget', exact: true }).getByRole('button', { name: /Repeatability/ }).click();
  const modal = frame.locator('.repeatability-modal');
  const readings = modal.getByLabel('Measurement', { exact: true });
  for (const value of ['1', '2', '3']) { await readings.fill(value); await readings.press('Enter'); }
  const repeatUnit = modal.getByRole('combobox', { name: 'Repeatability unit' });
  await repeatUnit.fill('A');
  await frame.locator('.react-select__menu').getByRole('option', { name: 'A', exact: true }).click();
  check('repeatability warns about incompatible units before adding', await modal.getByText(/Unit mismatch: A/).isVisible());
  await modal.getByRole('button', { name: 'Add repeatability', exact: true }).click();
  check('incompatible repeatability is saved with its readings', await until(() => saved().testPoints.find(p => p.id === 'point').components.some(c => c.type === 'A' && c.variableSymbol === 'a' && c.savedInputs?.unit === 'A' && c.savedInputs.readings.length === 3)));
  const repeatRow = frame.locator('.uncertainty-budget-table tbody tr').filter({ hasText: 'Repeatability' }).first();
  check('added repeatability keeps a visible unit warning in the budget', await repeatRow.locator('[title*="Unit mismatch"]').count() > 0);
  await capture('followup-repeatability-warning');
}
