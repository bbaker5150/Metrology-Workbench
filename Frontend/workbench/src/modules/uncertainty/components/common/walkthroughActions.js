// Required actions are separate from explanatory copy. Creation/editing gates
// inspect committed application state; opening an editor alone does not pass them.
const uut = '[data-tour="uut-table"]';
const tmde = '[data-tour="tmde-table"]';
const points = '.measurement-point-list';
const units = '.inline-unit-menu';
const budget = '.budget-stack, [data-tour="budget-component-menu"], .repeatability-modal';
const columnMenu = '[data-tour="sidebar-columns"], .sidebar-filter-dropdown';
const settings = '[data-tour="function-settings"], [data-tour="function-settings-menu"]';
const json = value => JSON.stringify(value ?? null);
const session = context => context.session || {};
const items = (context, kind) => session(context)[kind] || [];
const sources = context => items(context, 'tmdes').flatMap(item => item.instrument?.tmdeSecondaryUncertainties || []);
const ranges = item => [...(item.ranges || []), ...(item.instrument?.ranges || []), ...(item.instrument?.functions || []).flatMap(fn => fn.ranges || [])];
const definitions = context => items(context, 'tmdes').flatMap(item => [
  ...(item.instrument?.tmdeSecondaryUncertainties || []).map(source => source.dynamicDefinition),
  ...ranges(item).map(range => range.tolerances?.tmdeUncertaintyDefinition || range.tolerance?.tmdeUncertaintyDefinition),
]).filter(Boolean);
const filled = value => String(value ?? '').trim() !== '' && Number.isFinite(Number(value));
const modeSelected = mode => ({ label: `Open Measurement Area Settings and select ${mode}.`, allowed: settings,
  complete: (_context, _baseline, ui) => ui.find('[data-tour="function-settings-menu"] [role="radio"][aria-checked="true"]')?.textContent.trim() === mode,
});
const readPoint = context => context.point || {};
const changed = (label, allowed, read) => ({ label, allowed, waitForCommit: true,
  snapshot: context => json(read(context)),
  complete: (context, baseline) => json(read(context)) !== baseline,
});
const opened = (label, allowed, selector) => ({ label, allowed,
  complete: (_context, _baseline, ui) => ui.visible(selector),
});
const reviewed = (label, allowed, selector) => ({ label, allowed,
  complete: (_context, _baseline, ui) => {
    if (ui.visible(selector)) ui.seen.add(selector);
    return ui.seen.has(selector) && !ui.visible(selector);
  },
});
const added = (label, allowed, read) => ({ label, allowed,
  snapshot: context => read(context).map(item => item.id || item.name),
  complete: (context, baseline) => read(context).some(item => !baseline.includes(item.id || item.name)),
});
const repeatability = context => (readPoint(context).components || []).filter(component => component.type === 'A' && component.savedInputs);
const pointFields = context => ({id: readPoint(context).id, parameter: readPoint(context).testPointInfo?.parameter, uut: readPoint(context).activeUutId});
const pointCreated = mode => added(`Use + to create a ${mode} measurement point.`, `${points}, ${units}, [data-tour="measurement-point-menu"]`, context => items(context, 'testPoints').filter(point => (point.measurementType || 'direct') === mode));
const assignPoint = { label: 'Choose the UUT in the highlighted cell.', allowed: `${points}, ${units}`,
  complete: context => !!(readPoint(context).activeUutId || readPoint(context).associatedUutIds?.length),
};
const pointValue = { waitForCommit: true, label: 'Enter a numeric Value and press Enter.', allowed: `${points}, ${units}`,
  complete: context => filled(readPoint(context).testPointInfo?.parameter?.value),
};
const sourceKind = kind => ({
  waitForCommit: true,
  label: `Configure and save a ${kind === 'table' ? 'Table' : 'Equation'} uncertainty, then press Enter to finish editing.`,
  allowed: `${tmde}, ${units}`,
  snapshot: context => definitions(context).map(json),
  complete: (context, baseline) => definitions(context).some(definition =>
    !baseline.includes(json(definition)) && definition.kind === kind && (kind === 'table'
      ? definition.rows?.some(row => filled(row.point) && Object.values(row.values || {}).some(value => filled(value?.value) || (filled(value?.high) && filled(value?.low))))
      : (definition.mode === 'limits' ? [definition.lowerEquation, definition.upperEquation] : [definition.equation]).every(equation => context.validateBudgetEquation?.(equation).status === 'ok') && Object.entries(definition.variables || {}).every(([symbol, variable]) => symbol === definition.pointVariable || filled(variable.value)))),

});
export const walkthroughActions = {
  'new-session': { label: 'Create a session with +, or continue with your existing session.', allowed: '[data-tour="add-session"], [aria-label="Analysis Session"]', complete: context => context.sessionCount > 0, autoAdvance: true },
  'session-information': changed('Edit a session information field.', '[data-tour="session-information"]', context => {
    const {name, analyst, organization, document, documentDate} = session(context); return {name, analyst, organization, document, documentDate};
  }),
  'session-requirements': changed('Set one of the session risk or mitigation inputs.', '[data-tour="session-requirements"]', context => session(context).uncReq),
  'uut-function': added('Enter an area name and add the Measurement Area.', '[data-tour="uut-add-function"], .sidebar-add-area-controls', context => items(context, 'measurementAreaGroups')),
  'uut-instrument': added('Use + to add a UUT to this area.', `${uut}, ${units}`, context => items(context, 'uuts')),
  'uut-columns': changed('Enter or change a range or specification value.', `${uut}, ${units}`, context => items(context, 'uuts').map(ranges)),
  'instrument-units': { label: 'Open a unit or prefix menu and choose an option.', allowed: `${uut}, ${units}`,
    acceptEvent: event => event.type === 'click' && !!event.target.closest('.inline-unit-menu [role="option"]') && /unit|prefix/i.test(event.target.closest('[role="listbox"]')?.getAttribute('aria-label') || ''),
    complete: (_context, _baseline, ui) => ui.evidence && !ui.visible('.inline-unit-menu'),
  },
  'tmde-function': added('Use + to add a TMDE to this area.', `${tmde}, [data-tour="tmde-add-function"], ${units}`, context => items(context, 'tmdes')),
  'area-tools': { label: 'Click a Range cell to select an individual range.', allowed: tmde, complete: (_context, _baseline, ui) => ui.visible(`${tmde} [data-selection-mode="range"] td[data-cell-selected]`) },
  'custom-columns': changed('Add a custom instrument column using the + above a divider.', `${uut}, .instrument-column-insert-button`, context => session(context).instrumentCustomColumns),
  'instrument-sources': added('Expand a TMDE uncertainty and use its + to add a source.', `${tmde}, ${units}`, sources),
  'source-types': reviewed('Choose a type from the gear menu, then close the menu.', tmde, '.instrument-source-settings'),
  'source-table': sourceKind('table'),
  'source-equation': sourceKind('equation'),
  'source-distribution': changed('Set the distribution in the additional source’s Distribution column.', `${tmde} .instrument-uncertainty-row .cell-distribution, ${units}`, context => sources(context).map(source => source.dynamicDefinition?.distribution || source.tolerance?.bandDistribution || source.tolerance?.floor?.distribution)),
  'source-selection': { label: 'Select an additional uncertainty by clicking its name cell.', allowed: tmde, complete: (_context, _baseline, ui) => ui.visible(`${tmde} [data-selection-mode="range"] .instrument-uncertainty-name-cell[data-cell-selected]`) },
  'range-bias': opened('Expand an uncertainty and open its Bias editor.', `${uut}, ${tmde}, ${units}`, '.instrument-bias-editor'),
  'function-settings': modeSelected('Direct'),
  'measurement-point': pointCreated('direct'),
  'point-uut': assignPoint,
  'derived-uut': assignPoint,
  'point-value': pointValue,
  'derived-value': pointValue,
  'budget-component': added('Choose a source from + to add it to this point’s budget.', `${budget}, ${units}`, context => readPoint(context).components || []),
  'derived-settings': modeSelected('Derived'),
  'derived-point': pointCreated('derived'),
  'derived-equation': { ...changed('Enter or change a valid measurement equation and commit it.', '.measurement-equation-card, .equation-library-menu, .equation-insert-menu', context => readPoint(context).equationString),
    complete: (context, baseline) => json(readPoint(context).equationString) !== baseline && context.validateEquation?.(readPoint(context).equationString).status === 'ok',
  },
  'derived-nominals': { ...changed('Set a numeric input nominal or its unit.', `.measurement-inputs-table-wrap, ${units}`, context => readPoint(context).variableNominals),
    complete: (context, baseline) => json(readPoint(context).variableNominals) !== baseline && Object.values(readPoint(context).variableNominals || {}).some(nominal => filled(nominal.value)),
  },
  'derived-sources': added('Add a contributor to an input budget using +.', `${budget}, ${units}`, context => readPoint(context).components || []),
  'derived-correlation': { label: 'Open Input correlation matrix, review it, then close it.', allowed: '[aria-label="Input correlation matrix"], .correlation-matrix-modal',
    acceptEvent: event => event.type === 'click' && !!event.target.closest('[aria-label="Close input correlations"]'),
    complete: (_context, _baseline, ui) => ui.evidence && !ui.visible('.correlation-matrix-modal'),
  },
  'budget-method': changed('Choose a propagation method or set its trial count.', '.budget-propagation-control', context => ({method:readPoint(context).budgetPropagationMethod, trials:readPoint(context).monteCarloTrials})),
  'budget-edit': changed('Edit or reorder a budget contributor.', `${budget}, ${units}`, context => readPoint(context).components),
  'budget-dynamic': { ...added('Add a tabular or equation component from the budget + menu.', `${budget}, ${units}`, context => (readPoint(context).components || []).filter(component => component.dynamicDefinitionId)), },
  'repeatability': { ...changed('Add repeatability readings and save them to the budget.', `${budget}, ${units}`, repeatability),
    complete: (context, baseline) => json(repeatability(context)) !== baseline && repeatability(context).some(component => component.savedInputs.readings?.some(filled)),
  },
  'risk-columns': reviewed('Review the Risk and Mitigation fields in Columns, then close the menu.', columnMenu, '.sidebar-filter-dropdown'),
  'point-requirements': changed('Add an input column and set an override for a point.', `${columnMenu}, ${points}`, context => items(context, 'testPoints').map(point => point.riskRequirements)),
  'column-menu': reviewed('Choose or reorder columns, then close the menu.', columnMenu, '.sidebar-filter-dropdown'),
  'column-defaults': reviewed('Review Reset Columns and Set as Default, then close the menu.', columnMenu, '.sidebar-filter-dropdown'),
  'layout': changed('Drag or double-click the workspace divider to change the layout.', '[aria-label="Resize measurement point list"]', context => context.layout),
  'point-selection': changed('Edit a point’s Section or Value field.', `${points}, ${units}`, context => items(context, 'testPoints').map(point => ({...pointFields({point}),section:point.section,info:point.testPointInfo}))),
  'instrument-builder': opened('Open Instrument builder from the header.', '[aria-label="Instrument builder"], .instrument-builder-wrapper', '.instrument-builder-wrapper'),
  'unit-converter': opened('Open Unit converter from the header.', '[aria-label="Unit converter"], .converter-window', '.converter-window'),
};
