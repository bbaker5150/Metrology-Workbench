import { prepareFollowupSession } from './tasking-followup-checks.mjs';

export function prepareInstrumentInteractions(session) {
  prepareFollowupSession(session);
  session.measurementAreas.push({ id: 'target-area', name: 'Target area', unit: 'V' });
  session.measurementAreaGroups.push({ name: 'Target area', color: '#4088cc' });
}

export async function checkInstrumentInteractions({ frame, page, saved, until, check }) {
  await page.setViewportSize({ width: 1600, height: 1100 });
  page.setDefaultTimeout(10000);
  const settle = () => page.waitForTimeout(160);
  await frame.locator('[data-tour="tab-overview"]').click();
  const table = frame.locator('.instrument-equipment-table').nth(1);
  const rows = table.locator('tr[data-selection-key="tmde:selection"]');
  await rows.first().waitFor();
  const range = rows.nth(1).locator('.cell-value').first();
  for (const dark of [false, true]) {
    await frame.evaluate(dark => document.body.classList.toggle('dark-mode', dark), dark);
    await range.hover(); await settle();
    const colors = await rows.evaluateAll(nodes => nodes.map(row => [...row.cells].map(cell => ({
      hovered: cell.hasAttribute('data-cell-hovered'), selected: cell.hasAttribute('data-cell-selected'),
      column: cell.hasAttribute('data-column-hovered'), tint: getComputedStyle(cell).getPropertyValue('--instrument-cell-tint').trim(),
      color: getComputedStyle(cell).backgroundColor,
    }))));
    check(`${dark ? 'dark' : 'light'} range hover has dark row, light column and shared cells only`,
      colors[1].every(cell => cell.hovered && cell.tint === (dark ? '30%' : '20%')) &&
      colors[0].some(cell => cell.column && !cell.hovered && cell.tint === (dark ? '24%' : '16%')) &&
      colors[2].some(cell => !cell.hovered && !cell.column && cell.tint === (dark ? '20%' : '12%')), JSON.stringify(colors));
    for (const selector of ['.cell-sync', '.cell-distribution', '[data-custom-column]']) {
      const cell = rows.first().locator(selector).first();
      await cell.hover(); await settle();
      check(`${dark ? 'dark' : 'light'} ${selector} highlights the logical column`, await table.locator('td[data-column-hovered]').count() >= 2);
    }
    await range.click({ position: { x: 3, y: 3 } }); await settle();
    check(`${dark ? 'dark' : 'light'} selected range uses the darkest fill`, await range.evaluate(cell => cell.hasAttribute('data-cell-selected') && getComputedStyle(cell).getPropertyValue('--instrument-cell-tint').trim() === (document.body.classList.contains('dark-mode') ? '36%' : '26%')));
    // Clear via ctrl-click so the next theme verifies hover independently.
    await range.click({ position: { x: 3, y: 3 }, modifiers: ['Control'] });
  }
  check('Sync has one continuous seam with no duplicate neighboring borders', await rows.evaluateAll(nodes => nodes.every(row => [...row.cells].filter(cell => cell.hasAttribute('data-before-sync')).every(cell => getComputedStyle(cell).borderRightWidth === '0px')) && getComputedStyle(nodes[0].querySelector('.cell-sync')).borderLeftWidth === '1px'));
  if (process.env.INTERACTION_SCREENSHOT) { await range.hover(); await page.screenshot({ path: process.env.INTERACTION_SCREENSHOT }); }

  // Actual mouse gestures, not synthetic drop calls: no trusted/native drag
  // should start, and leaving the table cannot save or lock the application.
  await frame.evaluate(() => {
    window.__nativeInstrumentDrags = 0;
    document.addEventListener('dragstart', event => { if (event.isTrusted) window.__nativeInstrumentDrags++; }, true);
  });
  const start = async () => {
    await rows.first().locator('.cell-description').scrollIntoViewIfNeeded();
    const box = await rows.first().locator('.cell-description').boundingBox();
    await page.mouse.move(box.x + 3, box.y + 8); await page.mouse.down();
    await page.mouse.move(box.x + 28, box.y + 18, { steps: 5 }); await settle();
    check('instrument pointer drag starts its in-page preview', await frame.locator('.instrument-pointer-drag-preview').count() === 1);
  };
  const original = JSON.stringify(saved().tmdes);
  await start();
  await page.mouse.move(20, 120, { steps: 8 }); await page.mouse.up(); await settle();
  check('outside drop cancels with no session mutation or latched cursor', JSON.stringify(saved().tmdes) === original && await frame.evaluate(() => !document.querySelector('.instrument-pointer-drag-preview') && document.body.style.cursor !== 'grabbing'));
  await start(); await page.keyboard.press('Escape'); await page.mouse.up(); await settle();
  check('Escape cancels and restores interaction', await frame.locator('.instrument-pointer-drag-preview').count() === 0);
  await start();
  const target = table.locator('tr.instrument-area-section-row').filter({ hasText: 'Target area' }).first();
  await target.scrollIntoViewIfNeeded();
  const bounds = await target.boundingBox();
  await page.mouse.move(bounds.x + 150, bounds.y + bounds.height / 2, { steps: 10 }); await page.mouse.up();
  check('valid in-page drop moves the instrument to its target area', await until(() => saved().tmdes.find(item => item.id === 'selection')?.measurementAreaNames?.includes('Target area')));
  check('instrument dragging never enters native browser drag-and-drop', await frame.evaluate(() => window.__nativeInstrumentDrags === 0));
}
