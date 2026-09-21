import { prepareSeptember21, checkSeptember21 } from './september21-checks.mjs';
export function prepareSeptember21Followup(session) {
  prepareSeptember21(session);
  session.uuts = session.uuts.filter(item => item.id !== 'fresh-uut');
  session.tmdes[0].ranges[0].tolerances.bias = { value: .01, unit: 'V' };
  session.testPoints.push({ ...structuredClone(session.testPoints[0]), id: 'override-point', riskRequirements: { reqPFA: 3 } });
  session.instrumentCustomColumns = { uut: [{ key: 'audit-a', label: 'Audit A', insertAfter: 'description' }, { key: 'audit-b', label: 'Audit B', insertAfter: 'custom:audit-a' }] };
  session.uuts[0].customFields = { 'audit-a': 'First', 'audit-b': 'Second' };
}

export async function checkSeptember21Followup(context) {
  const { frame, page, saved, until, check } = context;
  await page.setViewportSize({ width: 1600, height: 1050 });
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const point = frame.locator('[data-point-id="point"]');
  await point.locator('[data-sidebar-column="pfa"]').click();
  const inputs = frame.locator('.measurement-inputs-table');
  const output = inputs.locator('.measurement-output-row');
  const painted = locator => locator.evaluate(node => {
    const style = getComputedStyle(node); const box = node.getBoundingClientRect();
    return Number(style.opacity) > .5 && style.visibility === 'visible' && box.width > 0 && box.height > 0;
  });
  const add = frame.getByRole('button', { name: 'Add Net Bias', exact: true });
  await add.scrollIntoViewIfNeeded();
  check('net-bias add control is visibly painted and enabled', await painted(add) && await add.isEnabled());
  check('instrument source bias does not force a Bias column', await inputs.locator('thead th').count() === 3);
  check('output symbol and nominal are read-only; Name remains editable', await output.locator('td').nth(0).locator('button,input').count() === 0 && await output.locator('td').nth(2).locator('button,input').count() === 0 && await output.getByRole('button', { name: 'Edit name for equation variable output' }).count() === 1);
  await output.getByRole('button', { name: 'Edit name for equation variable output' }).click();
  const outputName = frame.getByRole('textbox', { name: 'Display name for equation variable output' });
  await outputName.fill('Measured voltage'); await outputName.press('Tab');
  check('output Name persists without altering point nominal or RHS names', await until(() => saved().testPoints[0].outputQuantityName === 'Measured voltage') && saved().testPoints[0].testPointInfo.parameter.value === '5' && saved().testPoints[0].variableMappings.a === 'Voltage');
  await add.click();
  const remove = frame.getByRole('button', { name: 'Remove Net Bias', exact: true });
  await remove.scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  check('net-bias delete control is visible without hover', await painted(remove));
  check('adding Bias creates exactly one editor and disables duplicate addition', await inputs.locator('thead th').count() === 4 && await output.locator('.bias-value-editor').count() === 1 && await add.isDisabled());
  await frame.getByRole('button', { name: 'Input bias display', exact: true }).click();
  check('Bias retains all three display options', JSON.stringify(await frame.locator('.inline-unit-menu [role="option"] > span').allTextContents()) === JSON.stringify(['Bias', 'Bias %', 'Nominal + Bias']));
  await frame.getByRole('option', { name: 'Bias', exact: true }).click();
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/followup-inputs.png` });
  await remove.click();
  check('removing Bias hides its column and re-enables addition despite source biases', await until(async () => await inputs.locator('thead th').count() === 3 && await add.isEnabled()));

  const results = frame.locator('.budget-results-zoom-surface').first();
  check('100% Results scale retains compact 80% physical geometry', await results.evaluate(node => node.dataset.zoomLevel === '1' && node.querySelector('.scoped-zoom-content').style.zoom === '0.8'));
  await frame.locator('body').evaluate(() => localStorage.setItem('workbench:ui-scale-lock', 'false'));
  await results.evaluate(node => node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 })));
  check('Results scaling uses the new baseline', await until(async () => await results.evaluate(node => node.dataset.zoomLevel === '1.1' && node.querySelector('.scoped-zoom-content').style.zoom === '0.88')));
  await results.evaluate(node => node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 100 })));

  // Default and overridden values must differ visually and numerically.
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  await frame.getByRole('button', { name: 'Add PFA Required column', exact: true }).click();
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  const inherited = point.locator('[data-sidebar-column="input_reqPFA"]');
  const overridden = frame.locator('[data-point-id="override-point"] [data-sidebar-column="input_reqPFA"]');
  check('default point inputs are grey/italic and overrides are regular', await inherited.locator('.point-value-number').evaluate(node => getComputedStyle(node).fontStyle === 'italic') && await overridden.locator('.point-value-number').evaluate(node => getComputedStyle(node).fontStyle === 'normal') && await inherited.locator('.point-value-number').evaluate(node => getComputedStyle(node).color) !== await overridden.locator('.point-value-number').evaluate(node => getComputedStyle(node).color));
  const defaults = frame.locator('[aria-label="Default Mitigation Inputs"]');
  const pfaDefault = defaults.locator('.session-header-field').filter({ has: frame.locator('.session-header-label > span', { hasText: /^PFA Required$/ }) });
  await pfaDefault.locator('.session-header-value').click();
  await pfaDefault.getByRole('textbox').fill('4'); await pfaDefault.getByRole('textbox').press('Enter');
  check('session defaults update inherited points while preserving overrides', await until(async () => await inherited.locator('.point-value-number').innerText() === '4' && await overridden.locator('.point-value-number').innerText() === '3') && saved().testPoints.find(p => p.id === 'override-point').riskRequirements.reqPFA === 3);
  await overridden.getByRole('button').click(); await overridden.getByRole('textbox').fill(''); await overridden.getByRole('textbox').press('Enter');
  check('clearing a point override restores live inheritance and italic styling', await until(async () => await overridden.locator('.point-value-number').innerText() === '4' && await overridden.locator('.point-value-number').evaluate(node => getComputedStyle(node).fontStyle === 'italic')));
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/followup-defaults.png` });
  // Collapse metadata to leave the same room as the ordinary working view.
  await frame.getByRole('button', { name: 'Session Info', exact: true }).click();

  await frame.locator('[data-tour="tab-overview"]').click();
  const uut = frame.locator('.instrument-equipment-table').first();
  const customA = uut.locator('td[data-custom-column="custom:audit-a"]').first();
  const customB = uut.locator('td[data-custom-column="custom:audit-b"]').first();
  await customA.getByRole('button').focus();
  const inputA = customA.getByRole('textbox');
  check('Tab focus opens and selects the first custom field', await inputA.evaluate(node => node === document.activeElement && node.selectionStart === 0 && node.selectionEnd === node.value.length));
  await inputA.press('Tab');
  check('Tab enters and selects the next custom field without Enter', await until(async () => await customB.getByRole('textbox').evaluate(node => node === document.activeElement && node.selectionEnd === node.value.length)));
  await customB.getByRole('textbox').fill('Updated second'); await customB.getByRole('textbox').press('Enter');
  check('custom field typing after Tab persists', await until(() => JSON.stringify(saved().uuts[0]).includes('Updated second')));

  const tmde = frame.locator('.instrument-equipment-table').nth(1);
  check('TMDE instrument header is Uncertainty', await tmde.locator('th[data-instrument-column="tolerance"]').innerText() === 'UNCERTAINTY');
  await tmde.locator('.inline-distribution-summary').first().click();
  await frame.getByRole('option', { name: /Normal \(Std\. Unc\.\)/ }).click();
  check('expanded distribution immediately displays its name', await tmde.getByRole('button', { name: 'Spec band distribution', exact: true }).innerText() === 'Normal (Std. Unc.)');
  // Restore the reference's original distribution before the earlier sheet's
  // numerical checks; k=1 intentionally presents standard uncertainty instead.
  await tmde.getByRole('button', { name: 'Spec band distribution', exact: true }).click();
  await frame.getByRole('option', { name: /^Rectangular k/ }).click();
  await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });

  // Reproduce the reported creation order: point, then UUT, then its first unit.
  const freshArea = frame.locator('.measurement-group-container').filter({ has: frame.getByRole('textbox', { name: 'Measurement area name: Fresh Area', exact: true }) });
  await freshArea.getByRole('button', { name: 'Add direct point', exact: true }).click();
  const fresh = freshArea.locator('.point-grid-item').first();
  await fresh.locator('input.sidebar-inline-input.value').fill('5'); await fresh.locator('input.sidebar-inline-input.value').press('Enter');
  const freshUnit = fresh.getByRole('combobox', { name: 'Measurement point unit', exact: true });
  check('point created before its UUT is initially unitless', await freshUnit.inputValue() === '');
  await frame.locator('[data-tour="tab-overview"]').click();
  const freshHeader = uut.locator('.instrument-area-section-row').filter({ hasText: 'Fresh Area' });
  await freshHeader.getByRole('button', { name: 'Add UUT to this measurement area' }).click();
  const row = uut.locator('tr.instrument-function-row').last();
  await row.locator('[data-range-cell] .inline-tolerance-summary').click();
  await row.getByRole('button', { name: 'Range unit base unit', exact: true }).click();
  await frame.locator('.inline-unit-search').fill('volt');
  const choices = await frame.locator('.inline-unit-menu [role="option"] > span').allTextContents();
  check('searching units offers V without prefixed V choices', choices.includes('V') && !choices.some(value => /^(mV|µV|uV|kV|MV)$/.test(value)));
  await frame.getByRole('option', { name: /^V\s+Voltage$/ }).click();
  check('first UUT unit automatically fills the pre-existing point', await until(async () => await freshUnit.inputValue() === 'V'));
  await freshUnit.selectOption('');
  check('Units remains an explicit choice after inheritance', await until(() => saved().testPoints.find(p => p.testPointInfo?.measurementArea === 'Fresh Area').testPointInfo.parameter.unitSelectionExplicit === true) && await freshUnit.inputValue() === '');

  // Preserve the earlier sheet's coverage as well as the newly reported paths.
  await checkSeptember21(context);
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.setViewportSize({ width: 800, height: 600 });
  // The Forge harness otherwise holds its iframe at 900px independently of
  // the host viewport. Exercise the app's actual narrow/short viewport too.
  await page.locator('#app').evaluate(node => { node.style.height = '600px'; });
  const menu = frame.getByRole('dialog', { name: 'Visible measurement point columns', exact: true });
  check('long column menus use full viewport height on narrow screens with no nested scrollbars', await until(async () => await menu.evaluate(node => {
    const box = node.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= innerHeight + 1 && box.height >= innerHeight - 24 &&
      [...node.querySelectorAll('.sidebar-filter-sections, .sidebar-column-order-list')].every(child => getComputedStyle(child).overflowY === 'visible');
  })));
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/followup-columns-narrow.png` });
  await menu.press('Escape');
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.locator('#app').evaluate(node => { node.style.height = '900px'; });

  await frame.getByRole('button', { name: 'Instrument builder', exact: true }).click();
  await frame.getByTitle('Create Instrument', { exact: true }).click();
  await frame.getByRole('button', { name: 'Add Function', exact: true }).click();
  const builderUnit = frame.locator('.builder-unit-select').first();
  await builderUnit.locator('.inline-unit-base-button').click();
  await frame.locator('.inline-unit-search').fill('volt');
  const builderChoices = await frame.locator('.inline-unit-menu [role="option"] > span').allTextContents();
  check('builder searches only base units', builderChoices.includes('V') && !builderChoices.some(value => /^(mV|µV|uV|kV|MV)$/.test(value)));
  await frame.getByRole('option', { name: /^V\s+Voltage$/ }).click();
  check('builder base and prefix controls share one row without overlap', await builderUnit.evaluate(node => {
    const base = node.querySelector('.inline-unit-base-button').getBoundingClientRect();
    const prefix = node.querySelector('.inline-menu-select-trigger').getBoundingClientRect();
    return Math.abs(base.top - prefix.top) < 1 && prefix.left >= base.right && prefix.right <= node.getBoundingClientRect().right + 1;
  }));
  await builderUnit.getByRole('button', { name: /unit prefix$/ }).click();
  await frame.getByRole('option', { name: /^Milli / }).click();
  check('builder displays a selected prefix beside the base unit', await builderUnit.locator('.inline-unit-base-button').innerText() === 'V' && await builderUnit.locator('.inline-menu-select-trigger').innerText() === 'm');
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/followup-builder.png` });
  await frame.locator('.modal-close-button').click();
}
