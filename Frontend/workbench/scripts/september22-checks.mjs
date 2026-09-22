import { prepareInputTasking } from './input-tasking-checks.mjs';

export function prepareSeptember22(session) {
  prepareInputTasking(session);
  const range = session.uuts[0].ranges[0];
  range.tolerances = { reading: { high: 1, low: -1, unit: '%', distribution: '1.732' } };
  const point = session.testPoints[0];
  point.uutTolerance = { ...point.uutTolerance, ...range, floor: undefined };
  session.testPoints = Array.from({ length: 30 }, (_, i) => ({ ...structuredClone(point), id: i ? `point-${i}` : 'point' }));
}

export async function checkSeptember22({ frame, page, saved, until, check }) {
  const size = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.locator('#app').evaluate((node, h) => { node.style.height = `${h}px`; }, height);
  };
  const capture = async name => {
    if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/${name}.png` });
  };
  await size(1600, 900);
  for (const name of ['Session Info', 'Risk Inputs', 'Mitigation Inputs']) {
    const toggle = frame.getByRole('button', { name, exact: true });
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  }
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const sidebar = frame.locator('.measurement-point-list');
  const scrollOwners = () => sidebar.evaluate(node => [node, ...node.querySelectorAll('*')].filter(el => {
    const css = getComputedStyle(el);
    return /^(auto|scroll)$/.test(css.overflowY) && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1;
  }).map(el => el.className));
  check('expanded session details and thirty points have exactly one vertical scroll owner',
    await until(async () => JSON.stringify(await scrollOwners()) === JSON.stringify(['measurement-point-list'])));
  await capture('september22-sidebar-top');
  await sidebar.evaluate(node => { node.scrollTop = node.scrollHeight; });
  check('the same sidebar scrollbar reaches the last measurement point', await until(async () => sidebar.evaluate(node => {
    const box = node.getBoundingClientRect(), last = node.querySelector('.point-grid-item:last-child');
    const rows = node.querySelectorAll('.point-grid-item');
    return rows.length === 30 && last && rows[rows.length - 1].getBoundingClientRect().bottom <= box.bottom;
  })));
  check('point column headings stick inside the shared sidebar viewport', await sidebar.evaluate(node => {
    const top = node.getBoundingClientRect().top, header = node.querySelector('.sidebar-column-header-stack').getBoundingClientRect();
    return Math.abs(header.top - top) < 3;
  }));
  await capture('september22-sidebar-bottom');
  await sidebar.evaluate(node => { node.scrollTop = 0; });
  const info = frame.locator('.sidebar-session-info-zoom-surface');
  const infoLeft = await info.evaluate(node => node.getBoundingClientRect().left);
  await sidebar.evaluate(node => { node.scrollLeft = node.scrollWidth; });
  check('horizontal point scrolling keeps session details anchored', await sidebar.evaluate(node => node.scrollLeft > 0) &&
    Math.abs(await info.evaluate(node => node.getBoundingClientRect().left) - infoLeft) < 2);
  await sidebar.evaluate(node => { node.scrollLeft = 0; });

  const first = frame.locator('[data-point-id="point"]');
  await first.locator('[data-sidebar-column="pfa"]').click();
  const unit = first.getByRole('combobox', { name: 'Measurement point unit', exact: true });
  check('compatible percentage tolerance initially produces limits and risk', await until(async () => /\d/.test(await first.locator('[data-sidebar-column="pfa"]').innerText())));
  await unit.selectOption('A');
  check('incompatible percentage tolerance blocks both UUT limits, uncertainty and risk', await until(async () => {
    const noNumbers = await first.evaluate(node => ['lowLimit', 'highLimit', 'standardUncertainty', 'measurementUncertainty', 'pfa', 'pfr'].every(key => {
      const cell = node.querySelector(`[data-sidebar-column="${key}"]`);
      return cell && !/\d/.test(cell.textContent);
    }));
    const point = saved().testPoints[0];
    return noNumbers && point.is_detailed_uncertainty_calculated === false && point.expanded_uncertainty_absolute_base == null;
  }));
  await capture('september22-incompatible-units');
  await unit.selectOption('V');
  check('restoring compatible units recalculates limits and risk', await until(async () => /\d/.test(await first.locator('[data-sidebar-column="pfa"]').innerText())));

  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  const menu = frame.getByRole('dialog', { name: 'Visible measurement point columns', exact: true });
  const geometry = () => menu.evaluate(node => {
    const box = node.getBoundingClientRect();
    const lists = [...node.querySelectorAll('.sidebar-column-order-list, .sidebar-filter-sections')];
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height, viewport: innerHeight,
      scrollbars: lists.filter(el => el.scrollHeight > el.clientHeight + 1).length,
      outerOverflow: node.scrollHeight > node.clientHeight + 1,
      bounded: box.top >= 0 && box.bottom <= innerHeight + 1 && box.left >= 0 && box.right <= innerWidth + 1 };
  });
  await size(2200, 2000);
  check('roomy column menu displays both lists without scrolling', await until(async () => {
    const g = await geometry(); return g.bounded && !g.outerOverflow && g.scrollbars === 0;
  }));
  // At this height both lists exceed the viewport after seven additions.
  await size(1600, 650);
  for (let i = 0; i < 7; i++) await menu.locator('.point-column-add').first().click();
  check('two column scrollbars appear only after the menu fills the viewport', await until(async () => {
    const g = await geometry(); return g.scrollbars === 2 && g.height >= g.viewport - 24 && !g.outerOverflow && g.bounded;
  }));
  check('column menu is beside the Columns button', await menu.evaluate(node => {
    const menu = node.getBoundingClientRect(), trigger = document.querySelector('[data-tour="sidebar-columns"]').getBoundingClientRect();
    return menu.left >= trigger.right || menu.right <= trigger.left;
  }));
  await capture('september22-columns-full-height');
  for (const zoom of [0.75, 1.25]) {
    await frame.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
    await size(1500, 700);
    check(`sidebar retains one vertical scrollbar at ${zoom * 100}% zoom`, await until(async () => (await scrollOwners()).length === 1));
    check(`column menu remains inside viewport at ${zoom * 100}% zoom`, await until(async () => {
      const g = await geometry(); return g.bounded && !g.outerOverflow && (g.scrollbars < 2 || g.height >= g.viewport - 24);
    }));
  }
  await frame.evaluate(() => { document.documentElement.style.zoom = ''; });
  await size(600, 600);
  check('narrow-screen menu uses the full available height without outer scrolling', await until(async () => {
    const g = await geometry(); return g.bounded && !g.outerOverflow && g.height >= g.viewport - 24;
  }));
  await menu.getByRole('button', { name: 'Reset Columns', exact: true }).click();
  await menu.press('Escape');
  await size(1600, 900);
}
