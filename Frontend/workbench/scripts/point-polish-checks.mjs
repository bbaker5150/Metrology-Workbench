import { preparePointUsability } from './point-usability-checks.mjs';

export function preparePointPolish(session) {
  preparePointUsability(session);
  // An available instrument unit is deliberately unused by any point.
  session.uuts[0].ranges.push({ id: 'unused-unit-range', min: 0, max: 1, unit: 'kV' });
}

export async function checkPointPolish({ frame, page, check, until, saved }) {
  await page.setViewportSize({ width: 1600, height: 1050 });
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const first = frame.locator('[data-point-id="parity-1"]');
  const second = frame.locator('[data-point-id="merged-1"]');
  const list = frame.locator('.measurement-points-table');
  check('area header includes only units used by its points', await frame.locator('.function-header-unit-chip').first().textContent() === 'V, mV');
  await first.locator('[data-sidebar-column="pfa"]').click();
  await first.press('Escape');
  check('Escape clears the active point and its outline', await until(async () => await frame.locator('.point-grid-item.active, .point-grid-item.active-point, .point-selection-outline path').count() === 0));
  await first.locator('[data-sidebar-column="pfa"]').click();
  await second.locator('[data-sidebar-column="value"]').click({ position: { x: 3, y: 3 }, modifiers: ['Control'] });
  check('multi-selection fixture has two selected rows', await frame.locator('.point-grid-item.active').count() === 2);
  await second.press('Escape');
  check('Escape clears multiple selected points', await until(async () => await frame.locator('.point-grid-item.active, .point-grid-item.active-point, .point-selection-outline path').count() === 0));
  await list.evaluate(node => { node.scrollLeft = 0; });
  await first.locator('[data-sidebar-column="value"]').hover();
  check('hover tints the target cell without tinting its siblings', await first.evaluate(row => {
    const target = row.querySelector('[data-sidebar-column="value"]'), sibling = row.querySelector('[data-sidebar-column="pfa"]');
    return target.classList.contains('is-cell-hovered') && !sibling.classList.contains('is-cell-hovered') && getComputedStyle(target).backgroundColor !== getComputedStyle(sibling).backgroundColor;
  }));
  await first.locator('[data-sidebar-column="uut"] .point-uut-summary').hover();
  check('hovering UUT highlights the full column, including merged cells', await frame.locator('.is-cell-hovered').evaluateAll(cells => cells.length === 7 && cells.every(cell => cell.dataset.sidebarColumn === 'uut')));
  const verifyGuides = async label => {
    check(`continuous dividers match every visible boundary (${label})`, await until(async () => await frame.locator('.measurement-points-table-content').evaluate(content => {
      const rows = [...content.querySelectorAll('.measurement-area-points .point-grid-item')];
      const lines = [...content.querySelectorAll('.point-column-guide')];
      const first = rows[0], last = rows.at(-1), bounds = content.getBoundingClientRect(), scale = bounds.width / content.offsetWidth;
      const order = getComputedStyle(first).gridTemplateAreas.replaceAll('"', '').split(/\s+/);
      const cells = [...first.querySelectorAll(':scope > [data-sidebar-column]')].sort((a,b) => order.indexOf(a.dataset.sidebarColumn) - order.indexOf(b.dataset.sidebarColumn));
      return lines.length === cells.length - 1 && lines.every((line, index) => {
        const x = (cells[index].getBoundingClientRect().right + cells[index+1].getBoundingClientRect().left) / 2;
        return Math.abs(Number(line.getAttribute('x1')) * scale + bounds.left - x) < .6 &&
          Math.abs(Number(line.getAttribute('y1')) * scale + bounds.top - first.getBoundingClientRect().top) < .6 &&
          Math.abs(Number(line.getAttribute('y2')) * scale + bounds.top - last.getBoundingClientRect().bottom) < .6;
      }) && cells.every(cell => getComputedStyle(cell, '::before').content === 'none');
    })));
  };
  await verifyGuides('default');
  check('header resize rules align with the body rules', await frame.locator('.measurement-points-table-content').evaluate(content => {
    const lines = [...content.querySelectorAll('.point-column-guide')];
    const handles = [...content.querySelectorAll('.sidebar-column-resizer')];
    const bounds = content.getBoundingClientRect(), scale = bounds.width / content.offsetWidth;
    return lines.every((line, index) => {
      const handle = handles[index].getBoundingClientRect();
      return Math.abs(handle.left + handle.width / 2 - Number(line.getAttribute('x1')) * scale - bounds.left) < 1;
    });
  }));
  const zoomContent = frame.locator('.measurement-points-zoom-surface > .scoped-zoom-content');
  await zoomContent.evaluate(node => { node.style.zoom = '.8'; });
  await verifyGuides('80 percent');
  await zoomContent.evaluate(node => { node.style.zoom = '1'; });
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  await frame.getByRole('button', { name: 'Hide Point Information', exact: true }).click();
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  await verifyGuides('hidden column');
  await first.locator('[data-sidebar-column="pfa"]').click();
  const chart = frame.locator('.contribution-plot-native');
  const showChart = frame.getByRole('button', { name: 'Show contribution chart', exact: true });
  if (await showChart.count()) await showChart.click();
  check('contribution chart is present for the selected point', await until(() => chart.count()));
  await frame.getByLabel('Color for Voltage measurement area', { exact: true }).fill('#c23b8a');
  check('area color saves and reaches the chart and selected outline', await until(async () => {
    const color = await chart.evaluate(node => node.style.getPropertyValue('--contribution-color'));
    return color === '#c23b8a' && await frame.locator('.point-selection-outline path').first().evaluate(node => node.style.getPropertyValue('--instrument-function-color') === '#c23b8a');
  }));
  check('area header and rows do not animate colors at different speeds', await frame.locator('.measurement-group-container').first().evaluate(group => {
    return [group.querySelector('.area-header-sticky'), group.querySelector('.area-label'), group.querySelector('.point-grid-item')].every(node => getComputedStyle(node).transitionDuration === '0s');
  }));
  check('contribution bars use the selected area color', await chart.locator('.contribution-plot-bar').first().evaluate(bar => getComputedStyle(bar).backgroundImage.includes('194, 59, 138')));
  for (const overview of [false, true]) {
    if (overview) await frame.locator('[data-tour="tab-overview"]').click();
    check(`instrument tables have no gap above their column headers (${overview ? 'overview' : 'budget'})`, await frame.locator('.instrument-panel-table-container').evaluateAll(nodes => nodes.length > 0 && nodes.every(node => getComputedStyle(node).paddingTop === '0px')));
    check(`add-column buttons remain fully inside the header (${overview ? 'overview' : 'budget'})`, await frame.locator('.instrument-column-insert-button').evaluateAll(buttons => buttons.length > 0 && buttons.every(button => {
      const box = button.getBoundingClientRect(), header = button.closest('th').getBoundingClientRect();
      return box.top >= header.top && box.bottom <= header.bottom;
    })));
  }
  await list.evaluate(node => { node.scrollLeft = 0; node.scrollTop = 0; });
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/point-polish.png` });
}
