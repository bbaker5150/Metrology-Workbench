export function prepareBiasSession(session) {
  session.measurementAreaGroups.forEach(area => { area.pointCreationSettings = { ...area.pointCreationSettings, showBias: true }; });
  const uut = session.uuts[0], tmde = session.tmdes[0];
  uut.ranges[0].tolerances = { floor: { high: 2, low: -2, unit: 'V', distribution: '1.732' }, bias: { value: .1, unit: 'V' } };
  tmde.ranges[0].tolerances = { floor: { high: .2, low: -.2, unit: 'V', distribution: '1.732' }, bias: { value: .05, unit: 'V' } };
  session.uncReq = { uncertaintyConfidence: 95, reliability: 85, measRelCalcAssumed: 85, reqPFA: 2, calInt: 12, neededTUR: 4 };
  session.testPoints[0].uutTolerance = { ...session.testPoints[0].uutTolerance, ...uut.ranges[0].tolerances };
  session.testPoints[0].components = [{ id: 'meter-bias', name: 'Reference meter', type: 'B', tmdeBudgetSourceId: tmde.id, tmdeBudgetRangeId: tmde.ranges[0].id, tmdeBudgetComponentKind: 'Accuracy' }];
  // Exercise imported overrides only in this smoke; other feature fixtures use
  // instrument-owned defaults. Opening the old point must not change its math.
  if (process.env.MEASUREMENT_BIAS_SMOKE) {
    Object.assign(session, { name: 'Smoke', organization: 'Lab', analyst: 'A', document: 'D', documentDate: '2026-09-17' });
    Object.assign(session.testPoints[0], { measurementType: 'derived', equationString: 'a', variableMappings: { a: 'Voltage' },
      variableNominals: { a: { value: 5, unit: 'V' } } });
    session.testPoints[0].components[0].variableType = 'Voltage';
    session.testPoints[0].uutBias = { mode: 'override', value: -.2, unit: 'V' };
    session.testPoints[0].measurementBias = { mode: 'manual', value: .15, unit: 'V' };
  }
}

