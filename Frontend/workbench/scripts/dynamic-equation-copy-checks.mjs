export function prepareDynamicEquationSession(session) {
  session.measurementAreas = [{ id: 'temperature', name: 'Temperature', unit: 'degF' }];
  session.measurementAreaGroups = [{ name: 'Temperature', color: '#cc3030' }];
  for (const instrument of [...session.uuts, ...session.tmdes]) {
    instrument.measurementArea = 'Temperature';
    instrument.measurementAreaId = 'temperature';
    instrument.instrument.functions[0] = { ...instrument.instrument.functions[0], name: 'Temperature', unit: 'degF',
      ranges: instrument.instrument.functions[0].ranges.map(range => ({ ...range, unit: 'degF' })) };
    instrument.ranges = instrument.ranges.map(range => ({ ...range, unit: 'degF' }));
  }
  const source = session.testPoints[0];
  source.measurementAreaId = 'temperature';
  source.testPointInfo.parameter = { name: 'Temperature', value: 1, unit: 'degF' };
  source.uutTolerance = { ...source.uutTolerance, unit: 'degF', functionName: 'Temperature' };
  const destination = structuredClone(source);
  destination.id = 'point-two';
  destination.testPointInfo.parameter.value = 4;
  session.testPoints.push(destination);
}

