import { prepareBiasSession } from './measurement-bias-checks.mjs';

export function prepareSeptember18(session) {
  prepareBiasSession(session);
  session.uuts[0].ranges.push({ ...structuredClone(session.uuts[0].ranges[0]), id: 'uut-second', min: 10, max: 20 });
  const sibling = structuredClone(session.uuts[0]); sibling.id = 'uut-sibling'; sibling.description = 'Sibling instrument'; sibling.ranges = sibling.ranges.map((range, i) => ({ ...range, id: `sibling-${i}` })); session.uuts.push(sibling);
  session.measurementAreas.push({ id: 'empty-area', name: 'Empty area' });
  session.measurementAreaGroups.push({ name: 'Empty area', color: '#3080cc' });
  const point = session.testPoints[0];
  for (let i = 1; i < 35; i++) session.testPoints.push({ ...structuredClone(point), id: `large-${i}` });
}

// Real iframe geometry and gestures catch regressions that jsdom cannot: scroll
// ownership, pointer targets that move between press/release, and rowspan seams.
export async function checkSeptember18({ frame, page, saved, until, check }) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const settle = () => page.waitForTimeout(180);
  const points = frame.locator('.measurement-points-table');
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  check('large point list owns vertical scrolling and keeps its bottom scrollbar visible', await points.evaluate(node => {
    const r = node.getBoundingClientRect();
    return node.scrollHeight > node.clientHeight + 100 && r.bottom <= innerHeight && getComputedStyle(node).overflowY === 'auto';
  }));
  await points.evaluate(node => { node.scrollTop = 250; }); await settle();
  check('measurement point header stays at the top of its scroll viewport', await points.evaluate(node =>
    Math.abs(node.querySelector('.sidebar-column-header-stack').getBoundingClientRect().top - node.getBoundingClientRect().top) < 2));
  await points.evaluate(node => { node.scrollTop = 0; });
  const area = frame.locator('.area-header-sticky[aria-label="Voltage measurement area"]');
  await area.focus(); await area.press('Control+c');
  const destination = frame.locator('.area-header-sticky[aria-label="Empty area measurement area"]');
  await destination.scrollIntoViewIfNeeded(); await destination.focus(); await destination.press('Control+v');
  check('header keyboard paste populates an empty measurement area with all source points', await until(() => saved().testPoints.filter(p => p.testPointInfo?.measurementArea === 'Empty area').length === 35));
  await destination.click({ button: 'right', position: { x: 5, y: 5 } });
  check('measurement area context menu offers point clipboard commands', await frame.getByText('Copy Points', { exact: true }).count() === 1 && await frame.getByText('Cut Points', { exact: true }).count() === 1 && await frame.getByText('Paste Points', { exact: true }).count() === 1);
  await page.keyboard.press('Escape');

  await frame.locator('[data-tour="tab-overview"]').click();
  const table = frame.locator('.instrument-equipment-table').first();
  await table.locator('[data-range-cell]').first().click({ position: { x: 3, y: 3 } });
  const tools = table.locator('td.cell-sync .instrument-row-tools').first();
  const clickBlankSync = async () => {
    await tools.scrollIntoViewIfNeeded();
    const fraction = await tools.evaluate(node => {
      const rect = node.getBoundingClientRect();
      for (let x = 1; x < rect.width; x++) {
        const hit = document.elementFromPoint(rect.left + x, rect.top + rect.height / 2);
        if (hit && node.contains(hit) && !hit.closest('button')) return x / rect.width;
      }
      return null;
    });
    if (fraction == null) throw new Error('Fixture has no blank Sync tools background');
    const box = await tools.boundingBox();
    await page.mouse.click(box.x + fraction * box.width, box.y + box.height / 2);
  };
  await clickBlankSync();
  check('blank Sync tools area selects the complete multirange instrument', await table.locator('tr[data-range-selected="true"]').count() >= 2);
  await table.locator('[data-range-cell]').first().click({ position: { x: 3, y: 3 } });
  const oldHeaders = await table.locator('thead th').count();
  const add = table.locator('.instrument-column-insert-button').first();
  await table.locator("thead th").first().hover();
  await add.click();
  check('column + adds on the first click while the range editor is open', await until(async () => await table.locator('thead th').count() === oldHeaders + 1));
  const customName = table.locator('.instrument-custom-column-name-input').first();
  if (await customName.count()) {
    await customName.fill('Audit'); await customName.press('Enter');
  }
  check('custom header names render uppercase', await table.locator('.instrument-custom-column-label,.instrument-custom-column-name-input').first().evaluate(node => getComputedStyle(node).textTransform === 'uppercase'));

  await table.locator('.instrument-custom-column-header').first().hover();
  await table.getByRole('button', { name: 'Delete Audit column', exact: true }).click();
  check('custom column deletes immediately without a confirmation', await until(async () => await table.locator('thead th').count() === oldHeaders) && await frame.getByRole('dialog', { name: /Delete.*Column/ }).count() === 0);
  check('add-column control stays above the gap-free header', await table.locator('.instrument-column-insert-button').first().evaluate(button => button.getBoundingClientRect().top < button.closest('th').getBoundingClientRect().top && button.getBoundingClientRect().bottom <= button.closest('th').getBoundingClientRect().top + 1));
  await table.locator('.cell-tolerance .inline-tolerance-summary').first().click();
  check('configured bias reopens below the tolerance terms', await table.locator('.instrument-bias-editor').count() === 1 && await table.locator('.inline-tolerance-term-group').count() > 0);
  await table.getByRole('button', { name: 'Bias', exact: true }).click();
  const unit = table.getByRole('button', { name: 'Tolerance unit base unit', exact: true }).first();
  await unit.click(); await settle();
  const trigger = await unit.boundingBox(), menu = await frame.locator('.inline-unit-menu').boundingBox();
  check('unit menu aligns to an edge of the actual unit trigger', Math.min(Math.abs(menu.x - trigger.x), Math.abs(menu.x + menu.width - trigger.x - trigger.width)) < 2, JSON.stringify({ trigger, menu }));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  check('collapsed tolerance exposes its signed bias on a separate line', await table.locator('.instrument-bias-summary').first().textContent().then(text => text.includes('+0.1 V bias')));
  check('bias annotation occupies a separate visual line', await table.locator('.inline-tolerance-summary').filter({ has: frame.locator('.instrument-bias-summary') }).first().evaluate(node => {
    const bias = node.querySelector('.instrument-bias-summary').getBoundingClientRect();
    const summary = node.firstElementChild.getBoundingClientRect();
    return bias.top >= summary.bottom - 1;
  }));
  await clickBlankSync();
  await page.keyboard.press('Control+c');
  const emptyInstrumentArea = table.locator('.instrument-area-section-row').filter({ hasText: 'Empty area' });
  await emptyInstrumentArea.click({ position: { x: 5, y: 5 } });
  await emptyInstrumentArea.press('Control+v');
  check('instrument header accepts keyboard paste into an empty area', await until(() => saved().uuts.some(uut => uut.measurementAreaNames?.includes('Empty area'))));
  const sourceArea = table.locator('.instrument-area-section-row').filter({ hasText: 'Voltage' }).first();
  await sourceArea.click({ position: { x: 5, y: 5 } });
  check('instrument area selects all instruments and clears point selection', await table.locator('tr[data-range-selected="true"]').count() >= 4 && await frame.locator('.point-grid-item.active').count() === 0);
  await sourceArea.press('Control+c');
  const beforeAreaPaste = saved().uuts.length;
  await emptyInstrumentArea.click({ position: { x: 5, y: 5 } }); await emptyInstrumentArea.press('Control+v');
  check('instrument area keyboard copy pastes every source instrument', await until(() => saved().uuts.length === beforeAreaPaste + 2));
  await sourceArea.click({ button: 'right', position: { x: 5, y: 5 } });
  check('instrument area offers copy and cut commands', await frame.getByText('Copy Instruments', { exact: true }).count() === 1 && await frame.getByText('Cut Instruments', { exact: true }).count() === 1);
  await page.keyboard.press('Escape');
  await area.click({ position: { x: 5, y: 5 } });
  check('point area takes clipboard ownership from instruments', await table.locator('tr[data-range-selected="true"]').count() === 0);
  check('point area selection follows its area color', await area.evaluate(node => getComputedStyle(node).outlineColor === getComputedStyle(node).getPropertyValue('--sidebar-function-color').trim() || getComputedStyle(node).outlineColor === 'rgb(204, 48, 48)'));
  await area.press('Control+c'); await destination.click({ position: { x: 5, y: 5 } }); await destination.press('Control+v');
  check('point area copy wins after prior instrument selection', await until(() => saved().testPoints.filter(p => p.testPointInfo?.measurementArea === 'Empty area').length === 70));
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/september18-layout.png` });
}
