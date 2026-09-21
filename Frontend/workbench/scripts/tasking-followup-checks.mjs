export function prepareFollowupSession(session) {
  const point = structuredClone(session.testPoints[0]);
  Object.assign(point, { id: 'equation-point', measurementType: 'derived', equationString: 'a+b',
    variableMappings: { a: 'First input', b: 'Second input' },
    variableNominals: { a: { value: 2, unit: 'V' }, b: { value: 3, unit: 'V' } } });
  point.components = [0, 1].map(index => ({ id: `badge-use-${index}`, name: `Reference use ${index + 1}`, type: 'B', sourceTmdeId: session.tmdes[0].id, tmdeBudgetSourceId: session.tmdes[0].id, tmdeBudgetRangeId: session.tmdes[0].ranges[0].id, tmdeBudgetComponentKind: 'Accuracy', variableType: 'First input', value: .01, value_native: .01, unit_native: 'V', distributionDivisor: '1', isBaseUnitValue: true }));
  point.testPointInfo.parameter.value = 5;
  session.testPoints.push(point);
  const instrument = structuredClone(session.tmdes[0]);
  Object.assign(instrument, { id: 'selection', name: 'Selection reference', description: 'Selection reference', rangeId: 'sel-0' });
  instrument.instrument.model = 'Selection';
  instrument.ranges = [0,1,2,3].map(i => ({ id: `sel-${i}`, min: i, max: i, value: i, isSingleValue: true, unit: 'V', resolution: .01,
    tolerances: { floor: { high: Number((.1*(i+1)).toFixed(1)), low: -Number((.1*(i+1)).toFixed(1)), unit: 'V', symmetric: true, distribution: '1.732' } } }));
  instrument.rangeCustomFields = { 'sel-0': { note: 'Combined' }, 'sel-1': { note: 'Combined' }, 'sel-2': { note: 'Lone1' }, 'sel-3': { note: 'Lone2' } };
  session.tmdes.push(instrument);
  session.instrumentCustomColumns = { tmde: [{ key: 'note', label: 'Note', insertAfter: 'tolerance' }] };
}

