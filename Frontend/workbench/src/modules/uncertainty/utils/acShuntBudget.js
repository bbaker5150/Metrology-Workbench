import { v4 as uuid } from 'uuid';
import { normalizeInlineManualComponent } from '../features/analysis/utils/manualComponentUtils';
import { getBudgetComponentsFromTolerance } from '../features/analysis/utils/budgetUtils';
import { getInstrumentRangeRows } from './instrumentFunctionSelection';
import { readerContribution, readerTransferInputs } from './acShuntReaderSpecs';
import { acShuntUutSpec } from './acShuntUutSpecs';
import { resolvePointBudgetComponents } from './resolvePointBudgetComponents';
import { computePointRiskMetrics, recalculatePointUncertaintyFields } from './riskCompute';
import { resolveErrorDistribution } from './uncertaintyMath';
import { selectAcShuntDefinitions, linkAcShuntDefinition, matchAcShuntRange } from './acShuntLibrary';

const finite = n => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n));
const maker = model => /Y5020|A40B|5790/i.test(model || '') ? 'Fluke' : /34420/i.test(model || '') ? 'Agilent' : '';
const identity = (model, serial) => [maker(model), serial, model].filter(Boolean).join(' ');
const frequencyQualifier = value => ({name:'Frequency', min:value, max:value, value, isSingleValue:true, unit:'Hz'});
const term = (value, distribution, unit='ppm') => ({high:value,low:-value,unit,symmetric:true,
  distribution:resolveErrorDistribution(distribution)?.value || String(distribution)});

