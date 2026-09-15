// Optional full-HTML regression fixture for point-specific tolerance/component
// behavior. All data is served by smoke-forge-srcdoc's in-memory SharePoint API.
export function prepareFeedbackSession(session) {
  session.testPoints[0].testPointInfo.parameter.value = 3000;
  const second = structuredClone(session.testPoints[0]);
  second.id = 'point-two'; second.testPointInfo.parameter.value = 4000;
  session.testPoints.push(second);
  const term = (high, unit) => ({ high, low: -high, unit, symmetric: true, distribution: '1.732' });
  const tolerance = { whicheverIsGreater: true, reading: term(1, '%'), floor: term(35, 'V') };
  for (const kind of ['uuts', 'tmdes']) Object.assign(session[kind][0].ranges[0], { max: 5000, tolerances: tolerance });
  session.testPoints.forEach(p => { p.uutTolerance = { ...p.uutTolerance, ...tolerance, max: 5000 }; });
  const amps = structuredClone(session.tmdes[0]);
  amps.id = 'amps'; amps.description = 'Current reference';
  amps.instrument.model = 'AMP'; amps.instrument.description = 'Current reference';
  amps.ranges = [{ id: 'amp-range', min: 0, max: 5000, unit: 'A', tolerances: { floor: term(1, 'A') } }];
  session.tmdes.push(amps);
}

