import { prepareSeptember16Layout } from './september16-checks.mjs';

export function prepareIndependentColumns(session) {
  prepareSeptember16Layout(session);
  const point = session.testPoints[0];
  Object.assign(point, { measurementType: 'derived', equationString: 'a', variableMappings: { a: 'Voltage' }, variableNominals: { a: { value: 5, unit: 'V' } } });
  point.components.forEach(component => { component.variableType = 'Voltage'; });
  session.testPoints.push({ ...structuredClone(point), id: 'second-point' });
  session.dynamicBudgetDefinitions.push({ id: 'unused-equation', kind: 'equation', name: 'Unused equation', measurementUnit: 'V', outputUnit: 'V', mode: 'standard', equation: 'x/100', pointVariable: 'x', variables: {}, columns: [{ id: 'u', name: 'Uncertainty' }] });
}

// Exercise actual browser column geometry, not just saved widths. Table layout
// algorithms and viewport minimums can redistribute columns behind the model.
export async function checkIndependentColumns({ frame, page, saved, until, check }) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const settle = () => page.waitForTimeout(150);
  const geometry = table => table.evaluate(node => {
    const scale = node.getBoundingClientRect().width / node.offsetWidth;
    return [...node.tHead.rows[0].cells].map(cell => ({ width: cell.getBoundingClientRect().width / scale, x: cell.getBoundingClientRect().left / scale }));
  });
  const equalPeers = (before, after, target) => before.every((cell, index) => index === target || Math.abs(cell.width - after[index].width) < 1);
  const drag = async (handle, delta) => {
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * .75);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height * .75, { steps: 12 });
    await page.mouse.up(); await settle();
  };
  const matchesPanel = table => table.evaluate(node => {
    const tableWidth = node.getBoundingClientRect().width;
    const viewportWidth = node.parentElement.getBoundingClientRect().width;
    return { tableWidth, viewportWidth, noStrip: tableWidth >= viewportWidth - 2 };
  });
  await frame.locator('[data-tour="tab-overview"]').click();
  for (const [index, label] of [[0, 'UUT'], [1, 'TMDE']]) {
    const table = frame.locator('.instrument-equipment-table').nth(index);
    const range = table.getByRole('button', { name: 'Resize Range column', exact: true });
    const before = await geometry(table);
    await drag(range, -900);
    const narrow = await geometry(table);
    check(`${label} extreme shrink preserves every other column`, equalPeers(before, narrow, 1) && narrow[1].width <= 81, JSON.stringify({ before, narrow }));
    const panel = await matchesPanel(table);
    check(`${label} panel shrinks to its columns without an empty strip`, panel.noStrip && Math.abs(panel.tableWidth - panel.viewportWidth) < 3, JSON.stringify(panel));
    for (let attempt = 0; attempt < 3; attempt++) {
      await range.press('ArrowRight'); await range.press('ArrowLeft');
    }
    await settle();
    check(`${label} repeated reverse adjustments restore all borders`, (await geometry(table)).every((cell, i) => Math.abs(cell.width - narrow[i].width) < 1));
    // Growing the target pushes only columns to its right, eventually scrolling.
    await drag(range, 1000);
    const wide = await geometry(table);
    check(`${label} growth pushes right without redistributing peer widths`, equalPeers(narrow, wide, 1) && wide[1].width > narrow[1].width + 900, JSON.stringify({ narrow, wide }));
    check(`${label} wide table scrolls inside its panel`, await table.evaluate(node => node.parentElement.scrollWidth > node.parentElement.clientWidth + 10));
    await drag(range, -1000);
    for (const key of ['Control+-', 'Control+=']) {
      await frame.locator('body').press(key); await settle();
      const zoomed = await geometry(table);
      check(`${label} zoom preserves authored column widths`, zoomed.every((cell, i) => Math.abs(cell.width - narrow[i].width) < 1));
      check(`${label} zoom leaves no trailing panel strip`, (await matchesPanel(table)).noStrip);
    }
  }
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  await frame.locator('.point-grid-item').first().click();
  const tables = frame.locator('.budget-resizable-table');
  check('fixture covers component and equation budget tables', await tables.count() >= 2);
  for (let index = 0; index < await tables.count(); index++) {
    const table = tables.nth(index), handle = table.locator('.budget-column-resize-handle').first();
    const before = await geometry(table);
    await drag(handle, -900);
    const narrow = await geometry(table);
    check(`budget ${index} extreme shrink preserves every other column`, equalPeers(before, narrow, 0) && narrow[0].width <= 61, JSON.stringify({ before, narrow }));
    check(`budget ${index} has no trailing panel strip`, (await matchesPanel(table)).noStrip);
    for (let step = 0; step < 3; step++) { await handle.press('ArrowRight'); await handle.press('ArrowLeft'); }
    await settle();
    check(`budget ${index} reversing adjustments restores all widths`, (await geometry(table)).every((cell, i) => Math.abs(cell.width - narrow[i].width) < 1));
    await drag(handle, 1000);
    check(`budget ${index} growth preserves peer widths and scrolls`, equalPeers(narrow, await geometry(table), 0) && await table.evaluate(node => node.parentElement.scrollWidth > node.parentElement.clientWidth + 10));
    await drag(handle, -1000);
  }
  // Both kinds expose one independent delete control; a used definition remains
  // evaluable in every budget, while an unused definition is removed outright.
  await frame.getByRole('button', { name: 'Add component to budget', exact: true }).first().click();
  const entries = frame.locator('.budget-dynamic-picker-entry');
  for (const theme of ['light', 'dark']) {
    await frame.evaluate(theme => document.body.classList.toggle('dark-mode', theme === 'dark'), theme);
    await frame.locator('.budget-picker-heading').hover();
    check(`${theme} library delete is hidden at rest`, await entries.first().locator('.budget-dynamic-picker-delete').evaluate(node => getComputedStyle(node).opacity === '0'));
    await entries.first().hover();
    check(`${theme} library delete reveals in red on hover`, await entries.first().locator('.budget-dynamic-picker-delete').evaluate(node => {
      const style = getComputedStyle(node); return style.opacity === '1' && style.pointerEvents === 'auto' && style.color !== getComputedStyle(node.parentElement).color;
    }));
    if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/library-delete-${theme}.png` });
  }
  const beforeIds = saved().testPoints.map(point => point.components.map(component => component.id));
  await entries.first().locator('.budget-dynamic-picker-delete').click();
  check('removing a used definition persists without changing budget membership', await until(() => saved().dynamicBudgetDefinitions.find(d => d.id === 'layout-table')?.hiddenFromPicker) && JSON.stringify(beforeIds) === JSON.stringify(saved().testPoints.map(point => point.components.map(component => component.id))));
  check('removed component is absent from the open picker', await entries.count() === 1);
  await entries.first().hover();
  await frame.getByRole('button', { name: 'Delete Unused equation', exact: true }).click();
  check('unused equation is deleted from storage and the picker', await until(() => !saved().dynamicBudgetDefinitions.some(d => d.id === 'unused-equation')) && await entries.count() === 0);
  await page.keyboard.press('Escape');
  await frame.evaluate(() => document.body.classList.remove('dark-mode'));
}
