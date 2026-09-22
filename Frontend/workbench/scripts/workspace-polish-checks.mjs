import { prepareInputTasking } from './input-tasking-checks.mjs';
export function prepareWorkspacePolish(session) {
  prepareInputTasking(session);
  const direct = structuredClone(session.testPoints[0]);
  Object.assign(direct, { id: 'direct-polish', measurementType: 'direct', equationString: '', variableMappings: {}, variableNominals: {}, measurementBias: null });
  direct.components.forEach(c => { delete c.variableType; delete c.variableSymbol; });
  session.testPoints.push(direct);
}
export async function checkWorkspacePolish({ frame, page, saved, until, check }) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const capture = async name => { if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/${name}.png` }); };
  const divider = frame.getByRole('separator', { name: 'Resize measurement point list' });
  await divider.dblclick();
  check('first divider double-click shows the measurement list at full width', await frame.locator('.results-sidebar').isVisible() && !await frame.locator('.results-content').isVisible() && await frame.locator('.results-sidebar').evaluate(node => node.clientWidth > node.parentElement.clientWidth - 70));
  await frame.evaluate(() => location.reload());
  await frame.getByRole('combobox', { name: 'Analysis Session' }).waitFor();
  check('full-width pane choice survives refresh', !await frame.locator('.results-content').isVisible());
  await divider.dblclick();
  check('second divider double-click shows tables at full width and keeps the divider reachable', !await frame.locator('.results-sidebar').isVisible() && await frame.locator('.results-content').isVisible() && await divider.isVisible());
  await divider.focus(); await divider.press('Escape');
  check('keyboard restores the split workspace', await frame.locator('.results-sidebar').isVisible() && await frame.locator('.results-content').isVisible());
  const start = await divider.boundingBox();
  await page.mouse.move(start.x + 3, start.y + 80); await page.mouse.down(); await page.mouse.move(start.x + 103, start.y + 80, { steps: 8 }); await page.mouse.up();
  check('dragging still resizes the split view', (await divider.boundingBox()).x > start.x + 80);
  const session = frame.getByRole('combobox', { name: 'Analysis Session' });
  await session.click();
  check('analysis session uses the styled top-layer picker', await session.evaluate(node => getComputedStyle(node).appearance === 'base-select' && getComputedStyle(node, '::picker(select)').borderRadius === '6px' && node.matches(':open')));
  await capture('polish-session-menu'); await session.press('Escape');
  check('analysis session deletion uses the common x icon', await frame.getByRole('button', { name: 'Delete Session', exact: true }).locator('[data-icon="xmark"]').count() === 1);
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const point = frame.locator('[data-point-id="point"]');
  await point.locator('[data-sidebar-column="pfa"]').click();
  const unit = point.getByRole('combobox', { name: 'Measurement point unit' });
  await unit.click();
  check('measurement point units use the styled picker too', await unit.evaluate(node => getComputedStyle(node).appearance === 'base-select' && node.matches(':open')));
  await capture('polish-point-unit-menu'); await unit.press('Escape');
  const output = frame.locator('.measurement-inputs-table .measurement-output-row');
  check('calculated and target nominal are integrated in the output cell', await output.innerText().then(text => text.includes('Target 5 V') && text.includes('Calculated 5.00000 V')) && await frame.locator('.measurement-equation-status').count() === 0);
  check('derived output bias includes its calculated net value', await output.locator('.net-bias-inherited .measurement-calculated-value').innerText().then(text => text.includes('Calculated 0 V')));
  const bias = frame.getByRole('button', { name: 'Input bias display', exact: true });
  await frame.locator('.analysis-tabs').hover();
  check('Bias selector border is hidden at rest', await bias.evaluate(node => getComputedStyle(node).borderTopColor === 'rgba(0, 0, 0, 0)'));
  await bias.hover();
  check('Bias selector border appears on hover', await bias.evaluate(node => getComputedStyle(node).borderTopColor !== 'rgba(0, 0, 0, 0)'));
  await frame.getByRole('button', { name: 'Add component to budget', exact: true }).first().click();
  for (const kind of ['tabular', 'equation']) {
    const item = frame.getByRole('button', { name: `Add ${kind} component`, exact: true });
    check(`Add ${kind} component uses consistent wording and a description`, await item.locator('small').innerText().then(text => text.length > 20));
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
  const section = frame.locator('[data-detail-section="equation"]');
  check('direct points have a Measurement Bias section', await until(async () => await frame.getByRole('button', { name: 'Collapse Measurement Bias section', exact: true }).isVisible()));
  check('direct bias has no calculated hint until a net bias is authored', await frame.locator('.measurement-bias-table .measurement-calculated-value').count() === 0);
  await frame.getByRole('button', { name: 'Edit net measurement system bias', exact: true }).click();
  const input = frame.getByRole('textbox', { name: 'Net measurement system bias', exact: true });
  await input.fill('.25'); await input.press('Enter');
  check('authored direct bias shows the calculated net value', await until(async () => (await frame.locator('.measurement-bias-table .measurement-calculated-value').innerText()).includes('Calculated 0.25 V') && saved().testPoints.find(p => p.id === 'direct-polish').measurementBias?.value === '.25'));
  await capture('polish-direct-bias');
  await section.getByRole('button', { name: 'Collapse Measurement Bias section', exact: true }).click();
  check('Measurement Bias collapses and saves its state', await until(() => saved().detailCollapsedSections?.includes('equation')) && !await frame.locator('.measurement-bias-table').isVisible());
  await section.getByRole('button', { name: 'Expand Measurement Bias section', exact: true }).click();
  await section.dragTo(frame.locator('[data-detail-section="budget"]'));
  check('Measurement Bias reorders with other workspace sections', await until(() => saved().detailSectionOrder?.indexOf('equation') > saved().detailSectionOrder?.indexOf('budget')));
  await frame.locator('[data-point-id="point"] [data-sidebar-column="pfa"]').click();
}
