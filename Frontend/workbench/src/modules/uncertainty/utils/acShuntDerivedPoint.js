import { v4 as uuid } from 'uuid';
import { getInstrumentRangeRows } from './instrumentFunctionSelection';
import { getBudgetComponentsFromTolerance } from '../features/analysis/utils/budgetUtils';
import { correlationKey } from './uncertaintyMath';

const phases = ['ac_open', 'ac_close', 'dc_pos', 'dc_neg'];
const phaseLabels = ['AC opening', 'AC closing', 'DC positive', 'DC negative'];
const present = value => value != null && value !== '' && Number.isFinite(Number(value));
const voltageSymbol = (role, directionIndex, phase) => `V${role}${directionIndex + 1}${phases.indexOf(phase) + 1}`;

// Author ordinary equation inputs and range-linked source rows. No imported
// source is pre-converted to amperes: the native derived engine owns propagation.
export function buildAcShuntDerivedPoint(point, savedPoint, session) {
  const variableMappings = {}, variableNominals = {}, inputCorrelations = {};
  const components = [], readerInputs = new Map();
  const nominal = point.testPointInfo.parameter;
  const input = (symbol, label, value, unit) => {
    variableMappings[symbol] = label;
    variableNominals[symbol] = { value, unit, ...(unit ? {qualifier: nominal.qualifier} : {}) };
  };
  input('Iref', 'Reference shunt calibration', nominal.value, 'A');
  input('I0', 'Nominal test current', nominal.value, 'A');
  const ratios = [];
  for (const [directionIndex, saved] of savedPoint.readerPoints.entries()) {
    const terms = [];
    for (const role of ['std', 'ti']) {
      const values = phases.map(phase => saved.phases?.[`${role}_${phase}`]);
      const volts = values.map(value => present(value) ? Math.abs(Number(value)) : '');
      const symbols = phases.map((phase, phaseIndex) => {
        const symbol = voltageSymbol(role, directionIndex, phase);
        input(symbol, `${role === 'std' ? 'Reference' : 'UUT'} reader ${saved.direction || directionIndex + 1} ${phaseLabels[phaseIndex]}`, volts[phaseIndex], 'V');
        return symbol;
      });
      const eta = Number(saved[`eta_${role}`]);
      const valid = volts.every(present) && volts[2] + volts[3] > 0 && Number.isFinite(eta) && eta > 0;
      // Reference the recorded operating point, not a second application of the
      // measured AC/DC difference as UUT bias. The saved result remains provenance.
      const baseline = valid ? (volts[0] + volts[1]) / (volts[2] + volts[3]) : 0;
      const etaSymbol = `eta${role}${directionIndex + 1}`;
      // Invalid sensitivity data must remain editable/incomplete, never default to 1.
      if (!valid) input(etaSymbol, `${role} reader sensitivity ${directionIndex + 1}`, '', '');
      terms.push(`((${symbols[0]} + ${symbols[1]}) / (${symbols[2]} + ${symbols[3]}) - ${baseline}) / ${valid ? eta : etaSymbol}`);
    }
    ratios.push(`(${terms[0]} - ${terms[1]})`);
  }
  let expression = `Iref + I0 * (${ratios.length ? `(${ratios.join(' + ')}) / ${ratios.length}` : 'Vmissing'})`;
  if (!ratios.length) input('Vmissing', 'Saved reader comparison', '', '');

  for (const original of point.components) {
    if (!original.tmdeTransferSources) {
      components.push(original.tmdeBudgetSourceId
        ? { ...original, variableSymbol: 'Iref', variableType: variableMappings.Iref,
          acShuntSource: { ...original.acShuntSource, contribution: 'Reference shunt calibration uncertainty' } }
        : original); // Type A and unresolved sources stay at the output.
      continue;
    }
    // Resolution is enumerated with each phase's native range below, once only.
    if (original.isResolution) continue;
    const master = session.tmdes.find(item => item.id === original.tmdeBudgetSourceId);
    const ranges = master ? getInstrumentRangeRows(master, {flattenTolerances:true}) : [];
    for (const transfer of original.tmdeTransferSources) {
      const isReader = transfer.phase != null;
      const symbol = isReader ? voltageSymbol(transfer.role, transfer.directionIndex, transfer.phase) : `T${transfer.role}`;
      if (!isReader) {
        input(symbol, `${transfer.role === 'std' ? 'Reference' : 'UUT'} TVC calibration voltage`, transfer.nominal.value, 'V');
        const referenceSymbol = `${symbol}0`;
        input(referenceSymbol, `${transfer.role === 'std' ? 'Reference' : 'UUT'} TVC nominal voltage`, transfer.nominal.value, 'V');
        expression += ` ${transfer.role === 'std' ? '+' : '-'} I0 * (${symbol} / ${referenceSymbol} - 1)`;
      } else {
        readerInputs.set(symbol, {sourceId:transfer.sourceId,
          sign: (transfer.role === 'std' ? 1 : -1) * (phases.indexOf(transfer.phase) < 2 ? 1 : -1)});
      }
      const range = ranges.find(row => row.rangeId === transfer.rangeId && row.functionId === transfer.functionId);
      const errors = range ? getBudgetComponentsFromTolerance(range, transfer.nominal).filter(error => !error.isManual) : [];
      // Keep a missing linked specification visible so an incomplete source
      // cannot turn into a zero-uncertainty input after import or later edits.
      if (!errors.some(error => !error.isResolution)) errors.unshift({name:'TMDE Error'});
      for (const error of errors) {
        const id = uuid();
        const {tmdeTransferSources, tmdeTransferDetails, ...source} = original;
        components.push({...source, id, componentId:id,
          variableSymbol:symbol, variableType:variableMappings[symbol],
          tmdeBudgetRange:range, tmdeBudgetRangeId:transfer.rangeId,
          tmdeBudgetFunctionId:transfer.functionId, tmdeBudgetFunctionName:range?.functionName,
          tmdeUncertaintySourceId:error.tmdeUncertaintySourceId,
          tmdeUncertaintyComponentKind:error.tmdeUncertaintyComponentKind,
          tmdeBudgetComponentKind:error.isResolution ? 'Resolution' : String(error.name || '').split(' - ').slice(1).join(' - ') || 'TMDE Error',
          isResolution:Boolean(error.isResolution),
          acShuntSource:{...original.acShuntSource, phase:transfer.phase, direction:transfer.direction, role:transfer.role},
        });
      }
    }
  }
  // Explicit conservative assumption, visible in the native correlation editor:
  // repeated readings of one physical reader must not average its systematic
  // uncertainty away or imply cancellation. Opposite sensitivities use -1.
  const entries = [...readerInputs];
  entries.forEach(([symbol, reader], index) => entries.slice(index + 1).forEach(([other, peer]) => {
    if (reader.sourceId === peer.sourceId) inputCorrelations[correlationKey(variableMappings[symbol], variableMappings[other])] = reader.sign * peer.sign;
  }));
  return {...point, measurementType:'derived', equationString:expression,
    variableMappings, variableNominals, inputCorrelations, components,
    // testPointInfo is persisted by the session API; unknown top-level point
    // fields are discarded when the relational session is saved and reopened.
    testPointInfo: {...point.testPointInfo, acShuntSource: {...point.testPointInfo.acShuntSource,
      derivedModel: {version:1, convention:'Nominal-centered equivalent-current AC/DC comparison',
        readerCorrelation:'Conservative full-magnitude correlation within each physical reader; review in the correlation editor.',
        directionCombination:'Equal-weight mean of saved forward/reverse comparison sensitivities; Type A imported once at output.'},
    }},
  };
}
