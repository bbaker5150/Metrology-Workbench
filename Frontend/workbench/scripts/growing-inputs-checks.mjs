import { prepareIndependentColumns } from './independent-columns-checks.mjs';

export function prepareGrowingInputs(session) {
  prepareIndependentColumns(session);
}

// Real browser geometry is the contract: text, signs, and decimals must fit
// inside the input, not merely have a larger CSS width declaration.
export async function checkGrowingInputs({ frame, page, check, saved, until }) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const settle = () => page.waitForTimeout(220);
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  await frame.locator('.point-grid-item').first().click();
  await settle();
  const tables = frame.locator('.instrument-equipment-table');
  for (const index of [0, 1]) {
    const dimensions = await tables.nth(index).evaluate(table => {
      const card = table.closest('.panel-card').getBoundingClientRect();
      const workspace = table.closest('.detailed-view-section-layout').getBoundingClientRect();
      return { card: card.width, workspace: workspace.width };
    });
    check(`${index ? 'TMDE' : 'UUT'} defaults to the full budget workspace width`, Math.abs(dimensions.card - dimensions.workspace) < 2, JSON.stringify(dimensions));
  }
  check('unconfigured bias settings are hidden', await frame.locator('.measurement-bias-panel').count() === 0);
  await frame.locator('.budget-final-support').waitFor();
  check('final budget always shows its contribution chart', await frame.locator('.budget-final-support .bargraph-container').count() > 0);
  check('contribution chart has no redundant heading', await frame.locator('.budget-final-support .contribution-plot-title').count() === 0);
  check('contribution chart has no visibility toggle', await frame.getByRole('button', { name: /contribution chart/i }).count() === 0);
  check('contribution chart has no border', await frame.locator('.budget-final-support .bargraph-container').first().evaluate(node => getComputedStyle(node).borderTopWidth === '0px'));

  const longValue = '-123456789.123456789';
  const fits = input => input.evaluate(node => {
    const context = document.createElement('canvas').getContext('2d');
    const style = getComputedStyle(node); context.font = style.font;
    return node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) >= context.measureText(node.value).width;
  });
  await frame.getByRole('button', { name: 'Edit nominal for equation variable a' }).click();
  const nominal = frame.getByRole('spinbutton', { name: 'Nominal value for equation variable a' });
  const shortWidth = await nominal.evaluate(node => node.getBoundingClientRect().width);
  await nominal.fill(longValue); await settle();
  check('measurement nominal expands to display a long signed decimal', await fits(nominal) && await nominal.evaluate(node => node.getBoundingClientRect().width) > shortWidth);
  if (process.env.TASKING_SCREENSHOT) await page.screenshot({ path: process.env.TASKING_SCREENSHOT });
  await nominal.fill('5'); await nominal.press('Enter');
  check('nominal still saves through the session adapter', await until(() => String(saved().testPoints[0].variableNominals.a.value) === '5'));

  const dynamic = frame.locator('.budget-dynamic-row').first();
  await dynamic.locator('.dynamic-tolerance-cell button').click();
  const tabular = frame.getByLabel('Uncertainty row 1', { exact: true });
  await tabular.fill('0.123456789123456789'); await settle();
  check('tabular uncertainty input displays its complete decimal', await fits(tabular));
  await tabular.press('Escape');

  const row = tables.first().locator('tr.instrument-function-row').first();
  await row.locator('td.cell-value').first().locator('.inline-tolerance-summary').first().click();
  const minimum = tables.first().getByPlaceholder('min', { exact: true }).first();
  await minimum.fill(longValue); await settle();
  check('uncontrolled range-bound input expands while typing', await fits(minimum));
  await minimum.fill('0'); await minimum.press('Enter');
  await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
}
