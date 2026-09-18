import { readFileSync } from 'node:fs';
import { preparePointHighlight } from './point-highlight-checks.mjs';
import { suppliedCase } from '../src/modules/uncertainty/utils/risk8/suppliedBiasParity.fixtures.js';

export function preparePointUsability(session) {
  preparePointHighlight(session);
  session.uuts[0].description = 'DMM';
  session.testPoints.slice(0, 3).forEach((point, index) => {
    Object.assign(point.testPointInfo.parameter, { value: [10, 9.6, 1200][index], unit: index === 2 ? 'mV' : 'V' });
  });
  const vector = JSON.parse(readFileSync(new URL('../src/modules/uncertainty/utils/risk8/suppliedBiasParityVectors.json', import.meta.url))).cases.find(item => item.type === 5);
  const fixture = suppliedCase(vector);
  const uut = fixture.session.uuts[0]; uut.id = 'boundary-uut'; uut.description = 'Boundary UUT'; uut.measurementAreaNames = ['Voltage'];
  Object.assign(uut.ranges[0], { min: 0, max: 200 });
  const point = fixture.point; point.id = 'boundary-point'; point.activeUutId = uut.id; point.associatedUutIds = [uut.id]; point.measurementAreaId = 'voltage'; point.testPointInfo.parameter.name = 'Voltage';
  session.uuts.push(uut); session.tmdes.push(...fixture.session.tmdes); session.testPoints.push(point);
}

export async function checkPointUsability({ frame, page, check, until }) {
  await page.setViewportSize({ width: 1600, height: 1050 });
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const first = frame.locator('[data-point-id="parity-1"]');
  const list = frame.locator('.measurement-points-table');
  const uut = first.locator('[data-sidebar-column="uut"]');
  await uut.click({ position: { x: (await uut.boundingBox()).width - 5, y: 12 } });
  check('blank UUT cell space selects its point without opening assignment', await first.evaluate(row => row.classList.contains('active')) && await frame.getByRole('listbox', { name: 'UUT', exact: true }).count() === 0);
  const value = first.locator('[data-sidebar-column="value"]');
  await value.click({ position: { x: (await value.boundingBox()).width - 3, y: 12 } });
  check('blank Value cell space does not open an editor', await first.locator('input.sidebar-inline-input.value').count() === 0);
  await first.getByRole('button', { name: 'UUT', exact: true }).click();
  check('clicking UUT text still opens assignment', await frame.getByRole('listbox', { name: 'UUT', exact: true }).isVisible());
  await page.keyboard.press('Escape');
  const unitX = await frame.locator('[data-point-id="parity-1"] .point-unit-control, [data-point-id="merged-1"] .point-unit-control, [data-point-id="merged-2"] .point-unit-control').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().left));
  check('different value lengths and units share an aligned unit start', unitX.length === 3 && Math.max(...unitX) - Math.min(...unitX) < .5, JSON.stringify(unitX));
  check('full unit labels fit inside their controls', await frame.locator('.point-unit-select').evaluateAll(nodes => nodes.every(node => {
    const css = getComputedStyle(node), ctx = document.createElement('canvas').getContext('2d'); ctx.font = css.font;
    return node.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) >= ctx.measureText(node.selectedOptions[0]?.textContent || '').width;
  })));
  await first.locator('.point-value-number').click();
  const input = first.locator('input.sidebar-inline-input.value');
  const selected = locator => locator.evaluate(node => node.selectionStart === 0 && node.selectionEnd === node.value.length);
  check('opening the value editor selects its existing text', await until(() => selected(input)));
  await input.evaluate(node => node.setSelectionRange(0, 0)); await input.click();
  check('clicking an already focused input reselects its value', await until(() => selected(input)));
  await input.press('7');
  check('typing replaces the selected value', await input.inputValue() === '7');
  await input.press('Escape');
  check('session fields use two equally spaced tracks', await frame.locator('.session-header-grid').evaluate(grid => {
    const widths = getComputedStyle(grid).gridTemplateColumns.split(' ').map(parseFloat);
    return widths.length === 2 && Math.abs(widths[0] - widths[1]) < 1;
  }));
  const sessionField = frame.locator('.session-header-grid .session-header-value').first();
  await sessionField.click();
  const metadata = frame.locator('.session-header-grid input.session-header-input').first();
  check('session metadata selects its existing value', await until(() => selected(metadata)));
  await metadata.press('Escape');
  check('computed risk metrics never use a yellow status', await frame.locator('.point-risk-metric').evaluateAll(nodes => nodes.every(node => !node.style.getPropertyValue('--metric-status-color').includes('warning'))));
  const columns = frame.getByRole('button', { name: 'Columns', exact: true });
  await columns.click();
  check('Point Information is a regular displayed Warnings column', await frame.getByRole('button', { name: 'Hide Point Information', exact: true }).count() === 1 && await frame.locator('.point-column-selected .filter-option-group-title').filter({ hasText: /^Warnings$/ }).count() === 1);
  await frame.getByRole('button', { name: 'Hide Point Information', exact: true }).click();
  check('hidden Point Information moves into Add Columns', await frame.getByRole('button', { name: 'Add Point Information column', exact: true }).count() === 1 && await first.locator('[data-sidebar-column="warningIcons"]').count() === 0);
  await frame.getByRole('button', { name: 'Set as Default', exact: true }).click();
  await frame.getByRole('button', { name: 'Add Point Information column', exact: true }).click();
  await frame.getByRole('button', { name: 'Reset Columns', exact: true }).click();
  check('Reset Columns restores the personal default', await frame.getByRole('button', { name: 'Add Point Information column', exact: true }).count() === 1);
  check('saved defaults persist visibility and order', await frame.locator('body').evaluate(() => { const defaults = JSON.parse(localStorage.getItem('uncertalytics.pointColumnDefaults.v1')); return defaults.columns.warningIcons === false && defaults.order.includes('warningIcons'); }));
  await frame.getByRole('button', { name: 'Add Point Information column', exact: true }).click();
  await columns.click();
  const boundary = frame.locator('[data-point-id="boundary-point"]');
  check('boundary fixture displays the full Boundary badge at automatic width', await until(async () => await boundary.locator('.point-method-badge').count() === 1));
  const separator = frame.getByRole('separator', { name: 'Resize PFA column', exact: true });
  await separator.scrollIntoViewIfNeeded();
  const rect = await separator.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down(); await page.mouse.move(rect.x - 160, rect.y + rect.height / 2, { steps: 8 }); await page.mouse.up();
  check('PFA can shrink to the same minimum as other risk columns', await boundary.locator('[data-sidebar-column="pfa"]').evaluate(cell => cell.getBoundingClientRect().width <= 45));
  check('compact boundary marker keeps its explanation inside the cell', await boundary.locator('.point-method-badge').evaluate(badge => {
    const bounds = badge.getBoundingClientRect(), cell = badge.parentElement.getBoundingClientRect();
    return badge.classList.contains('is-compact') && badge.title.includes('Measured value unknown') && bounds.right <= cell.right + .5 && bounds.left >= cell.left - .5;
  }));
  await separator.dblclick();
  await list.evaluate(node => { node.scrollLeft = 0; node.scrollTop = 0; });
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/point-usability.png` });
  await frame.locator('[data-tour="tab-overview"]').click();
}
