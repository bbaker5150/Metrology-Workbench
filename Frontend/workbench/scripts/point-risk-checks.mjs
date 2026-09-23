import assert from 'node:assert/strict';

// Run with POINT_RISK_SMOKE=1 in the Forge smoke harness, or against the Vite
// development page with the same prepareWorkspacePolish fixture.
export async function checkPointRisk({ frame }) {
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const select = id => frame.locator(`[data-point-id="${id}"] [data-sidebar-column="value"]`).click({ position: { x: 2, y: 2 } });
  await select('point');
  const viz = frame.getByRole('region', { name: 'Risk distributions', exact: true });
  assert.equal(await viz.count(), 0, 'testing section must be hidden by default');
  await frame.locator('body').press('Control+Alt+Shift+R');
  await viz.getByRole('img', { name: 'True UUT error distribution', exact: true }).waitFor();
  assert.equal(await viz.getByRole('img').count(), 4);
  const outcomes = viz.getByRole('table', { name: 'Population risk outcomes' });
  const baseline = await outcomes.textContent();
  await viz.getByRole('button', { name: 'Explore REOP & uncertainty' }).click();
  const uncertainty = viz.getByRole('slider', { name: 'Explore calibration uncertainty' });
  await uncertainty.fill('2');
  await uncertainty.press('ArrowRight');
  assert.notEqual(await outcomes.textContent(), baseline);
  await viz.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await outcomes.textContent(), baseline);
  await viz.getByRole('slider', { name: 'Hypothetical true error' }).fill('0.5');
  assert.match(await viz.locator('.risk-distribution-probe-result').textContent(), /Truly in tolerance/);
  await viz.getByRole('slider', { name: 'Hypothetical true error' }).fill('1');
  assert.match(await viz.locator('.risk-distribution-probe-result').textContent(), /Truly out of tolerance/);
  await frame.getByRole('button', { name: 'Collapse Risk Distributions section' }).click();
  assert.equal(await viz.isVisible(), false);
  await frame.getByRole('button', { name: 'Expand Risk Distributions section' }).click();
  assert.equal(await viz.isVisible(), true);
  await select('direct-polish');
  await viz.getByRole('button', { name: 'Explore REOP & uncertainty' }).waitFor();
  assert.equal(await viz.getByRole('slider', { name: 'Explore calibration uncertainty' }).count(), 0);
  await select('point');
  await viz.getByRole('button', { name: 'Explore REOP & uncertainty' }).waitFor();
  assert.equal(await outcomes.textContent(), baseline);
  assert.equal(await viz.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  console.log('PASS point risk curves, exploration/reset, conditional outcomes, collapse, point switching, and overflow');
}
