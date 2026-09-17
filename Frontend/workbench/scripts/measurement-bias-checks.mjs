export function prepareBiasSession(session) {
  const uut = session.uuts[0], tmde = session.tmdes[0];
  uut.ranges[0].tolerances = { floor: { high: 2, low: -2, unit: 'V', distribution: '1.732' }, bias: { value: .1, unit: 'V' } };
  tmde.ranges[0].tolerances = { floor: { high: .2, low: -.2, unit: 'V', distribution: '1.732' }, bias: { value: .05, unit: 'V' } };
  session.uncReq = { uncertaintyConfidence: 95, reliability: 85, measRelCalcAssumed: 85, reqPFA: 2, calInt: 12, neededTUR: 4 };
  session.testPoints[0].uutTolerance = { ...session.testPoints[0].uutTolerance, ...uut.ranges[0].tolerances };
  session.testPoints[0].components = [{ id: 'meter-bias', name: 'Reference meter', type: 'B', tmdeBudgetSourceId: tmde.id, tmdeBudgetRangeId: tmde.ranges[0].id, tmdeBudgetComponentKind: 'Accuracy' }];
  // Exercise imported overrides only in this smoke; other feature fixtures use
  // instrument-owned defaults. Opening the old point must not change its math.
  if (process.env.MEASUREMENT_BIAS_SMOKE) {
    session.testPoints[0].uutBias = { mode: 'override', value: -.2, unit: 'V' };
    session.testPoints[0].measurementBias = { mode: 'manual', value: .15, unit: 'V' };
  }
}

export async function checkMeasurementBias({ frame, page, saved, until, check }) {
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  await frame.locator('.point-grid-item').first().click();
  const notice = frame.locator('.legacy-point-bias-notice');
  await notice.waitFor();
  check('legacy bias is visible without an authoring menu', /UUT: -0.2 V · System: \+0.15 V/.test(await notice.innerText()) && await frame.locator('.measurement-bias-panel').count() === 0);
  check('opening the point preserves saved bias overrides', saved().testPoints[0].uutBias.value === -.2 && saved().testPoints[0].measurementBias.value === .15);
  const cards = frame.locator('.budget-decision-card dd[aria-label]');
  check('both risk cards are populated before bias edits', await until(async () => (await cards.count()) === 2 && !(await cards.allTextContents()).some(text => /Unavailable/.test(text))));
  const riskBeforeReset = await cards.allTextContents();
  await notice.getByRole('button', { name: 'Use instrument biases', exact: true }).click();
  check('explicit reset clears overrides through the SharePoint adapter', await until(() => saved().testPoints[0].uutBias === null && saved().testPoints[0].measurementBias === null));
  check('instrument biases need no separate panel or notice', await until(async () => await notice.count() === 0) && await frame.locator('.measurement-bias-panel').count() === 0);
  check('risk recalculates after returning to instrument defaults', await until(async () => JSON.stringify(await cards.allTextContents()) !== JSON.stringify(riskBeforeReset)));

  // Author both roles in their existing instrument cells, then verify changes
  // reach the current point's risk results without a navigation-triggered refresh.
  const tmde = frame.locator('.instrument-equipment-table').nth(1);
  await tmde.locator('.cell-tolerance .inline-tolerance-summary').first().click();
  const sourceInput = frame.getByRole('textbox', { name: 'Range source bias', exact: true });
  const riskBeforeSource = await cards.allTextContents();
  await sourceInput.fill('-.8');
  await sourceInput.press('Enter');
  check('TMDE range bias saves in its error-limit column', await until(() => saved().tmdes[0].ranges[0].tolerances.bias?.value === '-.8'));
  check('current point risk picks up the changed TMDE bias', await until(async () => JSON.stringify(await cards.allTextContents()) !== JSON.stringify(riskBeforeSource)));
  const biasedRisk = await cards.allTextContents();
  await tmde.getByRole('checkbox', { name: 'Already corrected', exact: true }).check();
  check('corrected flag persists on the TMDE range', await until(() => saved().tmdes[0].ranges[0].tolerances.bias?.corrected === true));
  check('corrected source changes risk without removing its uncertainty component', await until(async () => JSON.stringify(await cards.allTextContents()) !== JSON.stringify(biasedRisk)) && saved().testPoints[0].components.length === 1);
  await tmde.getByRole('checkbox', { name: 'Already corrected', exact: true }).uncheck();
  check('restoring the source restores its biased risk', await until(async () => JSON.stringify(await cards.allTextContents()) === JSON.stringify(biasedRisk)));
  const panel = tmde.locator('.instrument-bias-editor');
  for (const theme of ['light', 'dark']) {
    await frame.evaluate(theme => { document.body.classList.remove('light-mode', 'dark-mode'); document.body.classList.add(`${theme}-mode`); }, theme);
    await panel.scrollIntoViewIfNeeded();
    check(`${theme} bias controls stay inside the instrument cell`, await panel.evaluate(panel => {
      const bounds = panel.getBoundingClientRect();
      return [...panel.querySelectorAll('input,button')].every(input => { const rect = input.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right; });
    }));
    check(`${theme} bias inputs use compact inline sizing`, await panel.locator('.bias-value-input').evaluateAll(inputs => inputs.every(input => input.getBoundingClientRect().height <= 26)));
    if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/measurement-bias-${theme}.png` });
  }
  await frame.evaluate(() => { document.body.classList.remove('dark-mode'); document.body.classList.add('light-mode'); });
  const tolerance = frame.locator('.instrument-equipment-table').first().locator('.cell-tolerance .inline-tolerance-summary').first();
  await tolerance.click();
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/measurement-bias-range.png` });
  const rangeBias = frame.getByRole('textbox', { name: 'Range UUT bias', exact: true });
  const riskBeforeUut = await cards.allTextContents();
  await rangeBias.fill('.3');
  await rangeBias.press('Enter');
  check('UUT range bias saves through instrument inline editing', await until(() => saved().uuts[0].ranges[0].tolerances.bias?.value === '.3'));
  check('current point risk picks up the changed UUT range bias', await until(async () => JSON.stringify(await cards.allTextContents()) !== JSON.stringify(riskBeforeUut)));
  check('editing instrument biases does not create point overrides or a menu', saved().testPoints[0].uutBias == null && saved().testPoints[0].measurementBias == null && await frame.locator('.measurement-bias-panel,.legacy-point-bias-notice').count() === 0);
}