export async function checkTaskingFeedback({ frame, page, saved, until, check }) {
  page.setDefaultTimeout(10000);
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const points = frame.locator('.point-grid-item');
  await points.first().click();
  const uutTolerance = frame.locator('.instrument-equipment-table').first().locator('.cell-tolerance').first();
  check('collapsed UUT shows the winning term', await uutTolerance.innerText().then(t => t.includes('35 V') && !t.includes('whichever')));
  const openPicker = () => frame.getByRole('button', { name: 'Add component to budget', exact: true }).last().click();
  const outside = () => frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  await openPicker();
  check('picker preserves the complete alternatives', await frame.locator('.budget-tmde-picker-menu').innerText().then(t => t.includes('whichever is greater')));
  check('picker specifications wrap without truncation', await frame.locator('.budget-tmde-picker-detail').evaluateAll(nodes => nodes.every(n =>
    getComputedStyle(n).whiteSpace === 'normal' && n.scrollWidth <= n.clientWidth + 1)));
  check('mismatched unit is offered with a warning', await frame.locator('.budget-tmde-picker-menu [aria-label*="Unit mismatch"]').count() > 0);
  await frame.getByRole('button', { name: 'Add tabular uncertainty', exact: true }).click();
  check('dynamic source name stays collapsed while its limit editor opens', await frame.getByRole('button', { name: 'Edit error source name', exact: true }).innerText() === 'Not Set');
  check('dynamic editor inherits measurement units without a selector', await frame.getByRole('button', { name: 'Measurement unit', exact: true }).count() === 0);
  await frame.getByRole('button', { name: 'Edit error source name', exact: true }).click();
  await frame.getByLabel('Error source name', { exact: true }).fill('Tabular verification');
  await frame.getByLabel('Measurement point row 1', { exact: true }).fill('3000');
  await frame.getByLabel('Uncertainty row 1', { exact: true }).fill('3');
  await frame.getByLabel('Uncertainty row 1', { exact: true }).press('Tab');
  await frame.getByLabel('Measurement point row 2', { exact: true }).fill('4000');
  await frame.getByLabel('Uncertainty row 2', { exact: true }).fill('4');
  check('standard uncertainty waits for a distribution', await frame.locator('.dynamic-editor-preview').innerText().then(t => t.includes('distribution')));
  await frame.getByTitle('Asymmetric tolerance', { exact: true }).last().click();
  check('asymmetric tabular limits expose Low and High', await frame.getByLabel('Low row 1', { exact: true }).inputValue() === '-3' && await frame.getByLabel('High row 1', { exact: true }).inputValue() === '3');
  await frame.getByTitle('Symmetric tolerance', { exact: true }).last().click();
  await frame.getByRole('button', { name: 'Edit error limit distribution', exact: true }).click();
  await frame.getByLabel('Error limit distribution', { exact: true }).selectOption('1.000');
  await frame.locator('.budget-dynamic-row').last().locator('.budget-source-cell').scrollIntoViewIfNeeded();
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/tabular-editor.png` });
  await outside();
  await until(() => saved().dynamicBudgetDefinitions?.[0]?.rows.length === 2);
  check('table collapses to the 3000-point entry', await frame.locator('.budget-dynamic-row').innerText().then(t => t.includes('3 V') && !t.includes('Not Set')));
  await frame.getByRole('button', { name: 'Edit error limit distribution', exact: true }).click();
  await frame.getByLabel('Error limit distribution', { exact: true }).selectOption('1.732');
  check('distribution changes and is saved', await until(() => saved().dynamicBudgetDefinitions[0].mode === 'tolerance' && saved().dynamicBudgetDefinitions[0].distribution === '1.732'));
  await openPicker();
  await frame.getByRole('button', { name: 'Add equation uncertainty', exact: true }).click();
  await frame.getByRole('button', { name: 'Edit error source name', exact: true }).last().click();
  await frame.getByLabel('Error source name', { exact: true }).fill('Equation verification');
  await frame.getByLabel('Uncertainty equation', { exact: true }).fill('x/1000');
  await frame.getByRole('button', { name: 'Edit error limit distribution', exact: true }).last().click();
  await frame.getByLabel('Error limit distribution', { exact: true }).selectOption('1.000');
  await frame.locator('.budget-dynamic-row').last().locator('.budget-source-cell').scrollIntoViewIfNeeded();
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/equation-editor.png` });
  await outside();
  await until(() => saved().testPoints[0].components.filter(c => c.dynamicDefinitionId).length === 2);
  await points.first().locator('.point-value-number').click({ button: 'right' });
  await frame.getByText('Copy Budget', { exact: true }).click();
  await points.nth(1).locator('.point-value-number').click({ button: 'right' });
  await frame.getByText('Paste Budget', { exact: true }).click();
  check('copied budget retains both shared definitions', await until(() => saved().testPoints[1].components?.filter(c => c.dynamicDefinitionId).length === 2));
  await points.nth(1).locator('.point-value-number').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const rows = frame.locator('.budget-dynamic-row');
  check('both copied components evaluate at 4000', await rows.count() === 2 && (await rows.allTextContents()).every(t => t.includes('4 V') && !t.includes('Not Set')));
  check('source point stays at 3000', String(saved().testPoints[0].testPointInfo.parameter.value) === '3000');
  check('UUT winner changes to one percent at 4000', await uutTolerance.innerText().then(t => t.includes('1% IV') && !t.includes('whichever')));
  const borders = await points.nth(1).evaluate(p => [p.querySelector('.point-value-number'), p.querySelector('.point-unit-select')].map(n => getComputedStyle(n).borderTopWidth));
  check('value and unit have separate borders', borders.every(v => v === '1px'));
  check('unit label fits inside its own input', await points.nth(1).locator('.point-unit-select').evaluate(select => {
    const style = getComputedStyle(select), canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    context.font = style.font;
    return context.measureText(select.selectedOptions[0].text).width <= select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  }));
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) {
    await frame.evaluate(() => document.body.classList.add('dark-mode'));
    await page.waitForTimeout(200);
    await rows.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/budgets.png` });
  }
  await openPicker();
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/picker.png` });
  await frame.locator('.budget-tmde-picker-range').filter({ has: frame.locator('[aria-label*="Unit mismatch"]') }).first().click();
  check('mismatched source is persisted', await until(() => saved().testPoints[1].components.some(c => c.tmdeBudgetSourceId === 'amps')));
  await outside();
  check('budget displays the unit warning', await frame.locator('.budget-pending-uncertainty[aria-label*="Unit mismatch"]').count() > 0);
}
