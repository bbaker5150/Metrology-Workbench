// Assert page geometry as well as dialog geometry: a bounded-looking portal
// can still extend the document's scrollable area under CSS zoom.
export async function checkColumnDialog({ frame, page, until, check }) {
  const trigger = frame.getByRole('button', { name: 'Columns', exact: true });
  const menu = frame.getByRole('dialog', { name: 'Visible measurement point columns', exact: true });
  const pageSize = () => frame.evaluate(() => ({
    html: document.documentElement.scrollHeight, body: document.body.scrollHeight,
    workspace: document.querySelector('.results-workflow-container').getBoundingClientRect().height,
  }));
  const geometry = () => menu.evaluate(node => {
    const box = node.getBoundingClientRect();
    const scrollOwners = [...node.querySelectorAll('*')].filter(el => /^(auto|scroll)$/.test(getComputedStyle(el).overflowY) && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1);
    return { modal: node.matches(':modal'), height: box.height, width: box.width,
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
    (await geometry()).modal && JSON.stringify(await pageSize()) === JSON.stringify(before)));
  check('column settings omit the redundant heading and help text', await menu.locator('h3, p').count() === 0);
  check('column settings have one shared scrollbar and fixed actions', await until(async () => {
    const g = await geometry(); return g.bounded && !g.outerOverflow && g.actionsVisible && JSON.stringify(g.scrollers) === JSON.stringify(['point-column-lists']);
  }));
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
  check('adding a column takes effect immediately', await until(async () => await rows.count() === count + 1));
  await menu.getByRole('button', { name: `Hide ${label}`, exact: true }).click();
  check('hiding a column returns it to the available list', await until(async () => await rows.count() === count && await menu.getByRole('button', { name: `Add ${label} column`, exact: true }).count() === 1));
  while (await menu.locator('.point-column-add').count()) await menu.locator('.point-column-add').first().click();
  check('showing every column does not stretch the document or workspace', JSON.stringify(await pageSize()) === JSON.stringify(before));
  await menu.locator('.point-column-lists').evaluate(node => { node.scrollTop = node.scrollHeight; });
  check('the last displayed column is reachable while dialog actions stay visible', await rows.last().evaluate(node => {
    const scroller = node.closest('.point-column-lists').getBoundingClientRect(), row = node.getBoundingClientRect();
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
    check(`dialog stays bounded with one scroll area at ${width}×${height}, ${zoom * 100}% zoom`, await until(async () => {
      const g = await geometry(); return g.bounded && !g.outerOverflow && g.actionsVisible && g.scrollers.length === 1 && g.height <= 720 * zoom + 1;
    }));
    check(`opening the dialog preserves page height at ${zoom * 100}% zoom`, JSON.stringify(await pageSize()) === JSON.stringify(initial));
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
  check('clicking the backdrop dismisses column settings', await until(async () => await menu.count() === 0));
}
