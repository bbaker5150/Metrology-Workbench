export async function checkSeptember22Followup({ frame, page, saved, until, check }) {
  const capture = async name => { if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/${name}.png` }); };
  const divider = frame.getByRole('separator', { name: 'Resize measurement point list' });
  await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  check('divider arrow is subtly visible at rest', await divider.evaluate(node => getComputedStyle(node, '::after').opacity === '0.45'));
  await divider.hover();
  check('divider arrow appears on hover', await divider.evaluate(node => getComputedStyle(node, '::after').opacity === '1'));

  const settings = frame.getByRole('button', { name: 'Voltage measurement area settings', exact: true });
  await settings.locator('..').hover(); await settings.click();
  check('retired measurement bias option is absent from area settings', await frame.getByRole('checkbox', { name: /Show measurement bias/ }).count() === 0);
  await settings.locator('..').hover(); await settings.click();
  const point = frame.locator('[data-point-id="point"]');
  check('bias columns are available with independent source values', await point.locator('[data-sidebar-column="uutBias"]').count() === 1 && await point.locator('[data-sidebar-column="tmdeBias"]').count() === 1);
  for (const zoom of [.75, 1, 1.25]) {
    await frame.evaluate(value => { document.documentElement.style.zoom = String(value); window.dispatchEvent(new Event('resize')); }, zoom);
    check(`value column includes the entire unit control at ${zoom * 100}%`, await until(async () => point.locator('[data-sidebar-column="value"]').evaluate(cell => {
      const unit = cell.querySelector('select').getBoundingClientRect(), box = cell.getBoundingClientRect();
      return unit.right <= box.right + 1 && unit.left >= box.left - 1 && cell.scrollWidth <= cell.clientWidth + 1;
    })));
  }
  await frame.evaluate(() => { document.documentElement.style.zoom = ''; window.dispatchEvent(new Event('resize')); });
  check('session picker chevron is at the right edge', await frame.locator('#session-select').evaluate(node => getComputedStyle(node, '::picker-icon').marginInlineStart !== '0px'));

  await frame.getByRole('button', { name: 'Edit measurement equation', exact: true }).click();
  const equation = frame.getByRole('textbox', { name: 'Measurement equation', exact: true });
  await equation.fill('/asd'); await equation.press('Enter');
  await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  check('invalid equation stays editable after Enter and blur with its error below', await equation.isVisible() && await equation.inputValue() === '/asd' && await frame.getByText(/Equation does not parse/).isVisible());
  await capture('followup-invalid-equation');
  await equation.fill('a'); await equation.press('Enter');

  check('light mode uses clean white content and budget surfaces', await frame.locator('.content-area, .results-content, .budget-section-title-row, .budget-results-card').evaluateAll(nodes => nodes.length > 2 && nodes.every(node => getComputedStyle(node).backgroundColor === 'rgb(255, 255, 255)')));
  check('budget content has no extra top padding above its section dividers', await frame.locator('.analysis-content').evaluate(node => getComputedStyle(node).paddingTop === '0px'));
  const tmdeTable = frame.locator('.instrument-equipment-table').nth(1);
  await tmdeTable.locator('.cell-tolerance .inline-tolerance-summary').first().click();
  await tmdeTable.getByRole('button', { name: 'Bias', exact: true }).click();
  const sourceBias = tmdeTable.getByRole('textbox', { name: 'Range source bias', exact: true });
  await sourceBias.fill('0.125'); await sourceBias.press('Enter');
  check('instrument bias edits immediately update the TMDE Bias column', await until(async () => (await point.locator('[data-sidebar-column="tmdeBias"]').innerText()).includes('0.125 V')));
  await sourceBias.fill(''); await sourceBias.press('Enter');
  await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });

  const table = frame.locator('.instrument-equipment-table').first();
  const row = table.locator('tr[data-selection-key="uut:uut"]').first();
  const range = row.locator('[data-range-cell]').first();
  await range.click({ position: { x: 3, y: 3 } });
  await range.locator('.inline-tolerance-summary').click();
  const widths = await table.evaluate(async node => {
    const values = [];
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      values.push(node.querySelector('th[data-instrument-column="range"]').getBoundingClientRect().width);
    }
    return values;
  });
  check('expanded range width remains stable over repeated layout frames', Math.max(...widths.slice(5)) - Math.min(...widths.slice(5)) < 1, JSON.stringify(widths));
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
  await modal.getByRole('button', { name: 'Repeatability unit base unit', exact: true }).click();
  await frame.getByPlaceholder('Search units...', { exact: true }).fill('A');
  await frame.getByRole('listbox', { name: 'Repeatability unit', exact: true }).getByRole('option')
    .filter({ has: frame.getByText('A', { exact: true }) }).click();
  check('repeatability warns about incompatible units before adding', await modal.getByText(/Unit mismatch: A/).isVisible());
  await modal.getByRole('button', { name: 'Add repeatability', exact: true }).click();
  check('incompatible repeatability is saved with its readings', await until(() => saved().testPoints.find(p => p.id === 'point').components.some(c => c.type === 'A' && c.variableSymbol === 'a' && c.savedInputs?.unit === 'A' && c.savedInputs.readings.length === 3)));
  const repeatRow = frame.locator('.uncertainty-budget-table tbody tr').filter({ hasText: 'Repeatability' }).first();
  check('added repeatability keeps a visible unit warning in the budget', await repeatRow.locator('[title*="Unit mismatch"]').count() > 0);
  await capture('followup-repeatability-warning');
}
