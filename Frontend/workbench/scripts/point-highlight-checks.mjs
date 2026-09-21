import { prepareMultiSourceBias } from './multi-source-bias-checks.mjs';

export function preparePointHighlight(session) {
  prepareMultiSourceBias(session);
  const first = session.testPoints[0];
  session.testPoints.splice(1, 0, ...[1, 2].map(index => ({ ...structuredClone(first), id: `merged-${index}` })));
}

export async function checkPointHighlight({ frame, page, until, check, saved }) {
  await page.setViewportSize({ width: 1600, height: 1050 });
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const point = frame.locator('[data-point-id="merged-1"]');
  await point.locator('[data-sidebar-column="pfa"]').click();
  const outline = frame.locator('.point-selection-outline');
  await frame.locator('.measurement-points-table').evaluate(node => { node.scrollLeft = 0; });
  await page.waitForTimeout(100);
  check('selected points have an instrument-style outer path', await until(async () => await outline.locator('path').count() > 0));
  for (const dark of [false, true]) {
    await frame.locator('body').evaluate((body, value) => body.classList.toggle('dark-mode', value), dark);
    check(`point rows have no horizontal gaps or shadow dividers (${dark ? 'dark' : 'light'})`, await point.evaluate(row => {
      const style = getComputedStyle(row), next = row.nextElementSibling;
      return style.boxShadow === 'none' && style.marginBottom === '0px' && Math.abs(row.getBoundingClientRect().bottom - next.getBoundingClientRect().top) < .1;
    }));
    check(`outline uses the same colored edge and glow as instruments (${dark ? 'dark' : 'light'})`, await outline.locator('path').first().evaluate(path => {
      const style = getComputedStyle(path);
      return style.stroke !== 'none' && style.filter.includes('drop-shadow') && getComputedStyle(path.parentElement).pointerEvents === 'none';
    }));
    if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await frame.locator('.measurement-points-table').screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/point-outline-${dark ? 'dark' : 'light'}.png` });
  }
  const area = frame.locator('.area-header-sticky').first();
  await area.click({ position: { x: 5, y: 5 } });
  check('area selection includes its points', await frame.locator('.point-grid-item.active').count() >= 6);
  check('a whole selected area has no internal horizontal selection edges', await until(async () => await outline.locator('path').first().evaluate(path => {
    const segments = [...path.getAttribute('d').matchAll(/M([\d.-]+),([\d.-]+)L([\d.-]+),([\d.-]+)/g)].map(match => match.slice(1).map(Number));
    const horizontalY = new Set(segments.filter(([, y1, , y2]) => y1 === y2).map(([, y]) => y));
    return horizontalY.size === 2;
  })));
  await area.press('Escape');
  check('Escape clears point-area selection', await until(async () => await area.getAttribute('data-area-selected') === 'false' && await frame.locator('.point-grid-item.active').count() === 0), JSON.stringify({selected: await area.getAttribute('data-area-selected'), rows: await frame.locator('.point-grid-item.active').count()}));
  await point.locator('[data-sidebar-column="pfa"]').click();
  const results = frame.locator('.budget-results-zoom-surface');
  check('compact results default to 100 percent', await until(async () => await results.evaluateAll(nodes => nodes.length > 2 && nodes.every(node => node.dataset.zoomLevel === '1' && node.querySelector('.scoped-zoom-content').style.zoom === '0.8'))));
  check('only the final measurement result has the Final Results title', await results.evaluateAll(nodes => nodes.every((node, index) => node.textContent.includes(index === nodes.length - 1 ? 'Final Results' : 'Results') && (index === nodes.length - 1 || !node.textContent.includes('Final Results')))));
  // Dispatch the same bubbling Ctrl+wheel event consumed by scoped scaling.
  // This avoids coupling the regression to the OS's Ctrl+wheel interception.
  await frame.locator('body').evaluate(() => localStorage.setItem('workbench:ui-scale-lock', 'false'));
  const zoom = async (surface, count) => {
    for (let index = 0; index < count; index++) {
      await surface.evaluate(node => node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 100 })));
      await page.waitForTimeout(80);
    }
  };
  await zoom(results.first(), 2);
  check('scaling one Results table scales every Results table to 80 percent', await results.evaluateAll(nodes => nodes.every(node => node.dataset.zoomLevel === '0.8')));
  const budgets = frame.locator('.budget-section-table-wrap');
  await zoom(budgets.first(), 2);
  check('budget table scales are linked independently of Results', await budgets.evaluateAll(nodes => nodes.every(node => node.dataset.zoomLevel === '0.8')) && await results.first().getAttribute('data-zoom-level') === '0.8');
  const decision = frame.locator('.budget-decision-zoom-surface');
  await zoom(decision, 2);
  check('PFA/PFR cards support their own shared scale', await decision.getAttribute('data-zoom-level') === '0.8' && await decision.locator('.budget-decision-card').count() === 2);
  const previousHeadings = await frame.locator(".budget-section-title-row h4").allTextContents();
  await frame.getByRole('button', { name: 'Edit measurement equation', exact: true }).click();
  await frame.getByLabel('Measurement equation', { exact: true }).fill('a+b+c');
  await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  check('new equation variable creates another results table', await until(async () => saved().testPoints.find(p => p.id === 'merged-1').equationString === 'a+b+c' && (await frame.locator(".budget-section-title-row h4").allTextContents()).some(title => !previousHeadings.includes(title) && /^c uncertainty budget$/i.test(title.trim()))));
  check('new Results and budget tables inherit shared scales', await results.evaluateAll(nodes => nodes.every(node => node.dataset.zoomLevel === '0.8')) && await budgets.evaluateAll(nodes => nodes.every(node => node.dataset.zoomLevel === '0.8')));
  check('unnamed variable has Results while only the last table has Final Results', await results.evaluateAll(nodes => nodes.filter(node => node.textContent.includes('Final Results')).length === 1 && nodes.at(-1).textContent.includes('Final Results')));
  if (!await frame.getByLabel('Measurement equation', { exact: true }).count()) await frame.getByRole('button', { name: 'Edit measurement equation', exact: true }).click();
  await frame.getByLabel('Measurement equation', { exact: true }).fill('a+b');
  await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
  // Dismiss instrument areas in both the point detail and overview renderers.
  for (const overview of [false, true]) {
    if (overview) await frame.locator('[data-tour="tab-overview"]').click();
    const table = frame.locator('.instrument-equipment-table').first();
    const header = table.locator('.instrument-area-section-row').first();
    // Earlier checks scroll into the equation/results stack. Return the real
    // nested scrollers to the top before targeting a sticky instrument header.
    await table.evaluate(node => { for (let parent = node.parentElement; parent; parent = parent.parentElement) { parent.scrollTop = 0; parent.scrollLeft = 0; } });
    await page.waitForTimeout(150);
    await header.click();
    check(`instrument area selects ranges (${overview ? 'overview' : 'detail'})`, await table.locator('[data-range-selected="true"]').count() > 0);
    await header.press('Escape');
    check(`Escape clears instrument-area selection (${overview ? 'overview' : 'detail'})`, await table.locator('[data-range-selected="true"]').count() === 0);
  }
  const notice = frame.getByRole('alertdialog');
  if (await notice.count()) await notice.getByRole('button', { name: /OK|Close/i }).first().click();
}