export async function checkDynamicEquationCopies({ frame, page, saved, until, check }) {
  page.setDefaultTimeout(10000);
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const points = frame.locator('.point-grid-item');
  const selectPoint = async row => { await row.locator('.point-value-number').click(); await page.keyboard.press('Escape'); };
  const outside = async () => {
    await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
    await frame.locator('.dynamic-budget-editor').first().waitFor({ state: 'hidden' });
  };
  await selectPoint(points.first());
  await frame.getByRole('button', { name: 'Add component to budget', exact: true }).last().click();
  await frame.getByRole('button', { name: 'Add equation component', exact: true }).click();
  await frame.getByLabel('Uncertainty equation', { exact: true }).fill('x/10');
  await frame.getByRole('button', { name: 'Edit error limit distribution', exact: true }).click();
  await frame.getByLabel('Error limit distribution', { exact: true }).selectOption('1.000');
  check('equation editor omits the shared-component footer', await frame.locator('.dynamic-shared-note').count() === 0);
  await outside();
  check('equation saves its dynamic measurement binding', await until(() => saved().dynamicBudgetDefinitions?.[0]?.pointVariable === 'x'));
  await points.first().locator('.point-value-number').click({ button: 'right' });
  await frame.getByText('Copy Budget', { exact: true }).click();
  await points.nth(1).locator('.point-value-number').click({ button: 'right' });
  await frame.getByText('Paste Budget', { exact: true }).click();
  await selectPoint(points.nth(1));
  const equationRow = frame.locator('.budget-dynamic-row');
  await equationRow.locator('.dynamic-tolerance-cell button').click();
  check('budget pasted from 1 F displays the destination 4 F binding', await equationRow.locator('.dynamic-bound-value').innerText() === '4 °F');
  check('destination equation uncertainty recalculates to 0.4 F', await until(() => Math.abs(saved().testPoints[1].combined_uncertainty_absolute_base - .4 * 5 / 9) < 1e-7));
  await outside();
  await points.nth(1).locator('.point-value-number').click({ button: 'right' });
  await frame.getByText('Copy Point', { exact: true }).click();
  await points.nth(1).locator('.point-value-number').click({ button: 'right' });
  await frame.getByText('Paste Point', { exact: true }).click();
  check('the complete point and dynamic budget are copied', await until(() => saved().testPoints.length === 3));
  await points.last().locator('.point-value-number').click();
  await points.last().locator('input.sidebar-inline-input.value').fill('7');
  await points.last().locator('input.sidebar-inline-input.value').press('Enter');
  await equationRow.locator('.dynamic-tolerance-cell button').click();
  check('editing the copied point updates the expanded binding to 7 F', await equationRow.locator('.dynamic-bound-value').innerText() === '7 °F');
  check('edited copy recalculates uncertainty to 0.7 F', await until(() => Math.abs(saved().testPoints.at(-1).combined_uncertainty_absolute_base - .7 * 5 / 9) < 1e-7));
  check('source and first destination keep their own nominals', saved().testPoints.slice(0, 2).map(point => Number(point.testPointInfo.parameter.value)).join(',') === '1,4');
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/copied-equation.png` });
  await outside();
  await frame.getByRole('button', { name: 'Add component to budget', exact: true }).last().click();
  await frame.getByRole('button', { name: 'Add tabular component', exact: true }).click();
  const tableRow = frame.locator('.budget-dynamic-row').last();
  check('new tabular entry starts at the current measurement point', await frame.getByLabel('Measurement point row 1', { exact: true }).inputValue() === '7');
  await frame.getByLabel('Uncertainty row 1', { exact: true }).fill('.2');
  await frame.getByTitle('Asymmetric tolerance', { exact: true }).last().click();
  await frame.getByTitle('Symmetric tolerance', { exact: true }).last().click();
  await frame.getByLabel('Uncertainty row 1', { exact: true }).press('Enter');
  check('Enter retains the authored tabular error limit before distribution is selected', await tableRow.locator('.dynamic-tolerance-cell button').innerText() === '± 0.2 °F');
  check('a collapsed incomplete component has no selection stripe', await tableRow.evaluate(row => !row.classList.contains('is-editing') && getComputedStyle(row).boxShadow === 'none'));
  await tableRow.getByRole('button', { name: 'Edit error limit distribution', exact: true }).click();
  check('distribution editing activates the row highlight', await tableRow.evaluate(row => row.classList.contains('is-editing') && getComputedStyle(row).boxShadow !== 'none'));
  await frame.getByLabel('Error limit distribution', { exact: true }).selectOption('2.000');
  check('tabular value and distribution persist together', await until(() => {
    const definition = saved().dynamicBudgetDefinitions.find(d => d.kind === 'table');
    return definition?.distribution === '2.000' && Number(definition.rows[0].values[definition.columns[0].id].value) === .2;
  }));
  check('tabular standard uncertainty uses the selected distribution', await tableRow.locator('.budget-standard-uncertainty').innerText() === '± 0.1 °F');
  await tableRow.locator('.dynamic-tolerance-cell button').click();
  await frame.getByLabel('Uncertainty row 1', { exact: true }).fill('.4');
  await outside();
  check('collapsing saves the updated tabular error limit', await tableRow.locator('.dynamic-tolerance-cell button').innerText() === '± 0.4 °F');
  await selectPoint(points.first());
  await selectPoint(points.last());
  check('reopening the point retains the saved tabular error limit', await tableRow.locator('.dynamic-tolerance-cell button').innerText() === '± 0.4 °F');
  check('reopening retains the recalculated tabular standard uncertainty', await tableRow.locator('.budget-standard-uncertainty').innerText() === '± 0.2 °F');
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/saved-tabular-limit.png` });
  for (const [index, kind] of ['equation', 'tabular'].entries()) {
    const row = frame.locator('.budget-dynamic-row').nth(index);
    await row.locator(':scope > td').nth(3).click();
    check(`${kind} collapsed row opens from a non-input cell`, await row.evaluate(row => row.classList.contains('is-editing') && Boolean(row.querySelector('.dynamic-budget-editor'))));
    check(`${kind} active editor has the edit stripe`, await row.evaluate(row => getComputedStyle(row).boxShadow !== 'none'));
    check(`${kind} preview uses the temperature symbol`, await row.locator('.dynamic-editor-preview').innerText().then(text => text.includes('°F') && !text.includes('degF')));
    if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/${kind}-row-editing.png` });
    await outside();
    await row.locator('.dynamic-budget-editor').waitFor({ state: 'hidden' });
    check(`${kind} edit stripe clears on collapse`, await row.evaluate(row => getComputedStyle(row).boxShadow === 'none'));
  }
}
