import { checkSeptember22Followup } from "./september22-followup-checks.mjs";
import { prepareInputTasking } from './input-tasking-checks.mjs';
export function prepareWorkspacePolish(session) {
  prepareInputTasking(session);
  // A genuinely short identity keeps the <200px regression independent of
  // the runner's system font. Long text is exercised separately below.
  session.uuts[0].description = "UUT";
  session.uuts[0].instrument.description = "UUT";
  session.testPoints[0].testPointInfo.qualifier = { value: "Extended calibration verification qualifier" };
  const direct = structuredClone(session.testPoints[0]);
  Object.assign(direct, { id: 'direct-polish', measurementType: 'direct', equationString: '', variableMappings: {}, variableNominals: {}, measurementBias: null });
  direct.components.forEach(c => { delete c.variableType; delete c.variableSymbol; });
  session.testPoints.push(direct);
}
export async function checkWorkspacePolish({ frame, page, saved, until, check }) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const capture = async name => { if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/${name}.png` }); };
  const divider = frame.getByRole('separator', { name: 'Resize measurement point list' });
  const columnHeader = frame.locator('.instrument-resizable-header').first();
  await columnHeader.hover();
  check('custom column add sits above its vertical divider in the full workspace', await columnHeader.evaluate(header => {
    const button = header.querySelector('.instrument-column-insert-button');
    const r = button.getBoundingClientRect(), h = header.getBoundingClientRect();
    return Math.abs(r.left + r.width / 2 - h.right) < 1.5 && r.bottom <= h.top + 1 &&
      button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  }));
  await capture('column-add-above-divider');
  const dividerIsReachable = () => divider.evaluate(node => { const r = node.getBoundingClientRect(); return r.width >= 12 && document.elementFromPoint(r.x + r.width / 2, r.y + 60) === node && getComputedStyle(node, '::after').content.includes('↔'); });
  await divider.dblclick();
  check('auto-fit keeps a visible, directly reachable divider', await dividerIsReachable());
  const autoFitMatchesColumns = async () =>
    await frame.locator('.workspace-pane-autofit').count() === 1 &&
    await frame.locator('.results-sidebar').isVisible() && await frame.locator('.results-sidebar').evaluate(node => {
      const tableWidth = node.querySelector('.measurement-points-table-content').getBoundingClientRect().width;
      const available = node.parentElement.clientWidth - 16;
      const pointsOnly = node.parentElement.classList.contains('workspace-pane-points');
      return node.clientWidth >= Math.min(tableWidth, available) - 4 &&
        (pointsOnly ? tableWidth > available - 322 : tableWidth <= available - 318);
    });
  check('first divider double-click fits point columns using the full workspace when needed', await until(autoFitMatchesColumns));
  await frame.evaluate(() => location.reload());
  await frame.getByRole('combobox', { name: 'Analysis Session' }).waitFor();
  check('auto-fit mode and fitted column geometry survive refresh', await until(autoFitMatchesColumns));
  await divider.dblclick();
  check('second divider double-click shows points at full width and keeps the divider reachable', await frame.locator('.results-sidebar').isVisible() && !await frame.locator('.results-content').isVisible() && await divider.isVisible());
  check('full-width points keep a visible, directly reachable divider', await dividerIsReachable());
  const fullExpand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await fullExpand.count()) await fullExpand.first().click();
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  const fullViewColumns = frame.getByRole('dialog', { name: 'Visible measurement point columns', exact: true });
  const hideLabels = await fullViewColumns.locator('.point-column-order-row').evaluateAll(rows => rows.filter(row => !['value', 'pfa', 'pfr'].includes(row.dataset.columnKey)).map(row => row.querySelector('button').getAttribute('aria-label')));
  for (const name of hideLabels) await fullViewColumns.getByRole('button', { name, exact: true }).click();
  await fullViewColumns.getByRole('button', { name: 'Close column settings' }).click();
  check('full-width points distribute available width evenly across columns', await until(async () => frame.locator('.sidebar-column-headers').first().evaluate(header => {
    const cells = [...header.children].map(cell => cell.getBoundingClientRect());
    const row = document.querySelector('.point-grid-item');
    const data = [...row.children].map(cell => cell.getBoundingClientRect());
    return cells.length === 3 && Math.max(...cells.map(r => r.width)) - Math.min(...cells.map(r => r.width)) < 2 && cells.at(-1).right >= header.getBoundingClientRect().right - 12 && data.every(r => Math.abs(r.width - cells[0].width) < 2);
  })));
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  await fullViewColumns.getByRole('button', { name: 'Reset Columns' }).click();
  await fullViewColumns.getByRole('button', { name: 'Close column settings' }).click();

  check('full-width points fit default columns without horizontal scrolling', await until(async () => frame.locator('.results-sidebar').evaluate(node => {
    const edge = node.getBoundingClientRect().right;
    const headers = [...node.querySelector('.sidebar-column-headers').children];
    const wrappers = [...node.querySelectorAll('.sidebar-points-scroll-wrapper, .measurement-points-table, .measurement-points-table-content')];
    return headers.every(cell => cell.getBoundingClientRect().right <= edge + 1) &&
      wrappers.every(wrapper => wrapper.scrollWidth <= wrapper.clientWidth + 1);
  })));
  check('full-width value menus stay readable within their column', await until(async () => frame.locator('.point-grid-item [data-sidebar-column="value"]').evaluateAll(cells => cells.every(cell => {
    const bounds = cell.getBoundingClientRect();
    return [...cell.querySelectorAll('.inline-unit-combobox')].every(button => {
      const box = button.getBoundingClientRect(), label = button.querySelector('span');
      return box.left >= bounds.left - 1 && box.right <= bounds.right + 1 && label.scrollWidth <= label.clientWidth + 1;
    });
  }))));
  await capture('full-width-measurement-columns');
  check('full-width points collapse session details and requirements', await frame.getByRole('button', { name: /Session Info/i }).getAttribute('aria-expanded') === 'false' && await frame.getByRole('button', { name: 'Risk & Mitigation Inputs', exact: true }).getAttribute('aria-expanded') === 'false');
  await divider.dblclick();
  check('third divider state fits instrument tables', await until(async () => await frame.locator('.workspace-pane-instrument-fit').count() === 1 && await frame.locator('.results-content').isVisible()));
  check('instrument auto-fit accommodates natural widths when space permits', await until(async () => frame.locator('.results-content').evaluate(pane => {
    const workspace = pane.parentElement;
    return [...pane.querySelectorAll('.instrument-equipment-table')].filter(table => table.getClientRects().length).every(table => {
      const needed = parseFloat(table.style.getPropertyValue('--instrument-natural-table-width')) * (table.getBoundingClientRect().width / table.offsetWidth);
      return needed > workspace.getBoundingClientRect().width - 350 || table.parentElement.getBoundingClientRect().width >= needed - 2;
    });
  })));
  await frame.evaluate(() => location.reload());
  await frame.getByRole('combobox', { name: 'Analysis Session' }).waitFor();
  check('instrument auto-fit survives refresh', await until(async () => await frame.locator('.workspace-pane-instrument-fit').count() === 1));
  await divider.dblclick();
  check('fourth double-click returns to point auto-fit', await until(autoFitMatchesColumns));

  await divider.focus(); await divider.press('Escape');
  check('keyboard restores the split workspace', await until(async () => await frame.locator('.results-sidebar').isVisible() && await frame.locator('.results-content').isVisible()));
  const start = await divider.boundingBox();
  const dragDistance = start.x > 500 ? -100 : 100;
  await page.mouse.move(start.x + 3, start.y + 80); await page.mouse.down(); await page.mouse.move(start.x + 3 + dragDistance, start.y + 80, { steps: 8 }); await page.mouse.up();
  check('dragging still resizes the split view', ((await divider.boundingBox()).x - start.x) * Math.sign(dragDistance) > 80);
  check('dragging returns the divider to free-hand mode', await frame.locator('.workspace-pane-autofit').count() === 0);
  const session = frame.getByRole('combobox', { name: 'Analysis Session' });
  await session.click();
  check('analysis session uses the styled top-layer picker', await session.evaluate(node => getComputedStyle(node).appearance === 'base-select' && getComputedStyle(node, '::picker(select)').borderRadius === '6px' && node.matches(':open')));
  await capture('polish-session-menu'); await session.press('Escape');
  check('analysis session deletion uses the common x icon', await frame.getByRole('button', { name: 'Delete Session', exact: true }).locator('[data-icon="xmark"]').count() === 1);
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const point = frame.locator('[data-point-id="point"]');
  check('all measurement column headers are centered', await frame.locator('.sidebar-column-header-cell > .sidebar-sort-header').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).textAlign === 'center' && getComputedStyle(node).justifyContent === 'center')));
  check('point data alignment follows its content type', await point.evaluate(row => [...row.querySelectorAll(':scope > [data-sidebar-column]')].every(cell => {
    const key = cell.dataset.sidebarColumn, css = getComputedStyle(cell);
    return css.textAlign === (key === 'warningIcons' ? 'right' : ['section', 'uut'].includes(key) ? 'left' : 'center');
  })));
  await frame.locator('[data-point-id="direct-polish"] [data-sidebar-column="value"] .point-value-number').click();
  await frame.locator('[data-point-id="direct-polish"] .point-value-input-slot input').press('Enter');
  await point.locator('.point-section .point-grouped-cell-label').click();
  const sectionInput = frame.locator('.point-grid-item input.section');
  check('Section enters editing on the first click from another selected row', await sectionInput.isVisible() && await sectionInput.evaluate(input => input === document.activeElement));
  await sectionInput.fill('Single click section'); await sectionInput.press('Enter');
  check('Section saves the entered text', await until(async () => (await frame.locator('.point-section').allTextContents()).some(text => text.includes('Single click section')) && saved()?.testPoints?.some(point => point.section === 'Single click section')), JSON.stringify({ sections: await frame.locator('.point-section').allInnerTexts(), saved: saved()?.testPoints?.map(point => ({id: point.id, section: point.section})) }));
  await point.getByRole('button', { name: 'UUT', exact: true }).click();
  const uutOptions = frame.getByRole('listbox', { name: 'UUT', exact: true });
  const assignedName = await uutOptions.getByRole('option', { selected: true }).innerText();
  const assignedWidth = await uutOptions.evaluate(node => node.parentElement.getBoundingClientRect().width);
  await uutOptions.getByRole('option', { name: 'Unassigned', exact: true }).click();
  await point.getByRole('button', { name: 'UUT', exact: true }).click();
  check('unassigned UUT menu retains the assigned picker width', await until(async () => Math.abs(await uutOptions.evaluate(node => node.parentElement.getBoundingClientRect().width) - assignedWidth) < 2));
  check('unassigned UUT menu shows complete option names', await uutOptions.locator('[role="option"] > span').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)));
  await uutOptions.getByRole('option', { name: assignedName, exact: true }).click();
  const uutWidth = () => point.locator('[data-sidebar-column="uut"]').evaluate(node => {
    const text = node.querySelector('.point-uut-summary');
    return { column: node.clientWidth, visible: text.clientWidth, content: text.scrollWidth, font: getComputedStyle(text).font };
  });
  check('automatic UUT width fits its text without retaining the old 200px minimum', await until(async () => { const w = await uutWidth(); return w.column < 200 && w.content <= w.visible + 1; }), JSON.stringify(await uutWidth()));
  const defaultWidth = await point.locator('[data-sidebar-column="uut"]').evaluate(node => node.clientWidth);
  // Wide typography must grow the column, rather than satisfy an arbitrary
  // pixel ceiling at the cost of clipping. This also exercises font changes.
  await frame.evaluate(() => {
    const style = document.createElement('style'); style.id = 'smoke-wide-uut';
    style.textContent = '.point-uut-summary { font: 64px monospace !important; }';
    document.head.appendChild(style); window.dispatchEvent(new Event('resize'));
  });
  check('automatic UUT width grows beyond 200px when its rendered text needs it', await until(async () => { const w = await uutWidth(); return w.column > 200 && w.content <= w.visible + 1; }), JSON.stringify(await uutWidth()));
  await frame.evaluate(() => { document.getElementById('smoke-wide-uut').remove(); window.dispatchEvent(new Event('resize')); });
  check('automatic UUT width contracts when the text becomes compact again', await until(async () => Math.abs((await uutWidth()).column - defaultWidth) < 2), JSON.stringify(await uutWidth()));
  const resize = frame.locator('.sidebar-column-header-cell--uut .sidebar-column-resizer');
  await resize.scrollIntoViewIfNeeded();
  const edge = await resize.boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 10); await page.mouse.down(); await page.mouse.move(edge.x + edge.width / 2 + 80, edge.y + 10, { steps: 8 }); await page.mouse.up();
  check('user can widen an automatically fitted column', await until(async () => await point.locator('[data-sidebar-column="uut"]').evaluate(node => node.clientWidth) >= defaultWidth + 75));
  await resize.dblclick();
  check('double-click restores content-fitted column width', await until(async () => Math.abs(await point.locator('[data-sidebar-column="uut"]').evaluate(node => node.clientWidth) - defaultWidth) < 2));
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  const columns = frame.getByRole('dialog', { name: 'Visible measurement point columns', exact: true });
  for (const label of ['Cal Int with GB', 'Cal Int w/o GB']) await columns.getByRole('button', { name: `Hide ${label}`, exact: true }).click();
  for (const label of ['Qualifier', 'Cal Int with GB', 'Cal Int w/o GB']) await columns.getByRole('button', { name: `Add ${label} column`, exact: true }).click();
  await columns.getByRole('button', { name: 'Close column settings', exact: true }).click();
  check('a newly enabled column immediately fits its longest value', await until(async () => point.locator('[data-sidebar-column="qualifier"] .point-grouped-cell-label').evaluate(node => node.clientWidth > 150 && node.scrollWidth <= node.clientWidth + 1)));
  for (const key of ['gbCalInt', 'noGbCalInt']) check(`${key} displays exactly two decimal places`, await until(async () => /^\d+\.\d{2}$/.test((await point.locator(`[data-sidebar-column="${key}"]`).innerText()).trim())));
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  await columns.getByRole('button', { name: 'Reset Columns', exact: true }).click();
  await columns.getByRole('button', { name: 'Close column settings', exact: true }).click();
  for (const zoom of [.75, 1.25]) {
    await frame.evaluate(value => { document.documentElement.style.zoom = String(value); window.dispatchEvent(new Event('resize')); }, zoom);
    check(`automatic widths remain in logical pixels at ${zoom * 100}% zoom`, await until(async () => Math.abs(await point.locator('[data-sidebar-column="uut"]').evaluate(node => node.clientWidth) - defaultWidth) < 3));
  }
  await frame.evaluate(() => { document.documentElement.style.zoom = ''; window.dispatchEvent(new Event('resize')); });
  await point.locator('[data-sidebar-column="pfa"]').click();
  const unit = point.getByRole('button', { name: 'Measurement point unit base unit', exact: true });
  await unit.click();
  check('measurement point units use the styled picker too', await frame.locator('.inline-unit-search').isVisible() && await frame.getByRole('listbox', {name:'Measurement point unit',exact:true}).isVisible());
  await capture('polish-point-unit-menu'); await frame.locator('.inline-unit-search').press('Escape');
  const output = frame.locator('.measurement-equation-status');
  check('calculated nominal and target use the original status below the input table', await output.innerText().then(text => text.includes('Calculated: 5.00000 V') && text.includes('Target 5.00000 V')));
  check('measurement inputs contain Symbol, Name and Nominal', JSON.stringify(await frame.locator('.measurement-inputs-table thead th').allTextContents()) === JSON.stringify(['Symbol', 'Name', 'Nominal']));
  check('no output row or net bias editor remains', await frame.locator('.measurement-output-row, .measurement-bias-table').count() === 0 && await frame.getByRole('button', { name: 'Edit net measurement system bias', exact: true }).count() === 0);
  await frame.getByRole('button', { name: 'Add component to budget', exact: true }).first().click();
  check('budget creation offers the manual component entry', await frame.getByRole('button', { name: /^Add manual component/ }).isVisible());
  for (const kind of ['tabular', 'equation']) {
    const item = frame.getByRole('button', { name: `Add ${kind} component`, exact: true });
    check(`Add ${kind} creation is handled by the component cog`, await item.count() === 0);
  }
  await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  for (const metric of ['PFA', 'PFR']) {
    const card = frame.locator('.budget-decision-card').filter({ has: frame.getByText(metric, { exact: true }) });
    await card.click();
    check(`${metric} plain click keeps the budget visible`, await frame.locator('.breakdown-modal-content').count() === 0);
    await card.click({ modifiers: ['Control'] });
    const modal = frame.locator('.breakdown-modal-content'); await modal.waitFor();
    check(`${metric} Ctrl-click opens its calculation`, await modal.locator('.breakdown-modal-title').innerText().then(text => text.includes(metric === 'PFA' ? 'Accept' : 'Reject')));
    await modal.locator('.modal-close-button').click();
  }
  check('risk cards omit the redundant gray captions', await frame.locator('.budget-decision-caption').count() === 0);
  await output.scrollIntoViewIfNeeded(); await capture('polish-derived-output');
  await frame.locator('[data-point-id="direct-polish"] [data-sidebar-column="pfa"]').click();
  check('direct points have no Measurement Bias table or section', await frame.locator('.measurement-bias-table').count() === 0 && await frame.getByRole('button', { name: 'Collapse Measurement Bias section', exact: true }).count() === 0);
  await capture('polish-direct');
  await frame.locator('[data-point-id="point"] [data-sidebar-column="pfa"]').click();
  await checkSeptember22Followup({ frame, page, saved, until, check });
}