export function buildAcShuntBudget(snapshot, { rocK = 2, instruments: library = [], selections = {} } = {}) {
  if (!Number.isFinite(Number(rocK)) || Number(rocK) <= 0) throw new Error('Certificate coverage factor must be positive.');
  const meta = snapshot.instruments;
  const topology = /A40B/i.test(meta.test_instrument_model || '') ? 'A40B'
    : /Y5020/i.test(meta.test_instrument_model || '') ? 'Y5020' : null;
  if (!topology) throw new Error('This importer supports A40B and Y5020 sessions.');
  if (!snapshot.points.length) throw new Error('This session has no measurement points.');
  const areaId = uuid(), uutId = uuid();
  const warnings = new Set();
  const instruments = new Map();
  const bindings = selectAcShuntDefinitions(snapshot, library, selections);
  const definitionFor = key => bindings.find(role => role.key === key)?.definition;
  const rangeCache = new Map();
  const addInstrument = (key, model, serial, description) => {
    if (!instruments.has(key)) instruments.set(key, linkAcShuntDefinition({id:uuid(), name:identity(model,serial) || description,
      assetId:serial || '', quantity:1, isInstrumentBased:true, measurementAreaNames:['Electrical'],
      instrument:{id:uuid(), manufacturer:maker(model), model:serial || model || '', serialNumber:serial || '', description:model || description,functions:[]}}, definitionFor(key)));
    return instruments.get(key);
  };
  // Reuse an authored range whenever its function, bounds, uncertainty and
  // provenance agree. Never append instrument-wide Type Bs for individual points.
  const rangeFor = (instrument, name, unit, data) => {
    let fn=instrument.instrument.functions.find(f=>f.name===name);
    if (!fn) {fn={id:uuid(),name,unit,ranges:[]};instrument.instrument.functions.push(fn);}
    const signature=JSON.stringify([instrument.id,name,unit,data]);
    let range=rangeCache.get(signature);
    if (!range) {
      range={id:uuid(),unit,...data, ...(data.qualifier ? {qualifierGroupId:JSON.stringify([instrument.id,fn.id,data.min,data.max,data.resolution])} : {})};fn.ranges.push(range);rangeCache.set(signature,range);
    }
    return {...range,rangeId:range.id,functionId:fn.id,functionName:fn.name};
  };
  const shunt=addInstrument('shunt',meta.standard_instrument_model,meta.standard_instrument_serial,'Reference AC shunt');
  const readers={},tvcs={};
  for (const [side,role] of [['std','standard'],['ti','test']]) {
    const model=meta[`${role}_reader_model`],serial=meta[`${role}_reader_serial`];
    readers[side]=addInstrument(`reader:${model}:${serial || meta[`${role}_reader_address`] || side}`,model,serial,`${role} reader`);
    if (topology==='A40B') tvcs[side]=addInstrument(`tvc:${meta[`${role}_tvc_serial`] || side}`,'TVC',meta[`${role}_tvc_serial`],`${role} TVC`);
  }
  const uut=linkAcShuntDefinition({id:uutId,name:identity(meta.test_instrument_model,meta.test_instrument_serial),description:meta.test_instrument_model,
    measurementArea:'Electrical',measurementAreaId:areaId,measurementAreaNames:['Electrical'],
    instrument:{id:uuid(),manufacturer:maker(meta.test_instrument_model),model:meta.test_instrument_serial || meta.test_instrument_model,serialNumber:meta.test_instrument_serial,description:meta.test_instrument_model,functions:[]}}, definitionFor('uut'));
  // This is the lab's requested UUT acceptance requirement, independent of the
  // manufacturer's accuracy and of any measured AC/DC difference. Leave the
  // shared master untouched; older shared specs become a visible local override.
  const navyTolerance = range => {
    const { bias, reading, readings_iv, floor, fullScale, db, offset, linearity, bandDistribution,
      singleSided, _doubleSidedTerms, whicheverIsGreater, tmdeUncertaintyDefinition, tolerance, tolerances, ...rest } = range;
    if (!bias && !reading && !readings_iv && !floor && !fullScale && !db && !offset && !linearity &&
      !singleSided && !_doubleSidedTerms && !whicheverIsGreater && !tmdeUncertaintyDefinition && !tolerance &&
      Object.keys(tolerances || {}).length === 1 && Number(tolerances.reading?.high) === 100 &&
      Number(tolerances.reading?.low) === -100 && tolerances.reading?.unit === 'ppm') return range;
    return { ...rest, tolerances: { reading: term(100, Math.sqrt(3)) },
      source: 'Navy UUT requirement', notes: 'Navy UUT acceptance requirement: ±100 ppm of reading; no UUT bias.' };
  };
  if (topology === 'Y5020' && uut.libraryInstrumentId) {
    const original = JSON.stringify(uut.instrument);
    uut.instrument.functions = (uut.instrument.functions || []).map(fn => ({ ...fn,
      ranges: (fn.ranges || []).map(navyTolerance) }));
    if (uut.instrument.ranges) uut.instrument.ranges = uut.instrument.ranges.map(navyTolerance);
    delete uut.instrument.bias;
    uut.instrument.localOverride = JSON.stringify(uut.instrument) !== original;
  }
  const modelRange=String(meta.test_instrument_model).match(/A40B[- ](\d+(?:\.\d+)?)\s*(mA|A)/i);
  const nominalRange=modelRange ? Number(modelRange[1])*(modelRange[2].toLowerCase()==='ma'?.001:1)
    : Number(snapshot.shuntRange) || Math.max(...snapshot.points.map(p=>Number(p.current)));
  if (topology==='A40B' && !uut.libraryInstrumentId && !modelRange && !snapshot.shuntRange) warnings.add('UUT nominal shunt range inferred from the largest saved current; verify against the nameplate.');
  const testPoints=snapshot.points.map(point=>{
    const nominal={name:'AC current',value:point.current,unit:'A',qualifier:{name:'Frequency',value:point.frequency,unit:'Hz'}};
    const components=[];
    const missing=(name,reason,source={})=>{
      warnings.add(`${point.current} A / ${point.frequency} Hz: ${reason}`);
      components.push({id:uuid(),name,type:'B',isCore:false,isManual:true,value:null,value_native:null,
        unit_native:'A',pendingReason:reason,acShuntSource:source});
    };
    const linked=(instrument,name,range,source)=>{
      const id=uuid();
      const c={id,componentId:id,name,type:'B',isCore:true,isBudgetInstance:true,quantity:1,
        sourceTmdeId:instrument.id,tmdeBudgetRange:range,
        originalInput:{inputMode:'tolerance',useFiniteDof:false},
        tmdeBudgetSourceId:instrument.id,tmdeBudgetRangeId:range.rangeId,
        tmdeBudgetFunctionId:range.functionId,tmdeBudgetFunctionName:range.functionName,
        tmdeBudgetComponentKind:'TMDE Error',tmdeIdentity:instrument.name,acShuntSource:source};
      components.push(c);return c;
    };
    const a=point.analytics;
    if (a?.n_pairs_used>=2 && finite(a.pair_type_a_uncertainty_ppm) && a.pair_type_a_uncertainty_ppm>=0) {
      const dof=a.n_pairs_used-1;
      const c=normalizeInlineManualComponent({component:{id:uuid(),dof,originalInput:{useFiniteDof:true}},
        draft:{name:'AC/DC repeatability',type:'A',inputMode:'standard',standardUncertainty:a.pair_type_a_uncertainty_ppm,unit:'ppm'},referencePoint:nominal});
      components.push({...c,dof,acShuntSource:{sessionId:snapshot.id,pointIds:point.sourcePointIds,analytics:a}});
    } else {missing('AC/DC repeatability','At least two accepted forward/reverse pairs are required for Type A.');components.at(-1).type='A';}
    if (point.stabilityFailed) warnings.add(`${point.current} A / ${point.frequency} Hz: source session flagged failed stability.`);
    const sources=point.shuntSources;
    if (shunt.libraryInstrumentId) {
      try {
        const range=matchAcShuntRange(shunt,'AC current',nominal);
        const errors=getBudgetComponentsFromTolerance(range,nominal).filter(error=>!error.isManual);
        if (!errors.length) throw new Error(`${shunt.name}: define the shared range uncertainty.`);
        for (const error of errors) {
          const component=linked(shunt,'Reference shunt',range,{sharedInstrumentId:shunt.libraryInstrumentId});
          Object.assign(component,{tmdeUncertaintySourceId:error.tmdeUncertaintySourceId,
            tmdeUncertaintyComponentKind:error.tmdeUncertaintyComponentKind,
            tmdeBudgetComponentKind:error.isResolution ? 'Resolution' : String(error.name || '').split(' - ').slice(1).join(' - ') || 'TMDE Error',
            ...(error.isResolution ? {isResolution:true,tmdeBudgetComponentKind:'Resolution'} : {})});
        }
      }
      catch(error) { missing('Reference shunt',error.message); }
    } else if (sources.length && sources.every(s=>s && finite(s.expandedPpm))) {
      const expanded=Math.max(...sources.map(s=>s.expandedPpm));
      const provenance={certificates:sources,coverageFactor:rocK};
      const range=rangeFor(shunt,'AC current','A',{range:`${point.current} A`,min:point.current,max:point.current,
        qualifier:frequencyQualifier(point.frequency),tolerances:{reading:term(expanded,rocK)},acShuntSource:provenance});
      linked(shunt,'Reference shunt RoC',range,provenance);
    } else missing('Reference shunt RoC','Reference shunt certificate uncertainty is unavailable.');
    if (!shunt.libraryInstrumentId && sources.some(s=>s?.report.selection.includes('legacy'))) warnings.add('Legacy points use the current shunt report; verify it matches the calibration date.');
    if (topology==='A40B') for (const side of ['std','ti']) {
      const source=point.tvcs[side],instrument=tvcs[side];
      const name=`${side==='std'?'Standard':'Test'} TVC NPSL RoC`;
      if (source && finite(source.testVoltage) && source.testVoltage>0) {
        try {
        const range=instrument.libraryInstrumentId ? matchAcShuntRange(instrument,'AC/DC transfer',
          {value:source.testVoltage,unit:'V',qualifier:nominal.qualifier}) : rangeFor(instrument,'AC/DC transfer','V',{range:`${source.testVoltage} V`,
          min:source.testVoltage,max:source.testVoltage,qualifier:frequencyQualifier(point.frequency),
          tolerances:{reading:term(source.expandedPpm,rocK)},acShuntSource:{certificate:source,coverageFactor:rocK}});
        const c=linked(instrument,name,range,{certificate:source,coverageFactor:rocK});
        c.tmdeTransferSources=[{sourceId:instrument.id,rangeId:range.rangeId,functionId:range.functionId,
          nominal:{value:source.testVoltage,unit:'V',qualifier:nominal.qualifier},sensitivity:point.current/source.testVoltage,role:side,direction:'certificate'}];
        } catch(error) { missing(name,error.message); }
      } else missing(name,'TVC certificate uncertainty or test voltage is unavailable.');
      if (!instrument.libraryInstrumentId) warnings.add('TVC certificates use current reports; historical TVC report links are not stored.');
    }
    const byReader=new Map();
    for (const [side,role] of [['std','standard'],['ti','test']]) {
      const reader=readers[side],model=meta[`${role}_reader_model`];
      if (!reader.libraryInstrumentId && /34420/i.test(model || '') && point.readerPoints.some(p=>p.nplc!=null && Number(p.nplc)!==100)) {
        warnings.add(`${point.current} A / ${point.frequency} Hz: saved 34420A NPLC differs from the 100 NPLC specification conditions; review the reader contribution.`);
      }
      try {
        if (!point.readerPoints.length) throw Error('Saved reader phase averages are incomplete.');
        if (!reader.libraryInstrumentId && /34420/i.test(model || '') && point.readerPoints.some(p=>p.nplc==null)) warnings.add('34420A resolution assumes 100 NPLC when the saved integration time is unavailable; verify against the acquisition settings.');
        if (!reader.libraryInstrumentId && /5790/i.test(model || '') && point.readerPoints.some(p=>!p.filterMode)) warnings.add('5790B resolution uses the conservative Fast-filter specification when the saved filter mode is unavailable.');
        const details=point.readerPoints.map(p=>reader.libraryInstrumentId ? readerTransferInputs(model,side,p) : readerContribution(model,side,p,point.frequency));
        const transfers=[];
        let firstRange;
        for (const d of details) for (const [i,voltage] of d.voltages.entries()) {
          const s=d.specs?.[i];
          const transferNominal={value:Math.abs(Number(voltage)),unit:'V',qualifier:nominal.qualifier};
          const physicalRange=/5790/i.test(model || '') ? (finite(d.rangeMode) ? (i>=2 ? Math.max(.22,Number(d.rangeMode)) : Number(d.rangeMode)) : /^auto$/i.test(d.rangeMode) ? 'AUTO' : null) : null;
          const range=reader.libraryInstrumentId ? matchAcShuntRange(reader,d.functionNames[i],transferNominal,physicalRange) : rangeFor(reader,s.functionName,'V',{range:`0 to ${s.range} V`,
            min:0,max:s.range,notes:s.conditions,source:s.source,
            ...(s.frequencyBand?{frequencyBand:s.frequencyBand,qualifier:{name:'Frequency',min:s.frequencyBand[0],max:s.frequencyBand[1],unit:'Hz'}}:{}),
            resolution:s.resolutionVolts,resolutionUnit:'V',includeResolutionInBudget:true,
            tolerances:{reading:term(s.readingPpm,s.divisor),floor:term(s.floorVolts,s.divisor,'V')}});
          firstRange ||= range;
          transfers.push({sourceId:reader.id,rangeId:range.rangeId,functionId:range.functionId,
          nominal:transferNominal,sensitivity:d.sensitivities[i]*point.current,role:side,direction:d.direction});
        }
        let c=byReader.get(reader.id);
        if (!c) {c=linked(reader,`Reader uncertainty · ${reader.name}`,firstRange,{interval:'1 year',details:[],method:'Sum absolute phase sensitivities; largest direction; shared reader roles summed.'});c.tmdeTransferSources=[];byReader.set(reader.id,c);}
        c.tmdeTransferSources.push(...transfers);c.acShuntSource.details.push(...details);
      } catch(error) {missing(`${role} reader · ${reader.name}`,error.message,{model,side});}
    }
    for (const reader of byReader.values()) {
      const master=[...instruments.values()].find(item=>item.id===reader.tmdeBudgetSourceId);
      if (master.libraryInstrumentId && !getInstrumentRangeRows(master).some(range=>
        reader.tmdeTransferSources.some(source=>source.rangeId===range.rangeId && source.functionId===range.functionId) &&
        (range.includeResolutionInBudget || range.tolerances?.includeResolutionInBudget))) continue;
      const id=uuid();
      components.push({...reader,id,componentId:id,name:reader.name.replace('Reader uncertainty','Reader resolution'),isResolution:true,tmdeBudgetComponentKind:'Resolution'});
    }
    let uutTolerance=null;
    try {
      const spec=uut.libraryInstrumentId ? null : topology==='Y5020' ? {ppm:100,distribution:Math.sqrt(3),source:'Navy UUT requirement',conditions:'±100 ppm of reading; no UUT bias.'} : acShuntUutSpec(meta.test_instrument_model,nominalRange,point.frequency,point.current,meta.humidity);
      uutTolerance=uut.libraryInstrumentId ? matchAcShuntRange(uut,'AC current',nominal) : rangeFor(uut,'AC current','A',{range:`${point.current} A`,min:point.current,max:point.current,
        qualifier:frequencyQualifier(point.frequency),
        tolerances:{reading:term(spec.ppm,spec.distribution),
          ...(topology!=='Y5020' && finite(a?.pair_delta_uut_ppm)?{bias:{kind:'absolute',value:point.current*a.pair_delta_uut_ppm*1e-6,unit:'A'}}:{})},
        source:spec.source,notes:spec.conditions});
    } catch(error) {warnings.add(`${point.current} A / ${point.frequency} Hz: ${error.message}`);}
    return {id:uuid(),section:'',measurementAreaId:areaId,
      associatedUutIds:[uutId],activeUutId:uutId,measurementType:'direct',components,tmdeTolerances:[],uutTolerance,
      specifications:{mfg:{uncertainty:'',k:2},navy:{uncertainty:'',k:2}},
      is_detailed_uncertainty_calculated:false,coverageFactorMode:'auto',
      testPointInfo:{measurementArea:'Electrical',parameter:nominal,qualifier:frequencyQualifier(point.frequency),
        acShuntSource:{sessionId:snapshot.id,pointIds:point.sourcePointIds,deltaPpm:a?.pair_delta_uut_ppm,importedAt:new Date().toISOString()}}};
  });
  const assumptions=[`Source: AC-shunt session ${snapshot.id} (${snapshot.name}).`,
    `Type A uses accepted paired cycle results and N−1 degrees of freedom. ${topology==='Y5020' ? 'Paired AC/DC difference is retained as source metadata only, not UUT bias.' : 'Generated A40B specifications retain paired AC/DC difference as signed UUT bias.'}`,
    `For generated instruments only: RoC values are expanded uncertainty, k=${rocK}; verify certificate coverage factors. Shared definitions retain their authored distributions.`,
    topology==='Y5020' ? 'Y5020 UUT acceptance: Navy requirement ±100 ppm of reading, with no bias. This overrides older manufacturer/bias specifications in the imported session copy only.' : 'A40B UUT acceptance: shared instrument limits when matched; otherwise manufacturer p.4, 1 year, Tcal ±1 °C, ≤50% RH, interpolation above 1 kHz and 1 kHz limit below it.',
    'Matching shared instruments supply existing ranges and uncertainties. Unmatched instruments are generated for initial setup; share their completed definitions for repeat imports. Missing or ambiguous shared ranges remain incomplete.',
    'Generated reader specifications: 1 year. 34420A: 1 V DC, 23 ±5 °C, 100 NPLC, filters off, 2-hour warm-up. 5790B: saved range or autorange from recorded voltage, ±5 °C of calibration, manufacturer warm-up and DC-zero requirements. Shared readers retain their authored specifications.',
    'Budget errors are linked to the authored TMDE ranges at the saved phase voltages. Absolute phase sensitivities sum conservatively; use the largest direction and sum shared-reader roles before RSS. Range edits refresh the budget and risk.',
    'Default risk assumptions: 85% reliability, 12-month interval, required TUR 4, PFA target 2%, 95% coverage. Review lab requirements.'];
  const session={name:`${snapshot.name} · AC/DC budget`,organization:'NPSL',document:`AC-shunt session ${snapshot.id}`,
    documentDate:snapshot.createdAt.slice(0,10),measurementAreas:[{id:areaId,name:'Electrical',color:'#5aa6d9'}],
    measurementAreaGroups:[{id:'electrical',name:'Electrical',units:['A'],color:'#5aa6d9'}],
    uuts:[uut],tmdes:[...instruments.values()],testPoints,noteImages:[],uutTolerance:{},
    uncReq:{uncertaintyConfidence:95,reliability:85,calInt:12,neededTUR:4,reqPFA:2},
    detailSectionOrder:['instruments','equation','budget'],detailCollapsedSections:[]};
  for (const item of [...session.uuts,...session.tmdes].filter(item=>!item.libraryInstrumentId)) for (const fn of item.instrument.functions) fn.ranges.sort((a,b) => (a.min-b.min) || (a.max-b.max) || String(a.qualifierGroupId || '').localeCompare(String(b.qualifierGroupId || '')) || ((a.qualifier?.min ?? 0)-(b.qualifier?.min ?? 0)));
  session.testPoints=testPoints.map(point=>{
    const resolved={...point,components:resolvePointBudgetComponents(point,session)};
    return recalculatePointUncertaintyFields(resolved,session);
  });
  let riskCalculated=0;
  for (const point of session.testPoints) {
    const risk=computePointRiskMetrics(point,session);
    if (risk && ['tur','pfa','pfr'].every(key=>Number.isFinite(risk[key]))) riskCalculated++;
    else warnings.add(`${point.testPointInfo.parameter.value} A / ${point.testPointInfo.qualifier.value} Hz: risk needs complete UUT limits and TMDE/Type A inputs.`);
  }
  session.notes=[...assumptions,...warnings].join('\n');
  return {warnings:[...warnings],topology,riskCalculated,session,bindings,
    reusedInstruments:bindings.filter(role=>role.definition).length,
    needsCertificates:bindings.some(role=>/^(shunt|tvc:)/.test(role.key) && !role.definition)};
}
