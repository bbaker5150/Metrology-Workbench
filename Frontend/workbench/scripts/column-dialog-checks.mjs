// Assert page geometry as well as dialog geometry: a bounded-looking portal
// can still extend the document's scrollable area under CSS zoom.
export async function checkColumnDialog({ frame, page, until, check }) {
  // Use a short viewport so both independent list scrolling and fixed actions are exercised.
  await page.setViewportSize({ width: 1600, height: 600 });
  await page.locator('#app').evaluate(node => { node.style.height = '600px'; });
  const trigger = frame.getByRole('button', { name: 'Columns', exact: true });
  const menu = frame.getByRole('dialog', { name: 'Visible measurement point columns', exact: true });
  const pageSize = () => frame.evaluate(() => ({
    html: document.documentElement.scrollHeight, body: document.body.scrollHeight,
    workspace: document.querySelector('.results-workflow-container').getBoundingClientRect().height,
  }));
  const geometry = () => menu.evaluate(node => {
    const box = node.getBoundingClientRect();
    const scrollOwners = [...node.querySelectorAll('*')].filter(el => /^(auto|scroll)$/.test(getComputedStyle(el).overflowY) && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1);
    const selected = node.querySelector('.point-column-selected');
    const listStyle = getComputedStyle(node.querySelector('.point-column-lists'));
    const logicalHeight = node.querySelector('.point-column-menu-actions').offsetHeight + selected.querySelector('.sidebar-column-order-heading').offsetHeight + selected.querySelector('.sidebar-column-order-list').scrollHeight + parseFloat(listStyle.paddingTop) + parseFloat(listStyle.paddingBottom) + 2;
    const zoom = (parseFloat(getComputedStyle(document.documentElement).zoom) || 1) * (parseFloat(getComputedStyle(document.body).zoom) || 1);
    return { expectedHeight: Math.min(innerHeight - 8 * zoom, logicalHeight * zoom), modal: node.matches(':modal'), popover: node.matches(':popover-open'), height: box.height, width: box.width, viewportHeight: innerHeight,
      bounded: box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight + 1 && box.right <= innerWidth + 1,
      outerOverflow: node.scrollHeight > node.clientHeight + 1,
      scrollers: scrollOwners.map(el => el.className),
      actionsVisible: [...node.querySelectorAll('.point-columns-dialog-header, .point-column-menu-actions')].every(el => {
        const r = el.getBoundingClientRect(); return r.top >= box.top && r.bottom <= box.bottom;
      }),
    };
  });
  await trigger.scrollIntoViewIfNeeded();
  const before = await pageSize();
  await trigger.click();
  check('column settings open in the native top layer without changing page or workspace height', await until(async () =>
    (await geometry()).popover && !(await geometry()).modal && JSON.stringify(await pageSize()) === JSON.stringify(before)));
  check('column settings omit the redundant heading and help text', await menu.locator('h3, p').count() === 0);
  check('column settings scroll each list independently with fixed actions', await until(async () => {
    const g = await geometry(); return g.bounded && !g.outerOverflow && g.actionsVisible && g.scrollers.every(name => ['point-column-selected', 'point-column-available'].includes(name)) && g.scrollers.includes('point-column-available');
  }));
  check('column menu actions and close control share one compact row', await menu.evaluate(node => {
    const actions = [...node.querySelectorAll('.point-column-menu-actions > button')].map(el => el.getBoundingClientRect());
    return actions.length === 3 && Math.max(...actions.map(r => r.top + r.height / 2)) - Math.min(...actions.map(r => r.top + r.height / 2)) < 2;
  }));
  check('displayed columns have no category header rows', await menu.locator('.point-column-selected .filter-option-group-title').count() === 0);
  const selectedScroll = await menu.locator('.point-column-selected').evaluate(node => node.scrollTop);
  await menu.locator('.point-column-available').evaluate(node => { node.scrollTop = node.scrollHeight; });
  check('scrolling Add Columns leaves Displayed columns stationary', await menu.locator('.point-column-available').evaluate(node => node.scrollTop > 0) && await menu.locator('.point-column-selected').evaluate(node => node.scrollTop) === selectedScroll);
  check('only Add Columns displays a scrollbar', await menu.evaluate(node => getComputedStyle(node.querySelector('.point-column-selected')).scrollbarWidth === 'none' && getComputedStyle(node.querySelector('.point-column-available')).overflowY === 'scroll'));
  check('column popover has no dimming or blur', await menu.evaluate(node => { const css = getComputedStyle(node, '::backdrop'); return css.backgroundColor === 'rgba(0, 0, 0, 0)' && css.backdropFilter === 'none'; }));
  await menu.locator('.point-column-available').evaluate(node => { node.scrollTop = 0; });
  check('column lists use the dialog width without horizontal overflow', await menu.evaluate(node => {
    const list = node.querySelector('.point-column-lists');
    // clientWidth excludes the deliberately reserved scrollbar gutter.
    return list.getBoundingClientRect().width >= node.clientWidth - 2 && list.scrollWidth <= list.clientWidth + 1;
  }));
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/column-settings-dialog.png` });
  const rows = menu.locator('.point-column-order-row');
  const original = await rows.evaluateAll(nodes => nodes.map(node => node.dataset.columnKey));
  await rows.nth(1).focus(); await rows.nth(1).press('ArrowUp');
  check('keyboard sorting changes the displayed column order', await until(async () => await rows.first().getAttribute('data-column-key') === original[1]));
  // Also exercise real pointer sorting within the shared scrolling surface.
  const source = await rows.first().boundingBox(), target = await rows.nth(1).boundingBox();
  await page.mouse.move(source.x + 15, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 15, target.y + target.height - 3, { steps: 5 }); await page.mouse.up();
  check('pointer sorting restores the original first column', await until(async () => await rows.first().getAttribute('data-column-key') === original[0]));
  const count = await rows.count();
  const add = menu.locator('.point-column-add').first();
  const label = (await add.getAttribute('aria-label')).replace(/^Add /, '').replace(/ column$/, '');
  await add.click();
  check('adding a column takes effect immediately at the bottom', await until(async () => await rows.count() === count + 1 && await rows.last().getAttribute('aria-label') === `Move ${label}`));
  await menu.getByRole('button', { name: `Hide ${label}`, exact: true }).click();
  check('hiding a column returns it to the available list', await until(async () => await rows.count() === count && await menu.getByRole('button', { name: `Add ${label} column`, exact: true }).count() === 1));
  while (await menu.locator('.point-column-add').count()) await menu.locator('.point-column-add').first().click();
  check('showing every column does not stretch the document or workspace', JSON.stringify(await pageSize()) === JSON.stringify(before));
  await menu.locator('.point-column-selected').evaluate(node => { node.scrollTop = node.scrollHeight; });
  check('the last displayed column is reachable while dialog actions stay visible', await rows.last().evaluate(node => {
    const scroller = node.closest('.point-column-selected').getBoundingClientRect(), row = node.getBoundingClientRect();
    return row.top >= scroller.top && row.bottom <= scroller.bottom + 1;
  }) && (await geometry()).actionsVisible);
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/column-settings-all-columns.png` });
  await menu.getByRole('button', { name: 'Reset Columns', exact: true }).click();
  await menu.getByRole('button', { name: 'Close column settings', exact: true }).click();
  check('closing column settings returns focus to Columns', await trigger.evaluate(node => document.activeElement === node));

  for (const [width, height, zoom] of [[2200, 2000, 1], [1500, 700, .75], [1500, 700, 1.25], [360, 500, 1]]) {
    await page.setViewportSize({ width, height });
    await page.locator('#app').evaluate((node, h) => { node.style.height = `${h}px`; }, height);
    await frame.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
    await trigger.scrollIntoViewIfNeeded();
    const initial = await pageSize();
    await trigger.click();
    check(`popover stays bounded with independent scroll areas at ${width}×${height}, ${zoom * 100}% zoom`, await until(async () => {
      const g = await geometry(); return g.bounded && !g.outerOverflow && g.actionsVisible && g.scrollers.length <= 2 && g.scrollers.every(name => ['point-column-selected', 'point-column-available'].includes(name)) && Math.abs(g.height - g.expectedHeight) <= 2 && g.width <= 540 * zoom + 1;
    }));
    check(`opening the dialog preserves page height at ${zoom * 100}% zoom`, JSON.stringify(await pageSize()) === JSON.stringify(initial));
    if (width === 2200) {
      check('column settings open centered in the app', await menu.evaluate(node => {
        const r = node.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2 && Math.abs(r.top + r.height / 2 - innerHeight / 2) < 2;
      }));
      const beforeDrag = await menu.boundingBox();
      const bar = await menu.locator('.point-column-menu-actions').boundingBox();
      await page.mouse.move(bar.x + 12, bar.y + bar.height / 2); await page.mouse.down();
      await page.mouse.move(bar.x + 112, bar.y + bar.height / 2 + 80, { steps: 8 }); await page.mouse.up();
      const afterDrag = await menu.boundingBox();
      check('column settings can be dragged by the top bar', Math.abs(afterDrag.x - beforeDrag.x - 100) < 2 && Math.abs(afterDrag.y - beforeDrag.y - 80) < 2);
      await menu.getByRole('button', { name: 'Set as Default', exact: true }).click();
      check('Set as Default remains clickable after dragging', await frame.evaluate(() => !!JSON.parse(localStorage.getItem('uncertalytics.pointColumnDefaults.v1') || '{}').order?.length));
      await menu.getByRole('button', { name: 'Reset Columns', exact: true }).click();
      check('top actions remain reachable after reset', (await geometry()).actionsVisible);
      if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) {
        await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/column-settings-content-height.png` });
        await frame.evaluate(() => document.body.classList.replace('light-mode', 'dark-mode'));
        await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/column-settings-content-height-dark.png` });
        await frame.evaluate(() => document.body.classList.replace('dark-mode', 'light-mode'));
      }
    }
    if (width === 360 && process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/column-settings-narrow.png` });
    await menu.getByRole('button', { name: 'Close column settings' }).focus();
    await page.keyboard.press('Shift+Tab');
    check('keyboard focus stays inside column settings', await menu.evaluate(node => node.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    check('Escape closes the dialog and returns focus without scrolling the page', await menu.count() === 0 && await trigger.evaluate(node => document.activeElement === node) && JSON.stringify(await pageSize()) === JSON.stringify(initial));
  }
  await frame.evaluate(() => { document.documentElement.style.zoom = ''; });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.locator('#app').evaluate(node => { node.style.height = '900px'; });
  await trigger.click();
  await page.mouse.click(2, 2);
  check('clicking outside dismisses column settings', await until(async () => await menu.count() === 0));
}
