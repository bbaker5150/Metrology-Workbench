// Run against the workspace-polish fixture in either the dev app or Forge.
export async function checkSidebarLayoutFollowup({ page, frame = page }) {
  const check = (label, passed, details = "") => {
    if (!passed) throw new Error(`${label}: ${details}`);
    console.log(`PASS: ${label}`);
  };
  const list = frame.locator('.measurement-point-list');
  const divider = frame.getByRole('separator', { name: 'Resize measurement point list' });
  const actions = frame.locator('.sidebar-global-actions');
  for (const theme of ['light', 'dark']) {
    await frame.locator('body').evaluate((node, theme) => {
      node.classList.remove('light-mode', 'dark-mode'); node.classList.add(`${theme}-mode`);
    }, theme);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    const styles = await frame.locator('.sidebar-session-header-organic').evaluate(node => {
      const properties = ['backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderRadius', 'fontSize', 'fontWeight', 'padding'];
      const read = selector => { const style = getComputedStyle(node.querySelector(selector)); return properties.map(key => style[key]); };
      return [read('.session-info-content .session-header-grid .session-header-value'), read('.session-header-field--requirement .session-header-value')];
    });
    check(`${theme}: requirements and session values share styling`, JSON.stringify(styles[0]) === JSON.stringify(styles[1]), JSON.stringify(styles));
    await divider.evaluate(async node => {
      for (let i = 0; i < 60 && getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)'; i++)
        await new Promise(requestAnimationFrame);
    });
    const restingDivider = await divider.evaluate(node => ({ background: getComputedStyle(node).backgroundColor, opacity: getComputedStyle(node, '::after').opacity }));
    check(`${theme}: divider blends into the workspace`, restingDivider.background === 'rgba(0, 0, 0, 0)' && restingDivider.opacity === '0', JSON.stringify(restingDivider));
    await divider.hover();
    check(`${theme}: divider handle appears on hover`, await divider.evaluate(node => getComputedStyle(node, '::after').opacity === '1'));
  }
  for (const zoom of [1, 0.8, 1.25]) {
    await frame.locator('.measurement-points-zoom-surface > .scoped-zoom-content').evaluate((node, zoom) => {
      node.style.zoom = String(zoom); node.style.setProperty('--scoped-content-zoom', String(zoom));
    }, zoom);
    const widths = await list.evaluate(async node => {
      const widths = [];
      for (let i = 0; i < 8; i++) {
        node.scrollLeft = node.scrollWidth;
        await new Promise(requestAnimationFrame);
        widths.push(node.scrollWidth);
      }
      return widths;
    });
    check(`zoom ${zoom}: holding scroll at the right edge cannot grow the list`, Math.max(...widths) - Math.min(...widths) <= 1, widths.join(','));
    for (const edge of ['left', 'right']) {
      await list.evaluate((node, edge) => { node.scrollLeft = edge === 'left' ? 0 : node.scrollWidth; }, edge);
      const viewport = await list.boundingBox(), bar = await actions.boundingBox();
      check(`zoom ${zoom}: toolbar stays in the ${edge} viewport`, bar.x >= viewport.x - 2 && bar.x + bar.width <= viewport.x + viewport.width + 2, JSON.stringify({ viewport, bar }));
    }
  }
  await frame.locator('.measurement-points-zoom-surface > .scoped-zoom-content').evaluate(node => { node.style.zoom = '1'; node.style.setProperty('--scoped-content-zoom', '1'); });
  await divider.dblclick();
  await frame.locator('.workspace-pane-autofit.workspace-pane-points').waitFor();
  check('wide point table auto-expands into the workspace', await frame.locator('.results-sidebar').isVisible() && !await frame.locator('.results-content').isVisible());
  const viewport = page.viewportSize();
  await page.setViewportSize({ ...viewport, width: viewport.width + 600 });
  await frame.locator('.workspace-pane-autofit.workspace-pane-split').waitFor();
  check('auto-fit restores both panes when the columns fit', await frame.locator('.results-content').isVisible());
  await page.setViewportSize(viewport);
  await frame.locator('.workspace-pane-autofit.workspace-pane-points').waitFor();
  await divider.dblclick();
  check('double click expands instrument tables', !await frame.locator('.results-sidebar').isVisible() && await frame.locator('.results-content').isVisible());
  await divider.dblclick();
  await frame.locator('.workspace-pane-points:not(.workspace-pane-autofit)').waitFor();
  check('third state explicitly expands measurement points', await frame.locator('.results-sidebar').isVisible() && !await frame.locator('.results-content').isVisible());
  await divider.dblclick();
  await frame.locator('.workspace-pane-autofit.workspace-pane-points').waitFor();
  const position = await divider.boundingBox();
  await page.mouse.move(position.x + position.width / 2, position.y + 60);
  await page.mouse.down(); await page.mouse.move(600, position.y + 60, { steps: 5 }); await page.mouse.up();
  check('drag restores free-hand split view', await frame.locator('.workspace-pane-split:not(.workspace-pane-autofit)').count() === 1);
}
