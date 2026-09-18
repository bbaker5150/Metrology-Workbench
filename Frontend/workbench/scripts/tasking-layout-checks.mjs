import { prepareSeptember16Layout } from './september16-checks.mjs';

// Synthetic data only; the host script routes every SharePoint request in memory.
export function prepareTaskingLayout(session) {
  prepareSeptember16Layout(session);
  session.testPoints.push({ ...structuredClone(session.testPoints[0]), id: 'next-point',
    testPointInfo: { parameter: { name: 'Voltage', value: '6', unit: 'V' } } });
  const tmde = session.tmdes[0];
  tmde.tag = 'W2'; tmde.description = 'Diagnostic Equipment'; tmde.instrument.model = 'MD1217';
  tmde.ranges = [{ id: 'tmde-low', min: 5, max: 5, unit: 'V', tolerances: { floor: { high: .1, low: -.1, unit: 'V', distribution: '1.732' } } }];
  tmde.instrument.functions[0].ranges = structuredClone(tmde.ranges);
}

export async function checkTaskingLayout({ frame, page, check, saved, until }) {
  const settle = () => page.waitForTimeout(180);
  // Test the frame's actual usable viewport at several monitor/window sizes,
  // including CSS zoom-out (which previously exposed a large bottom strip).
  for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.locator('#app').evaluate((node, height) => { node.style.height = `${height}px`; }, height);
    for (const steps of [-2, 0, 2]) {
      await frame.locator('body').press('Control+0');
      for (let i = 0; i < Math.abs(steps); i++) await frame.locator('body').press(steps < 0 ? 'Control+-' : 'Control+=');
      await settle();
      const bounds = await frame.locator('.App.uncertainty-module').evaluate(node => ({ bottom: node.getBoundingClientRect().bottom, height: innerHeight }));
      check(`app fills ${width}×${height} at ${100 + steps * 10}%`, Math.abs(bounds.bottom - bounds.height) < 2, JSON.stringify(bounds));
    }
  }
  await frame.locator('body').press('Control+0');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#app').evaluate(node => { node.style.height = '1000px'; });
  await frame.getByLabel('UI Settings', { exact: true }).click();
  await frame.getByRole('button', { name: 'Fit to window', exact: true }).click();
  check('Fit to window preserves a full frame', await frame.locator('.App.uncertainty-module').evaluate(node => Math.abs(node.getBoundingClientRect().bottom - innerHeight) < 2));
  await page.keyboard.press('Escape');

  const instrument = frame.locator('.instrument-equipment-table').first();
  check('instrument column headings have equal top and bottom spacing', await instrument.locator('thead th').evaluateAll(nodes => nodes.every(node => {
    const style = getComputedStyle(node); return style.paddingTop === style.paddingBottom;
  })));
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  const rows = frame.locator('.point-column-order-row');
  const first = rows.nth(0), second = rows.nth(1);
  const original = await rows.evaluateAll(nodes => nodes.map(node => node.dataset.columnKey));
  const a = await first.boundingBox(), b = await second.boundingBox();
  await page.mouse.move(a.x + 20, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y + b.height - 3, { steps: 8 });
  await settle();
  const during = await first.boundingBox();
  const marker = await second.evaluate(node => ({ classes: node.className, height: getComputedStyle(node, '::after').height }));
  check('drag keeps source in place and highlights a drop border', Math.abs(during.y - a.y) < 1 && await first.evaluate(node => node.classList.contains('is-dragging'))
    && marker.classes.includes('drop-after') && marker.height === '2px', JSON.stringify({ before: a.y, during: during.y, marker }));
  check('column drag uses a closed hand without a draggable clone', await first.evaluate(node => getComputedStyle(node).cursor === 'grabbing' && !node.draggable));
  await page.mouse.up(); await settle();
  const reordered = await rows.evaluateAll(nodes => nodes.map(node => node.dataset.columnKey));
  check('dropping reorders at the marked boundary', reordered[0] === original[1] && reordered[1] === original[0]);
  await frame.getByRole('button', { name: 'Reset Columns', exact: true }).click();
  await page.keyboard.press('Escape');

  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  await frame.locator('.point-grid-item').first().locator('.point-value-number').click();
  const input = frame.locator('.sidebar-inline-input.value');
  await input.fill('5'); await input.press('Enter');
  check('Enter saves without entering another point', await input.count() === 0 && await frame.locator('.point-grid-item').count() === 2);
  await frame.locator('.point-grid-item').first().locator('.point-value-number').click();
  await input.press('Control+Enter');
  await input.waitFor();
  check('Ctrl+Enter advances to the existing next point', await input.inputValue() === '6' && await frame.locator('.point-grid-item').count() === 2);
  await input.press('Control+Enter');
  check('Ctrl+Enter creates one point only at the end', await until(() => saved().testPoints.length === 3));
  await page.keyboard.press('Escape');
  await frame.locator('.point-grid-item').first().click();
  check('both final risk cards remain visible', await frame.locator('.budget-decision-card').count() === 2);
  const budget = frame.locator('.budget-resizable-table').first();
  const sourceHandle = budget.locator('.budget-column-resize-handle').first();
  for (let i = 0; i < 30; i++) await sourceHandle.press('ArrowLeft');
  check('narrow budget columns wrap long labels instead of truncating', await budget.locator('.dynamic-source-label').evaluateAll(nodes => nodes.length > 0 && nodes.every(node => {
    const style = getComputedStyle(node); return style.whiteSpace === 'normal' && node.getBoundingClientRect().height > parseFloat(style.lineHeight) * 1.5 && node.scrollWidth <= node.clientWidth + 1;
  })));
  await frame.getByRole('button', { name: 'Add component to budget', exact: true }).first().click();
  const tile = frame.locator('.budget-tmde-picker-single');
  check('single-range TMDE is one named point tile', await tile.count() === 1 && /\(W2\) MD1217 Diagnostic Equipment/.test(await tile.innerText()) && /5 V/.test(await tile.innerText()) && !/5 to 5/.test(await tile.innerText()));
  check('single-range TMDE has no branch indent', await tile.locator('.budget-tmde-picker-range-mark').count() === 0);
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/tasking-picker.png` });
  await page.keyboard.press('Escape');
  // Menu and data rows share hover paint for every component kind in both themes.
  for (const theme of ['light', 'dark']) {
    await frame.evaluate(theme => { document.body.classList.remove('light-mode', 'dark-mode'); document.body.classList.add(`${theme}-mode`); }, theme);
    const budgetRows = frame.locator('.budget-resizable-table > .component-group-tbody > tr');
    for (let i = 0; i < await budgetRows.count(); i++) {
      const row = budgetRows.nth(i);
      await frame.locator('[data-tour="tab-budget"]').hover();
      const before = await row.locator('td').first().evaluate(node => getComputedStyle(node).backgroundColor);
      await row.hover(); await settle();
      check(`${theme} budget row ${i} highlights on hover`, before !== await row.locator('td').first().evaluate(node => getComputedStyle(node).backgroundColor));
    }
  }
  await frame.evaluate(() => { document.body.classList.remove('dark-mode'); document.body.classList.add('light-mode'); });
}
