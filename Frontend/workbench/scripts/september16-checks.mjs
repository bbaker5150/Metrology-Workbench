export function prepareSeptember16Layout(session) {
  const definition = { id:'layout-table',kind:'table',name:'Layout check',measurementUnit:'V',outputUnit:'V',mode:'standard',columns:[{id:'u',name:'Uncertainty'}],rows:[{id:'r',point:5,values:{u:{value:.2}}}] };
  session.dynamicBudgetDefinitions = [definition];
  session.testPoints[0].components = [{ id:'layout-component',dynamicDefinitionId:definition.id,dynamicOutputId:'u',dynamicDefinition:definition,type:'B',isManual:true },
    { id:'layout-static',name:'Static layout check',type:'B',isManual:true,value:.1,value_native:.1,unit_native:'V',manualUnit:'V',manualValue:.1,distributionDivisor:'1' }];
}

export async function checkSeptember16({ frame, page, check }) {
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const settle = () => page.waitForTimeout(180);
  const widths = table => table.locator(':scope > thead > tr > th').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().width));
  await frame.locator('[data-tour="tab-overview"]').click();
  const instruments = frame.locator('.instrument-equipment-table');
  for (const index of [0, 1]) {
    const table = instruments.nth(index);
    const before = await widths(table);
    const handle = table.getByRole('button', { name: 'Resize Range column', exact: true });
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 800, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await settle();
    const after = await widths(table);
    check(`${index ? 'TMDE' : 'UUT'} extreme column shrink preserves intermediate widths and fills with the last column`, after.every((w, i) => i === 1 || i === after.length - 1 || Math.abs(w - before[i]) < 1) && after.at(-1) >= before.at(-1) - 1, JSON.stringify({ before, after }));
    check('instrument table fills its viewport without a trailing blank strip', await table.evaluate(node => node.getBoundingClientRect().width >= node.parentElement.getBoundingClientRect().width - 3));
    check('narrow instrument cells clip text at column boundaries', await table.locator('tr.instrument-function-row > td').evaluateAll(cells => cells.every(c => getComputedStyle(c).overflowX === 'hidden')));
  }
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  await settle();
  const menu = frame.getByRole('dialog', { name: 'Visible measurement point columns' });
  const layout = await menu.evaluate(node => {
    const selected = node.querySelector('.sidebar-column-order-list');
    const available = node.querySelector('.point-column-available .sidebar-filter-sections');
    const before = selected.getBoundingClientRect().top;
    available.scrollTop = available.scrollHeight;
    return { fixed: selected.getBoundingClientRect().top === before, scroll: getComputedStyle(available).overflowY,
      selectedScroll: getComputedStyle(selected).overflowY, reset: node.querySelector('.point-column-reset').getBoundingClientRect().top - node.getBoundingClientRect().top };
  });
  check('available columns scroll independently and displayed columns stay fixed', layout.fixed && layout.scroll === 'auto' && layout.selectedScroll === 'visible', JSON.stringify(layout));
  check('Reset is at the top of the column chooser', layout.reset < 40);
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/column-menu.png` });
  await page.keyboard.press('Escape');
  await frame.locator('.point-grid-item').first().locator('.point-value-number').click();
  await page.keyboard.press('Escape');
  await frame.locator('[data-tour="tab-budget"]').click();
  const budget = frame.locator('.budget-resizable-table').filter({ has: frame.locator('.budget-dynamic-row') }).first();
  const before = await widths(budget);
  const handle = budget.locator('.budget-column-resize-handle').first();
  await handle.scrollIntoViewIfNeeded();
  await handle.press('ArrowLeft');
  await settle();
  const after = await widths(budget);
  check('budget column resize preserves intermediate widths and the action gutter', after.every((w, i) => i === 0 || i === after.length - 2 || Math.abs(w - before[i]) < 1), JSON.stringify({ before, after }));
  check('budget table fills its viewport without a trailing blank strip', await budget.evaluate(node => node.getBoundingClientRect().width >= node.parentElement.getBoundingClientRect().width - 3));
  // Create horizontal overflow without altering other columns.
  for (let i = 0; i < 80; i++) await handle.press('ArrowRight');
  await settle();
  const action = budget.locator('.action-cell').first();
  const left = await action.boundingBox();
  await budget.evaluate(table => { table.closest('.budget-section-table-wrap').scrollLeft = 300; });
  await settle();
  const scrolled = await action.boundingBox();
  const position = await action.evaluate(cell => getComputedStyle(cell).position);
  check('budget delete action remains anchored while horizontally scrolling', Math.abs(left.x - scrolled.x) < 1 && position === 'sticky', JSON.stringify({left,scrolled,position}));
  const rows = budget.locator(':scope > tbody > tr');
  for (const theme of ['light', 'dark']) {
    await frame.locator('body').evaluate((body, theme) => body.classList.toggle('dark-mode', theme === 'dark'), theme);
    check(`${theme} action header matches the other headers`, await budget.locator('thead tr').evaluate(node => {
      const first = getComputedStyle(node.firstElementChild), last = getComputedStyle(node.lastElementChild);
      return first.backgroundColor === last.backgroundColor && first.backgroundImage === last.backgroundImage;
    }));
    for (let index = 0; index < await rows.count(); index++) {
      const row = rows.nth(index);
      const remove = row.locator('.action-cell :is(.delete-action, button)').last();
      if (!await remove.count()) continue;
      await page.mouse.move(5, 5);
      await budget.locator('thead button').last().focus();
      await budget.locator('thead th').last().hover();
      await settle();
      check(`${theme} row ${index} remove icon is hidden at rest`, await remove.evaluate(node => getComputedStyle(node).opacity === '0'));
      check(`${theme} row ${index} action background matches its resting row`, await row.evaluate(node => {
        const row = getComputedStyle(node), action = getComputedStyle(node.querySelector('.action-cell'));
        return row.backgroundColor === action.backgroundColor && row.backgroundImage === action.backgroundImage;
      }));
      await row.locator('.action-cell').hover();
      await settle();
      check(`${theme} row ${index} remove icon appears on hover`, await remove.evaluate(node => getComputedStyle(node).opacity === '1' && getComputedStyle(node).pointerEvents === 'auto'));
      const background = await row.evaluate(node => {
        const row = getComputedStyle(node), action = getComputedStyle(node.querySelector('.action-cell'));
        return { row: [row.backgroundColor, row.backgroundImage], action: [action.backgroundColor, action.backgroundImage] };
      });
      check(`${theme} row ${index} action background matches its hovered row`, JSON.stringify(background.row) === JSON.stringify(background.action), JSON.stringify(background));
    }
    if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/budget-actions-${theme}.png` });
  }
  await frame.locator('body').evaluate(body => body.classList.remove('dark-mode'));
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/budget-scroll.png` });
  check('workspace reserves a vertical scrollbar gutter', await frame.locator('.analysis-content').evaluate(node => getComputedStyle(node).scrollbarGutter === 'stable'));
}
