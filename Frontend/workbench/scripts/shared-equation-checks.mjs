import { prepareDynamicEquationSession } from './dynamic-equation-copy-checks.mjs';

export function prepareSharedEquationSession(session) {
  prepareDynamicEquationSession(session);
  session.testPoints.forEach((point, index) => Object.assign(point, {
    measurementType: 'derived', equationString: `a*${20 * (index + 1)}`,
    variableMappings: { a: 'Sensor' }, variableNominals: { a: { value: index + 1, unit: 'degF' } },
    testPointInfo: { parameter: { name: 'Temperature', value: 20 * (index + 1), unit: 'degF' } },
  }));
}

export async function checkSharedEquations({ frame, page, saved, until, check }) {
  page.setDefaultTimeout(10000);
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  const points = frame.locator('.point-grid-item');
  const select = async index => { await points.nth(index).locator('.point-value-number').click(); await page.keyboard.press('Escape'); };
  const outside = async () => {
    await frame.locator('.analysis-tabs').click({ position: { x: 5, y: 5 } });
    await frame.locator('.dynamic-budget-editor').first().waitFor({ state: 'hidden' });
  };
  const picker = async (input = true) => {
    const buttons = frame.getByRole('button', { name: 'Add component to budget', exact: true });
    await (input ? buttons.first() : buttons.last()).click();
  };
  const bound = () => frame.locator('.dynamic-bound-value').innerText();
  await select(0);
  await picker();
  await frame.getByRole('button', { name: 'Add equation component', exact: true }).click();
  await frame.getByLabel('Uncertainty equation', { exact: true }).fill('x/10');
  await frame.getByRole('button', { name: 'Edit error limit distribution', exact: true }).click();
  await frame.getByLabel('Error limit distribution', { exact: true }).selectOption('1.000');
  check('input-budget equation binds its 1 F input nominal', await bound() === '1 °F');
  await outside();
  check('input-budget equation saves under Sensor scope', await until(() => saved().testPoints[0].components.some(c => c.dynamicDefinitionId && c.variableType === 'Sensor')));
  await select(1);
  await picker();
  await frame.getByRole('button', { name: 'Equation component 1', exact: true }).click();
  check('shared equation on second point binds its 2 F nominal', await bound() === '2 °F');
  await frame.getByLabel('Uncertainty equation', { exact: true }).fill('x/20');
  await outside();
  check('both points share a single equation definition', await until(() => {
    const s = saved();
    return s.dynamicBudgetDefinitions.length === 1 && s.testPoints.every(p => p.components.length === 1 && p.components[0].dynamicDefinitionId === s.dynamicBudgetDefinitions[0].id && p.components[0].dynamicDefinition.equation === 'x/20');
  }));
  await picker();
  await frame.getByRole('button', { name: 'Equation component 1', exact: true }).click();
  await outside();
  check('reselecting a shared component does not duplicate its budget row', saved().testPoints[1].components.length === 1);
  await select(0);
  await frame.locator('.budget-dynamic-row .dynamic-tolerance-cell button').click();
  check('shared edit preserves first point binding and recalculates its limit', await bound() === '1 °F' && await frame.locator('.dynamic-editor-preview').innerText().then(t => t.includes('0.05 °F')));
  if (process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({ path: `${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/shared-equation-20F.png` });
  await outside();
  // Unfinished creation resumes the same draft on repeated Add clicks.
  for (let attempt = 0; attempt < 2; attempt++) {
    await picker();
    await frame.getByRole('button', { name: 'Add equation component', exact: true }).click();
    await outside();
  }
  check('repeated New resumes one named unfinished equation', await until(() => saved().dynamicBudgetDefinitions.length === 2 && saved().testPoints[0].components.length === 2));
  await select(1);
  await picker(false);
  await frame.getByRole('button', { name: 'Add tabular component', exact: true }).click();
  await frame.getByLabel('Uncertainty row 1', { exact: true }).fill('4');
  await frame.locator('.budget-dynamic-row').last().getByRole('button', { name: 'Edit error limit distribution', exact: true }).click();
  await frame.getByLabel('Error limit distribution', { exact: true }).selectOption('1.000');
  await outside();
  await select(0);
  await picker(false);
  check('shared table is available even without the current measurement row', await frame.getByRole('button', { name: 'Tabular component 1', exact: true }).count() === 1);
  await frame.getByRole('button', { name: 'Tabular component 1', exact: true }).click();
  check('reuse adds and focuses the missing 20 F entry', await frame.getByLabel('Measurement point row 2', { exact: true }).inputValue() === '20' && await frame.getByLabel('Uncertainty row 2', { exact: true }).evaluate(el => el === el.ownerDocument.activeElement));
  await frame.getByLabel('Uncertainty row 2', { exact: true }).fill('2');
  await outside();
  check('one shared table retains both point entries', await until(() => {
    const tables = saved().dynamicBudgetDefinitions.filter(d => d.kind === 'table');
    return tables.length === 1 && tables[0].rows.map(r => Number(r.point)).join(',') === '40,20';
  }));
  const row = frame.locator('.budget-dynamic-row').filter({ hasText: 'Tabular component 1' });
  await row.hover();
  await row.getByRole('button', { name: 'Remove dynamic component', exact: true }).click();
  await until(() => !saved().testPoints[0].components.some(c => c.dynamicDefinition?.kind === 'table'));
  await picker(false);
  await frame.getByRole('button', { name: 'Tabular component 1', exact: true }).click();
  await until(() => saved().testPoints[0].components.some(c => c.dynamicDefinition?.kind === 'table'));
  check('reusing a complete matching table keeps its error-limit editor collapsed', await frame.locator('.dynamic-budget-editor').count() === 0 && await row.count() === 1);
}