export async function checkMeasurementBias({ frame, page, saved, until, check }) {
  const info = frame.getByRole('button', { name: 'Session Info', exact: true });
  if (await info.getAttribute('aria-expanded') === 'false') await info.click();
  const sizes = await frame.locator('.session-info-content > .session-field-size, .session-header-grid .session-field-size').evaluateAll(nodes => nodes.map(node => node.offsetWidth));
  check('Session metadata retains compact default field widths', sizes.length === 5 && sizes.every(width => Math.abs(width - sizes[0]) < 1), JSON.stringify(sizes));
  const geometry = locator => locator.evaluate(node => { const r = node.getBoundingClientRect(), s = getComputedStyle(node); return { x:r.x, y:r.y, width:r.width, height:r.height, font:s.font }; });
  for (const [label, longText, initial] of [['Session Name', 'Torque calibration laboratory and reference setup', 'Smoke'], ['Organization', 'Measurement standards laboratory long name', 'Lab']]) {
    const row = label === 'Session Name' ? frame.locator('.session-field-size--name') : frame.locator('.session-header-field').filter({ has: frame.locator('.session-header-label > span', { hasText: label }) });
    await row.locator('.session-header-value').scrollIntoViewIfNeeded();
    const before = await geometry(row.locator('.session-header-value'));
    await row.locator('.session-header-value').click();
    const input = row.locator('input');
    const after = await geometry(input);
    check(`${label} focus preserves size, position and typography`, JSON.stringify(before) === JSON.stringify(after), JSON.stringify({before,after}));
    await input.fill(longText);
    check(`${label} grows to show all entered text`, await input.evaluate(node => { const s=getComputedStyle(node), ctx=document.createElement('canvas').getContext('2d'); ctx.font=s.font; return node.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)-20 >= ctx.measureText(node.value).width; }) && (await geometry(input)).width > before.width);
    await input.fill(initial); await input.press('Enter');
    check(`${label} returns to its compact width`, Math.abs((await geometry(row.locator('.session-header-value'))).width - before.width) < 1);
  }
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
  check('explicit reset clears both retired point overrides through the SharePoint adapter', await until(() => saved().testPoints[0].uutBias === null && saved().testPoints[0].measurementBias === null));
  check('instrument biases need no separate panel or notice', await until(async () => await notice.count() === 0) && await frame.locator('.measurement-bias-panel').count() === 0);
  check('risk recalculates after returning to instrument defaults', await until(async () => JSON.stringify(await cards.allTextContents()) !== JSON.stringify(riskBeforeReset)));

  // Author both roles in their existing instrument cells, then verify changes
  // reach the current point's risk results without a navigation-triggered refresh.
  const tmde = frame.locator('.instrument-equipment-table').nth(1);
  await tmde.locator('.cell-tolerance .inline-tolerance-summary').first().click();
  check('Configured TMDE bias opens its dedicated editor', await frame.getByRole('textbox', { name: 'Range source bias', exact: true }).count() === 1);
  const biasToggle = tmde.getByRole('button', { name: 'Bias', exact: true });
  check('Bias toggle uses the same compact styling as DS/SS', await biasToggle.evaluate(button => button.parentElement.classList.contains('inline-tolerance-mini-toggle')) && await biasToggle.getAttribute('aria-pressed') === 'true');
  check('Bias displays beneath tolerance terms without a correction checkbox', await tmde.locator('.inline-tolerance-term-group').count() > 0 && await tmde.locator('.inline-tolerance-footer').count() === 1 && await tmde.getByRole('checkbox', { name: 'Already corrected' }).count() === 0);
  const sourceInput = frame.getByRole('textbox', { name: 'Range source bias', exact: true });
  const riskBeforeSource = await cards.allTextContents();
  await sourceInput.fill('-.8');
  await sourceInput.press('Enter');
  check('TMDE range bias saves in its error-limit column', await until(() => saved().tmdes[0].ranges[0].tolerances.bias?.value === '-.8'));
  check('current point risk picks up the changed TMDE bias', await until(async () => JSON.stringify(await cards.allTextContents()) !== JSON.stringify(riskBeforeSource)));
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
  await biasToggle.click();
  check('clicking Bias again removes its saved value and hides its inputs', await until(() => !saved().tmdes[0].ranges[0].tolerances.bias) && await sourceInput.count() === 0 && await biasToggle.getAttribute('aria-pressed') === 'false');
  // Restore the absolute source offset for the percent-equivalence cases below.
  // Bias off now intentionally deletes the value instead of merely hiding it.
  await biasToggle.click();
  await sourceInput.fill('-.8'); await sourceInput.press('Enter');
  check('re-enabled source bias saves the absolute comparison value', await until(() => saved().tmdes[0].ranges[0].tolerances.bias?.value === '-.8'));
  const tolerance = frame.locator('.instrument-equipment-table').first().locator('.cell-tolerance .inline-tolerance-summary').first();
  await tolerance.click();
  check('Configured UUT bias reopens active', await frame.locator('.instrument-equipment-table').first().getByRole('button', { name: 'Bias', exact: true }).getAttribute('aria-pressed') === 'true');
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/measurement-bias-range.png` });
  const rangeBias = frame.getByRole('textbox', { name: 'Range UUT bias', exact: true });
  const riskBeforeUut = await cards.allTextContents();
  await rangeBias.fill('.3');
  await rangeBias.press('Enter');
  check('UUT range bias saves through instrument inline editing', await until(() => saved().uuts[0].ranges[0].tolerances.bias?.value === '.3'));
  check('current point risk picks up the changed UUT range bias', await until(async () => JSON.stringify(await cards.allTextContents()) !== JSON.stringify(riskBeforeUut)));
  check('editing instrument biases does not create point overrides or a menu', saved().testPoints[0].uutBias == null && saved().testPoints[0].measurementBias == null && await frame.locator('.measurement-bias-panel,.legacy-point-bias-notice').count() === 0);
  // Independent equivalence in the shipped HTML: UUT h=2 V, regardless of the
  // 5 V nominal or the TMDE's own .2 V error limit. Percent mode is workbook K/L.
  const absoluteCards = JSON.stringify(await cards.allTextContents());
  await rangeBias.fill('15'); await rangeBias.press('Enter');
  await frame.getByRole('button', { name: 'Range UUT bias units', exact: true }).click();
  await frame.getByRole('option', { name: '%', exact: true }).click();
  check('UUT percentage selection persists', await until(() => saved().uuts[0].ranges[0].tolerances.bias.kind === 'percent'));
  await page.waitForTimeout(600);
  check('15% UUT bias equals .3 V for h=2 V in built HTML', await until(async () => JSON.stringify(await cards.allTextContents()) === absoluteCards));
  const tmdeSummary = tmde.locator('.cell-tolerance .inline-tolerance-summary').first();
  if (await tmdeSummary.count()) await tmdeSummary.click();
  if (!await sourceInput.count()) await tmde.getByRole('button', { name: 'Bias', exact: true }).click();
  await sourceInput.fill('-40'); await sourceInput.press('Enter');
  await frame.getByRole('button', { name: 'Range source bias units', exact: true }).click();
  await frame.getByRole('option', { name: '%', exact: true }).click();
  check('source percentage selection persists', await until(() => saved().tmdes[0].ranges[0].tolerances.bias.kind === 'percent'));
  await page.waitForTimeout(600);
  check('-40% cal bias equals -.8 V using final UUT tolerance in built HTML', await until(async () => JSON.stringify(await cards.allTextContents()) === absoluteCards));
  await tmde.getByRole('button', { name: 'Bias', exact: true }).click();
  const uutTable = frame.locator('.instrument-equipment-table').first();
  await uutTable.locator('.cell-tolerance .inline-tolerance-summary').first().click();
  await uutTable.getByRole('button', { name: 'Bias', exact: true }).click();
  await page.keyboard.press('Escape');
  const onlyPoint = frame.locator('.point-grid-item');
  check('clipboard regression fixture contains one point', saved().testPoints.length === 1);
  await onlyPoint.locator('[data-sidebar-column="pfa"]').click();
  await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
  check('one selected point copies and pastes after instrument editing', await until(() => saved().testPoints.length === 2));

}
