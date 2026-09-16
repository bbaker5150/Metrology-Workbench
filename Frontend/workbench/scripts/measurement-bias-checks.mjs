export function prepareBiasSession(session) {
  const uut = session.uuts[0], tmde = session.tmdes[0];
  uut.ranges[0].tolerances = { floor: { high: 2, low: -2, unit: 'V', distribution: '1.732' }, bias: { value: .1, unit: 'V' } };
  tmde.ranges[0].tolerances = { floor: { high: .2, low: -.2, unit: 'V', distribution: '1.732' }, bias: { value: .05, unit: 'V' } };
  session.uncReq = { uncertaintyConfidence: 95, reliability: 85, measRelCalcAssumed: 85, reqPFA: 2, calInt: 12, neededTUR: 4 };
  session.testPoints[0].uutTolerance = { ...session.testPoints[0].uutTolerance, ...uut.ranges[0].tolerances };
  session.testPoints[0].components = [{ id: 'meter-bias', name: 'Reference meter', type: 'B', tmdeBudgetSourceId: tmde.id, tmdeBudgetRangeId: tmde.ranges[0].id, tmdeBudgetComponentKind: 'Accuracy' }];
}

export async function checkMeasurementBias({ frame, page, saved, until, check }) {
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  await frame.locator('.point-grid-item').first().click();
  const panel = frame.locator('.measurement-bias-panel');
  await panel.waitFor();
  check('bias settings start collapsed', !(await panel.getAttribute('open')) && await panel.getAttribute('open') !== '');
  await panel.locator('summary').click();
  check('bias summary inherits UUT and TMDE range defaults', /UUT: \+0.1 V · System: \+0.05 V/.test(await panel.locator('summary').innerText()));
  const choose = async (label, option) => {
    await frame.getByRole('button', { name: label, exact: true }).click();
    await frame.getByRole('option', { name: option, exact: true }).click();
  };
  const sourceInput = panel.locator('.measurement-bias-source .bias-value-input').first();
  await sourceInput.fill('-.08');
  await sourceInput.press('Enter');
  check('source override persists through SharePoint adapter', await until(() => Object.values(saved().testPoints[0].measurementBias?.sources || {}).some(spec => spec.value === '-.08')));
  await panel.getByRole('checkbox', { name: 'Already corrected', exact: true }).check();
  check('already-corrected source is excluded from system bias', /System: 0 V/.test(await panel.locator('summary').innerText()));
  await choose('UUT bias source', 'This point');
  await panel.getByRole('textbox', { name: 'Point UUT bias', exact: true }).fill('-.2');
  await panel.getByRole('textbox', { name: 'Point UUT bias', exact: true }).press('Enter');
  check('UUT point override persists separately', await until(() => saved().testPoints[0].uutBias?.value === '-.2'));
  await choose('Measurement system bias source', 'Enter net bias');
  await panel.getByRole('textbox', { name: 'Net measurement system bias', exact: true }).fill('.15');
  await panel.getByRole('textbox', { name: 'Net measurement system bias', exact: true }).press('Enter');
  check('net system bias persists in native units', await until(() => saved().testPoints[0].measurementBias?.value === '.15'));
  await choose('Measurement system bias source', 'From budget sources');
  await panel.getByRole('button', { name: 'Use source default', exact: true }).click();
  check('clearing override resumes the shared range bias', /System: \+0.05 V/.test(await panel.locator('summary').innerText()));
  for (const theme of ['light', 'dark']) {
    await frame.evaluate(theme => { document.body.classList.remove('light-mode', 'dark-mode'); document.body.classList.add(`${theme}-mode`); }, theme);
    await panel.scrollIntoViewIfNeeded();
    check(`${theme} bias controls stay inside the panel`, await panel.evaluate(panel => {
      const bounds = panel.getBoundingClientRect();
      return [...panel.querySelectorAll('input,button')].every(input => { const rect = input.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right; });
    }));
    check(`${theme} bias inputs use compact inline sizing`, await panel.locator('.bias-value-input').evaluateAll(inputs => inputs.every(input => input.getBoundingClientRect().height <= 26)));
    if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/measurement-bias-${theme}.png` });
  }
  await frame.evaluate(() => { document.body.classList.remove('dark-mode'); document.body.classList.add('light-mode'); });
  await choose('UUT bias source', 'Use UUT range');
  await frame.locator('[data-tour="tab-overview"]').click();
  const tolerance = frame.locator('.instrument-equipment-table').first().locator('.cell-tolerance .inline-tolerance-summary').first();
  await tolerance.click();
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/measurement-bias-range.png` });
  const rangeBias = frame.getByRole('textbox', { name: 'Range UUT bias', exact: true });
  await rangeBias.fill('.3');
  await rangeBias.press('Enter');
  check('UUT range bias saves through instrument inline editing', await until(() => saved().uuts[0].ranges[0].tolerances.bias?.value === '.3'));
  await frame.locator('.point-grid-item').first().click();
  check('open budget picks up changed UUT range bias', await until(() => (saved().testPoints[0].uutTolerance?.bias || saved().testPoints[0].uutTolerance?.tolerances?.bias)?.value === '.3') && /UUT: \+0.3 V/.test(await frame.locator('.measurement-bias-panel summary').innerText()));
}