export async function checkTaskingFollowup({ frame, page, saved, until, check }) {
  page.setDefaultTimeout(10000);
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const outside = () => frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  await frame.locator('.point-grid-item').last().locator('.point-value-number').click();
  await page.keyboard.press('Escape');
  const pointRow = frame.locator('.point-grid-item').last();
  await pointRow.locator('.point-unit-select').hover();
  check('hovering the unit highlights only the unit control', await pointRow.locator('.point-edit-affordance').evaluate(node => getComputedStyle(node).boxShadow === 'none' && getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)'));
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/point-unit-hover.png` });
  await pointRow.locator('.point-value-number').click();
  check('value editing retains the adjacent unit selector', await pointRow.locator('.point-value-editing .point-unit-select').isVisible());
  check('value editing uses a compact independent field', await pointRow.locator('input.sidebar-inline-input.value').evaluate(input => input.classList.contains('inline-tolerance-input') && input.offsetWidth <= 62 && getComputedStyle(input.parentElement).boxShadow === 'none'));
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/point-value-editor.png` });
  await pointRow.locator('input.sidebar-inline-input.value').fill('5');
  await pointRow.locator('.point-unit-select').focus();
  await pointRow.locator('.point-unit-select').selectOption('V');
  await outside();
  check('switching from value to unit retains the entered nominal', await until(() => Number(saved().testPoints.at(-1).testPointInfo.parameter.value) === 5));
  await frame.getByRole('button', { name: 'Edit measurement equation', exact: true }).click();
  const equation = frame.getByLabel('Measurement equation', { exact: true });
  const before = await frame.locator('.measurement-inputs-table').boundingBox();
  const size = await equation.boundingBox();
  await equation.fill('a+');
  await page.waitForTimeout(250);
  check('equation keystrokes leave saved variables untouched', saved().testPoints.at(-1).equationString === 'a+b');
  const after = await frame.locator('.measurement-inputs-table').boundingBox();
  check('equation keystrokes leave downstream table position stable', Math.abs(before.y-after.y) < 1);
  await equation.fill('');
  const emptySize = await equation.boundingBox();
  check('empty and populated equation fields have the same size', Math.abs(size.width-emptySize.width)<1 && Math.abs(size.height-emptySize.height)<1);
  await equation.fill('a+b+c');
  await outside();
  check('equation commits on deselection', await until(() => saved().testPoints.at(-1).equationString === 'a+b+c'));
  await frame.getByRole('button', { name: 'Edit nominal for equation variable a', exact: true }).click();
  check('measurement nominal reuses compact resolution controls', await frame.getByLabel('Nominal value for equation variable a', { exact: true }).evaluate(input => input.classList.contains('inline-resolution-input') && input.offsetWidth <= 64));
  await frame.getByRole('button', { name: 'Edit name for equation variable a', exact: true }).click();
  check('measurement name reuses the custom-field editor', await frame.getByLabel('Display name for equation variable a', { exact: true }).evaluate(input => input.classList.contains('instrument-custom-field-input')));
  await outside();
  const budgetBadge = frame.locator('.instrument-usage-badge').filter({ hasText: 'In Budget ×2' }).first();
  await budgetBadge.waitFor();
  check('default description width contains the complete In Budget ×2 pill', await budgetBadge.evaluate(badge => {
    const rect = badge.getBoundingClientRect(), cell = badge.closest('td').getBoundingClientRect();
    return rect.left >= cell.left && rect.right <= cell.right && badge.scrollWidth <= badge.clientWidth + 1;
  }));
  const checkSingleRange = async view => {
    for (const role of ['uut', 'tmde']) {
      const single = frame.locator(`tr[data-selection-key="${role}:${role}"]`).first();
      await single.locator('[data-range-cell]').click({ position: { x: 3, y: 3 } });
      await page.waitForTimeout(70);
      check(`${view} ${role} single range selects independently of its description`, await single.evaluate(row => row.closest('table').dataset.selectionMode === 'range' && row.querySelector('[data-range-cell]').hasAttribute('data-cell-selected') && !row.querySelector('.cell-description').hasAttribute('data-cell-selected')));
    }
  };
  await checkSingleRange('point');
  const badgeTable = budgetBadge.locator('xpath=ancestor::table[1]');
  await badgeTable.locator('th[data-instrument-column="description"]').dblclick();
  check('fitting a description includes its usage pill', await budgetBadge.evaluate(badge => badge.getBoundingClientRect().right <= badge.closest('td').getBoundingClientRect().right));
  await frame.locator('[data-tour="tab-overview"]').click();
  await checkSingleRange('overview');
  const table = frame.locator('.instrument-equipment-table').nth(1);
  const description = table.locator('.cell-description').filter({ hasText: 'Selection' }).last();
  await description.locator('..').locator('[data-range-cell]').getByRole('button', { name: '0 V', exact: true }).click();
  let rows = table.locator('tr[data-selection-key="tmde:selection"]');
  await rows.nth(2).locator('.cell-tolerance').click({ position: { x: 3, y: 3 } });
  await rows.nth(2).locator('.cell-tolerance').hover();
  check('hover leaves an unrelated shared custom cell unhighlighted', await rows.first().locator('.instrument-custom-field-cell').evaluate(cell => !cell.hasAttribute('data-cell-hovered')));
  await rows.nth(1).locator('[data-range-cell]').click({ position: { x: 3, y: 3 } });
  await rows.nth(3).locator('.cell-tolerance').click({ modifiers: ['Control'], position: { x: 3, y: 3 } });
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  check('partial-row copy creates one instrument with only selected ranges', await until(() => saved().tmdes.some(t => t.id !== 'selection' && t.instrument.model === 'Selection' && t.ranges.length === 2 && t.ranges[0].min === 1 && t.ranges[1].min === 3)));
  const copied = saved().tmdes.find(t => t.id !== 'selection' && t.instrument.model === 'Selection');
  check('copied merged value becomes a single row', copied?.rangeCustomFields?.['sel-1']?.note === 'Combined' && !copied.rangeCustomFields['sel-0']);
  await table.locator('[data-range-cell] .inline-tolerance-summary').first().click();
  await frame.getByRole('button', { name: 'Range unit prefix', exact: true }).click();
  await page.waitForTimeout(150);
  check('prefix menu opens centered on Base', await frame.locator('.unit-prefix-menu').evaluate(menu => {
    const base = menu.querySelector('.is-base-unit').getBoundingClientRect(), list = menu.querySelector('[role="listbox"]').getBoundingClientRect();
    return Math.abs(base.top+base.height/2-list.top-list.height/2) < 20;
  }));
  await frame.evaluate(() => document.body.classList.remove('dark-mode'));
  const micro = frame.locator('.unit-prefix-menu [role="option"]').filter({ hasText: 'Micro' });
  const normal = await micro.evaluate(n => getComputedStyle(n).backgroundColor);
  await micro.hover();
  check('light-mode prefix options visibly highlight on hover', normal !== await micro.evaluate(n => getComputedStyle(n).backgroundColor));
  await page.keyboard.press('Escape');
  await table.locator('.instrument-custom-field-cell').first().getByRole('button', { name: 'Not Set', exact: true }).click();
  const field = table.locator('.instrument-custom-field-input');
  check('custom column opens with one click from another expanded column', await field.count() === 1);
  check('custom editor expands its column to fit', await field.evaluate(input => input.getBoundingClientRect().right <= input.closest('td').getBoundingClientRect().right));
  await field.fill('Review note');
  await outside();
  const header = table.locator('th[data-instrument-column="description"]');
  await header.hover();
  const headerBox = await header.boundingBox(), addBox = await header.locator('.instrument-column-insert-button').boundingBox();
  check('add-column control stays inside the gap-free header', addBox.y >= headerBox.y && addBox.y+addBox.height <= headerBox.y+headerBox.height);
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  check('column-menu headings and borderless Reset share typography', await frame.locator('.point-column-menu-body').evaluate(menu => {
    const heading = [...menu.querySelectorAll('.sidebar-column-order-heading strong')].map(n => getComputedStyle(n));
    const reset = getComputedStyle(menu.querySelector('.point-column-menu-actions button'));
    return heading.every(s => s.fontSize === heading[0].fontSize) && reset.fontSize === heading[0].fontSize && reset.borderTopWidth === '0px';
  }));
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) {
    await frame.locator('.point-column-menu-body').evaluate(async menu => {
      await Promise.all(menu.parentElement.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
    });
    await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/column-menu.png` });
  }
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  const beforeFit = await table.locator('th[data-instrument-column="range"]').evaluate(cell => cell.getBoundingClientRect().width);
  await header.dblclick();
  check('header double-click fits description text and preserves its neighbor', await table.evaluate((table, previous) => {
    const range = table.querySelector('th[data-instrument-column="range"]');
    return Math.abs(range.getBoundingClientRect().width - previous) < 2 && [...table.querySelectorAll('.inline-desc-combined')].every(node => node.scrollWidth <= node.clientWidth + 2);
  }, beforeFit));
  // Real native drags, including Escape cancellation, must return control.
  await frame.evaluate(() => {
    window.__nativeDragStarts = 0;
    document.addEventListener('dragstart', event => {
      if (event.target.closest('.instrument-equipment-table')) window.__nativeDragStarts++;
    }, true); // Instrument rows intentionally stop bubbling to parent drag handlers.
  });
  for (let i=0; i<3; i++) {
    const dragCell = table.locator('.cell-tolerance').first();
    await dragCell.scrollIntoViewIfNeeded();
    const box = await dragCell.boundingBox();
    await page.mouse.move(box.x+3, box.y+3);
    await page.mouse.down();
    await page.mouse.move(box.x+70, box.y+25, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
  }
  check('repeated drag test exercised native instrument dragging', await frame.evaluate(() => window.__nativeDragStarts >= 3), String(await frame.evaluate(() => window.__nativeDragStarts)));
  await frame.locator('[data-tour="tab-overview"]').click();
  check('application accepts clicks after repeated cancelled native drags', await frame.locator('[data-tour="tab-overview"]').isVisible());
  check('automatic tables have no vertical scrollbar', await frame.locator('.instrument-panel-table-container').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).overflowY === 'hidden' && n.scrollHeight <= n.clientHeight+1)));
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/followup.png` });
}
