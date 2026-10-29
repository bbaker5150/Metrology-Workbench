import { getInstrumentRangeRows } from './instrumentFunctionSelection';
import { getBudgetComponentsFromTolerance } from '../features/analysis/utils/budgetUtils';
import { formatInstrumentIdentity } from './instrumentIdentity';
import { unresolvedComponent } from './incompleteBudget';
import { distributionDivisorValue } from './uncertaintyMath';

export const GENERIC_5790_ID = 'fluke-5790b-generic';
export const isY5020 = model => /\bY5020\b/i.test(String(model || ''));

// Keep the source in volts on the instrument. Only this explicit AC/DC
// sensitivity converts its rounding uncertainty to the current/ppm budget.
export function resolveY5020Resolution(component, session, nominal) {
  const master = (session.tmdes || []).find(item => String(item.id) === String(component.tmdeBudgetSourceId));
  const name = `${formatInstrumentIdentity(master || { manufacturer: 'Fluke', model: '5790B' })} - Resolution`;
  try {
    if (!master) throw Error('The generic Fluke 5790B is missing from the TMDE table.');
    const ranges = getInstrumentRangeRows(master, { flattenTolerances: true });
    let largest;
    for (const source of component.y5020Resolution?.cases || []) {
      const range = ranges.find(row => String(row.rangeId) === String(source.rangeId)
        && String(row.functionId) === String(source.functionId));
      if (!range) throw Error('The linked Fluke 5790B resolution range is missing.');
      const resolution = getBudgetComponentsFromTolerance({ ...range, includeResolutionInBudget: true }, { value: 1, unit: 'V' })
        .find(row => row.isResolution);
      if (!resolution || resolution.pendingReason || !Number.isFinite(resolution.value_native)) {
        throw Error('Set the resolution on the linked Fluke 5790B range.');
      }
      if (!(Number(source.ppmPerVolt) > 0) || !Number.isFinite(Number(source.ppmPerVolt))) {
        throw Error('The Y5020 voltage-to-ppm sensitivity is unavailable.');
      }
      const ppm = resolution.value_native * Number(source.ppmPerVolt);
      if (!largest || ppm > largest.ppm) largest = { ppm, resolution, range };
    }
    if (!largest || !(Number(nominal?.value) > 0)) throw Error('The Y5020 resolution inputs are unavailable.');
    const { ppm, resolution, range } = largest;
    const native = ppm * Math.abs(Number(nominal.value)) * 1e-6;
    const divisor = distributionDivisorValue(resolution.distributionDivisor);
    return { ...component, name, pendingReason: null, value: ppm, value_native: native,
      unit_native: nominal.unit, isBaseUnitValue: false, distribution: resolution.distribution,
      distributionDivisor: resolution.distributionDivisor, toleranceLimit_native: native * divisor,
      tmdeBudgetRangeId: range.rangeId, tmdeBudgetFunctionId: range.functionId,
      tmdeBudgetFunctionName: range.functionName, tmdeBudgetRange: range,
      resolution: resolution.resolution, resolutionUnit: resolution.resolutionUnit,
      originalInput: { inputMode: 'tolerance', useFiniteDof: false, unit: 'ppm',
        toleranceLimit: ppm * divisor, errorDistributionDivisor: resolution.distributionDivisor } };
  } catch (error) {
    return unresolvedComponent({ ...component, name, unit_native: nominal?.unit || 'A' }, error.message);
  }
}
