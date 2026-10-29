import { v4 as uuid } from 'uuid';
import { normalizeInlineManualComponent } from '../features/analysis/utils/manualComponentUtils';
import { getBudgetComponentsFromTolerance } from '../features/analysis/utils/budgetUtils';
import { matchAcShuntInstrument, linkAcShuntDefinition, matchAcShuntRange, sharedAcShuntInstruments } from './acShuntLibrary';
import { recalculatePointUncertaintyFields } from './riskCompute';
import { formatInstrumentIdentity } from './instrumentIdentity';
import { linkAcShuntReaders, acShuntResolutionComponents } from './acShuntResolution';

const finite = n => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n));
const qualifier = value => ({ name: 'Frequency', min: value, max: value, value, isSingleValue: true, unit: 'Hz' });

// Only observations come from the session. Reference uncertainties come from
// the existing library, independently of the one-time reference setup.
export function buildAcShuntBudget(snapshot, { instruments = [] } = {}) {
  if (!snapshot.points?.length) throw new Error('This session has no measurement points.');
  const meta = snapshot.instruments || {};
  const shared = sharedAcShuntInstruments(instruments);
  const readers = linkAcShuntReaders(meta, instruments);
  const definition = matchAcShuntInstrument({ kind: 'shunt', model: meta.standard_instrument_model, serial: meta.standard_instrument_serial, shuntRange: meta.shuntRange, reportIds: meta.referenceReportIds }, shared);
  const uutDefinition = matchAcShuntInstrument({ kind: 'uut', model: meta.test_instrument_model, serial: meta.test_instrument_serial, shuntRange: meta.shuntRange }, shared);
  if (!uutDefinition) throw new Error(`Could not automatically match TI ${[meta.test_instrument_model, meta.test_instrument_serial].filter(Boolean).join(' · ')}. Check its model and serial in the instrument library, then retry.`);
  const areaId = uuid(), uutId = uuid();
  const warnings = [];
  const importedAt = new Date().toISOString();
  const uut = linkAcShuntDefinition({ id: uutId, name: uutDefinition.description || '', description: uutDefinition.description || '',
    measurementAreaId: areaId, measurementArea: 'Current', measurementAreaNames: ['Current'],
  }, uutDefinition, 'uut');
  const reference = definition ? linkAcShuntDefinition({ id: uuid(),
    name: definition.description || '',
    quantity: 1, isInstrumentBased: true, measurementAreaNames: ['Current'] }, definition) : null;
  const referenceIdentity = reference ? formatInstrumentIdentity(reference) : '';
  const testPoints = snapshot.points.map(point => {
    if (!finite(point.current) || Number(point.current) <= 0 || !finite(point.frequency) || Number(point.frequency) <= 0) {
      throw new Error('Each AC-shunt point must have a positive current and frequency.');
    }
    const nominal = { name: 'AC current', value: Number(point.current), unit: 'A', qualifier: qualifier(Number(point.frequency)) };
    const a = point.analytics;
    const source = { sessionId: snapshot.id, sessionName: snapshot.name, pointIds: point.sourcePointIds,
      deltaPpm: finite(a?.pair_delta_uut_ppm) ? Number(a.pair_delta_uut_ppm) : null, importedAt };
    const validTypeA = Number.isInteger(a?.n_pairs_used) && a.n_pairs_used >= 2
      && finite(a.pair_type_a_uncertainty_ppm) && Number(a.pair_type_a_uncertainty_ppm) >= 0;
    const repeatability = normalizeInlineManualComponent({
      component: { id: uuid(), dof: validTypeA ? a.n_pairs_used - 1 : Infinity, originalInput: { useFiniteDof: validTypeA } },
      draft: { name: 'AC/DC repeatability', type: 'A', inputMode: 'standard',
        standardUncertainty: validTypeA ? Number(a.pair_type_a_uncertainty_ppm) : '', unit: 'ppm' }, referencePoint: nominal,
    });
    repeatability.acShuntSource = { ...source, nPairs: a?.n_pairs_used ?? 0,
      typeAUncertaintyPpm: validTypeA ? Number(a.pair_type_a_uncertainty_ppm) : null };
    if (!validTypeA) {
      repeatability.inlineDraft = true;
      repeatability.value = repeatability.value_native = null;
      repeatability.pendingReason = 'At least two accepted forward/reverse pairs are required for Type A.';
      warnings.push(`${point.current} A / ${point.frequency} Hz: ${repeatability.pendingReason}`);
    }
    if (source.deltaPpm === null) warnings.push(`${point.current} A / ${point.frequency} Hz: AC–DC difference is unavailable.`);
    if (point.stabilityFailed) warnings.push(`${point.current} A / ${point.frequency} Hz: source session flagged failed stability.`);
    const variability = normalizeInlineManualComponent({ component: { id: uuid() },
      draft: { name: 'Fluke 5790B Variability', type: 'B', inputMode: 'tolerance', unit: 'ppm', errorDistributionDivisor: '1.732',
        tolerance: { floor: { high: 5, low: -5, unit: 'ppm', distribution: '1.732', symmetric: true } } },
      referencePoint: nominal });
    const components = [repeatability, variability];
    components.push(...acShuntResolutionComponents(point, nominal, readers));
    if (reference) {
      try {
        const range = matchAcShuntRange(reference, 'Current', nominal);
        const errors = getBudgetComponentsFromTolerance(range, nominal).filter(error => !error.isManual);
        if (!errors.length) throw new Error('The reference range has no uncertainty.');
        for (const error of errors) {
          const id = uuid();
          components.push({ id, componentId: id, name: referenceIdentity, type: 'B', isCore: true, isBudgetInstance: true, quantity: 1,
            sourceTmdeId: reference.id, tmdeBudgetSourceId: reference.id, tmdeBudgetRange: range,
            tmdeBudgetRangeId: range.rangeId, tmdeBudgetFunctionId: range.functionId, tmdeBudgetFunctionName: range.functionName,
            tmdeBudgetComponentKind: error.isResolution ? 'Resolution' : String(error.name || '').split(' - ').slice(1).join(' - ') || 'TMDE Error',
            tmdeUncertaintySourceId: error.tmdeUncertaintySourceId, tmdeUncertaintyComponentKind: error.tmdeUncertaintyComponentKind,
            ...(error.isResolution ? { isResolution: true } : {}), tmdeIdentity: referenceIdentity,
            originalInput: { inputMode: 'tolerance', useFiniteDof: false } });
        }
      } catch (error) {
        components.push({ id: uuid(), name: 'Reference shunt', type: 'B', value: null, value_native: null, unit_native: 'A', pendingReason: error.message });
        warnings.push(`${point.current} A / ${point.frequency} Hz: ${error.message}`);
      }
    }
    let uutTolerance = {};
    try {
      uutTolerance = matchAcShuntRange(uut, 'Current', nominal);
    } catch (error) {
      warnings.push(`${point.current} A / ${point.frequency} Hz: ${error.message}`);
    }
    return { id: uuid(), section: '', measurementAreaId: areaId, associatedUutIds: [uutId], activeUutId: uutId,
      measurementType: 'direct', components, tmdeTolerances: [],
      uutTolerance,
      is_detailed_uncertainty_calculated: false, coverageFactorMode: 'auto',
      testPointInfo: { measurementArea: 'Current', parameter: nominal, qualifier: nominal.qualifier, acShuntSource: source } };
  });
  if (!reference) warnings.push('Add your reference instrument and its uncertainty sources to complete the budget.');
  const session = { name: `${snapshot.name} · AC/DC budget`, document: `AC-shunt session ${snapshot.id}`,
    documentDate: snapshot.createdAt?.slice(0, 10) || '',
    measurementAreas: [{ id: areaId, name: 'Current', color: '#5aa6d9' }],
    measurementAreaGroups: [{ id: 'current', name: 'Current', units: ['A'], color: '#5aa6d9' }],
    uuts: [uut], tmdes: [...(reference ? [reference] : []), ...readers.map(reader => reader.linked).filter(Boolean)], testPoints, noteImages: [], uutTolerance: {},
    uncReq: { uncertaintyConfidence: 95, reliability: 85, calInt: 12, neededTUR: 4, reqPFA: 2 },
    notes: [`Source: AC-shunt session ${snapshot.id} (${snapshot.name}).`,
      'AC–DC difference is the signed measured result. AC/DC repeatability uses the saved paired Type A standard uncertainty with N−1 degrees of freedom.',
      'Fluke 5790B Variability: editable ±5 ppm, Rectangular. TI acceptance uses the selected library instrument, initially lab ±100 ppm, with no measured bias applied.',
      'Reference errors use the selected Uncertalytics instrument. Complete any remaining instrument contributions in the budget.', ...warnings].join('\n'),
    detailSectionOrder: ['instruments', 'equation', 'budget'], detailCollapsedSections: [] };
  session.testPoints = testPoints.map(point => recalculatePointUncertaintyFields(point, session));
  return { warnings, session, referenceId: definition?.id || '', uutInstrumentId: uutDefinition.id };
}
