import { v4 as uuid } from 'uuid';
import { normalizeInlineManualComponent } from '../features/analysis/utils/manualComponentUtils';
import { readerContribution } from './acShuntReaderSpecs';

const finite = n => n !== null && n !== undefined && Number.isFinite(Number(n));
const identity = (model, serial) => [model, serial && `S/N ${serial}`].filter(Boolean).join(' · ');

export function buildAcShuntBudget(snapshot, { rocK = 2 } = {}) {
  if (!Number.isFinite(Number(rocK)) || Number(rocK) <= 0) throw new Error('Certificate coverage factor must be positive.');
  const meta = snapshot.instruments;
  const topology = /A40B/i.test(meta.test_instrument_model || '') ? 'A40B'
    : /Y5020/i.test(meta.test_instrument_model || '') ? 'Y5020' : null;
  if (!topology) throw new Error('This importer supports A40B and Y5020 sessions.');
  if (!snapshot.points.length) throw new Error('This session has no measurement points.');
  const areaId = uuid(), uutId = uuid();
  const warnings = new Set();
  const instruments = new Map();
  const addInstrument = (key, model, serial, description) => {
    if (!instruments.has(key)) instruments.set(key, {id:uuid(), name:identity(model,serial) || description,
      assetId:serial || '', quantity:1, isInstrumentBased:true, measurementAreaNames:['Electrical'],
      instrument:{id:uuid(), model:model || '', serialNumber:serial || '', description,
        functions:[], typeBComponents:[]}});
    return instruments.get(key);
  };
  const shunt = addInstrument('shunt',meta.standard_instrument_model,meta.standard_instrument_serial,'Reference AC shunt');
  const readers = {};
  for (const [side,role] of [['std','standard'],['ti','test']]) {
    const model = meta[`${role}_reader_model`], serial = meta[`${role}_reader_serial`];
    const key = serial || meta[`${role}_reader_address`] || side;
    readers[side] = addInstrument(`reader:${model}:${key}`,model,serial,`${role} reader`);
    if (topology === 'A40B') addInstrument(`tvc:${side}`,'TVC',meta[`${role}_tvc_serial`],`${role} TVC`);
  }
  const recordSpec = (instrument, point, name, ppm, source, rawSpecs = []) => {
    instrument.instrument.typeBComponents.push({id:uuid(), kind:'manual', name,
      budgetComponent:{id:uuid(), name, type:'B', isManual:true, isInlineManual:true,
        manualInputMode:'standard', manualRawValue:ppm, manualUnit:'ppm',
        originalInput:{inputMode:'standard', standardUncertainty:ppm, unit:'ppm'},
        sourcePointLabel:`${point.current} A / ${point.frequency} Hz`, acShuntSource:source}});
    for (const s of rawSpecs) {
      let fn = instrument.instrument.functions.find(fn => fn.name === s.functionName);
      if (!fn) { fn = {id:uuid(),name:s.functionName,unit:'V',ranges:[]}; instrument.instrument.functions.push(fn); }
      const label = `${s.range} V · ${s.functionName === 'AC Voltage' ? `${point.frequency} Hz` : 'DC'}`;
      if (fn.ranges.some(r => r.range === label)) continue;
      fn.ranges.push({id:uuid(),range:label,min:0,max:s.range,unit:'V',
        notes:s.conditions, source:s.source,
        tolerances:{reading:{high:s.readingPpm,low:-s.readingPpm,unit:'ppm',symmetric:true,distribution:String(s.divisor)},
          floor:{high:s.floorVolts,low:-s.floorVolts,unit:'V',symmetric:true,distribution:String(s.divisor)}}});
    }
  };
  const testPoints = snapshot.points.map(point => {
    const nominal = {name:'AC current',value:point.current,unit:'A'};
    const components = [];
    const add = (name, ppm, type, source, dof = null, missing = '') => {
      const id = uuid();
      const reason = missing || (!finite(ppm) || ppm < 0 ? `${name}: source value unavailable.` : '');
      if (reason) {
        warnings.add(`${point.current} A / ${point.frequency} Hz: ${reason}`);
        components.push({id,name,type,isCore:false,isManual:true,value:null,value_native:null,
          unit_native:'A',pendingReason:reason,acShuntSource:source});
        return;
      }
      const component = normalizeInlineManualComponent({component:{id,dof,originalInput:{useFiniteDof:type==='A'}},
        draft:{name,type,inputMode:'standard',standardUncertainty:ppm,unit:'ppm'},referencePoint:nominal});
      components.push({...component,dof,acShuntSource:source,sourcePointLabel:`AC-shunt session ${snapshot.id}`});
    };
    const a = point.analytics;
    add('AC/DC repeatability',a?.pair_type_a_uncertainty_ppm,'A',
      {sessionId:snapshot.id,pointIds:point.sourcePointIds,analytics:a},a?.n_pairs_used>=2?a.n_pairs_used-1:null,
      a?.n_pairs_used>=2?'':'At least two accepted forward/reverse pairs are required for Type A.');
    if (point.stabilityFailed) warnings.add(`${point.current} A / ${point.frequency} Hz: source session flagged failed stability.`);
    // Certificates used by either direction must be present. Take the largest
    // expanded uncertainty without claiming reduction for repeated use.
    const sources = point.shuntSources;
    const shuntPpm = sources.length && sources.every(Boolean) ? Math.max(...sources.map(s=>s.expandedPpm))/rocK : null;
    add('Reference shunt RoC',shuntPpm,'B',{certificates:sources,coverageFactor:rocK});
    if (finite(shuntPpm)) recordSpec(shunt,point,'Reference shunt RoC',shuntPpm,{certificates:sources,coverageFactor:rocK});
    if (finite(shuntPpm)) {
      let fn=shunt.instrument.functions[0];
      if (!fn) {fn={id:uuid(),name:'AC current',unit:'A',ranges:[]};shunt.instrument.functions.push(fn);}
      fn.ranges.push({id:uuid(),range:`${point.current} A / ${point.frequency} Hz`,min:point.current,max:point.current,
        unit:'A',qualifier:{name:'Frequency',value:point.frequency,unit:'Hz'},
        tolerances:{reading:{high:shuntPpm*rocK,low:-shuntPpm*rocK,unit:'ppm',symmetric:true,distribution:String(rocK)}},
        acShuntSource:{certificates:sources,coverageFactor:rocK}});
    }
    if (sources.some(s=>s?.report.selection.includes('legacy'))) warnings.add('Legacy points use the current shunt report; verify it matches the calibration date.');
    if (topology==='A40B') for (const side of ['std','ti']) {
      const source = point.tvcs[side];
      const ppm = source ? source.expandedPpm/rocK : null;
      const name = `${side==='std'?'Standard':'Test'} TVC NPSL RoC`;
      add(name,ppm,'B',{certificate:source,coverageFactor:rocK});
      if (source) recordSpec(instruments.get(`tvc:${side}`),point,name,ppm,{certificate:source,coverageFactor:rocK});
      warnings.add('TVC certificates use current reports; historical TVC report links are not stored.');
    }
    const byReader = new Map();
    for (const [side,role] of [['std','standard'],['ti','test']]) {
      const reader = readers[side], model = meta[`${role}_reader_model`];
      if (/34420/i.test(model || '') && point.readerPoints.some(p=>p.nplc != null && Number(p.nplc)!==100)) {
        warnings.add(`${point.current} A / ${point.frequency} Hz: saved 34420A NPLC differs from the 100 NPLC specification conditions; review the reader contribution.`);
      }
      try {
        const contributions = point.readerPoints.map(p=>readerContribution(model,side,p,point.frequency));
        const ppm = Math.max(...contributions.map(c=>c.standardPpm));
        const existing = byReader.get(reader.id) || {reader,ppm:0,details:[]};
        existing.ppm += ppm; existing.details.push(...contributions); byReader.set(reader.id,existing);
      } catch (error) {
        add(`${role} reader · ${reader.name}`,null,'B',{model,side},null,error.message);
      }
    }
    for (const {reader,ppm,details} of byReader.values()) {
      const name = `Reader uncertainty · ${reader.name}`;
      const source = {details,method:'Sum of absolute phase sensitivities; largest direction; shared reader contributions summed.',interval:'1 year'};
      add(name,ppm,'B',source); recordSpec(reader,point,name,ppm,source,details.flatMap(d=>d.specs));
    }
    return {id:uuid(),section:`${point.current} A / ${point.frequency} Hz`,measurementAreaId:areaId,
      associatedUutIds:[uutId],measurementType:'direct',components,tmdeTolerances:[],uutTolerance:null,
      specifications:{mfg:{uncertainty:'',k:2},navy:{uncertainty:'',k:2}},
      is_detailed_uncertainty_calculated:false,coverageFactorMode:'auto',
      testPointInfo:{measurementArea:'Electrical',parameter:nominal,
        qualifier:{name:'Frequency',value:point.frequency,unit:'Hz'},
        acShuntSource:{sessionId:snapshot.id,pointIds:point.sourcePointIds,deltaPpm:a?.pair_delta_uut_ppm,
          importedAt:new Date().toISOString(),warnings:[...warnings]}}};
  });
  const uutName = identity(meta.test_instrument_model,meta.test_instrument_serial);
  const currentRanges = [...new Set(snapshot.points.map(p=>p.current))].map(current=>({id:uuid(),range:`${current} A`,min:current,max:current,unit:'A',tolerances:{}}));
  const assumptions = [`Source: AC-shunt session ${snapshot.id} (${snapshot.name}).`,
    'Type A uses accepted paired cycle results and N−1 degrees of freedom.',
    `RoC values treated as expanded uncertainty, k=${rocK}; verify certificate coverage factors.`,
    'Reader specifications: 1 year. 34420A: 1 V DC range, 23 ±5 °C, 100 NPLC, filters off, 2-hour warm-up. 5790B: saved range or autorange from recorded voltage, ±5 °C of calibration, manufacturer warm-up and DC-zero requirements.',
    'Reader contributions conservatively sum absolute phase sensitivities; no cancellation or averaging-down of systematic error. Shared readers are combined before RSS.',
    'Point nominal is current in A; uncertainties are relative ppm of current. AC/DC difference is preserved in point source data. UUT acceptance tolerances are not inferred from reference certificates.'];
  return {warnings:[...warnings],topology,session:{name:`${snapshot.name} · AC/DC budget`,organization:'NPSL',
    document:`AC-shunt session ${snapshot.id}`,documentDate:snapshot.createdAt.slice(0,10),notes:[...assumptions,...warnings].join('\n'),
    measurementAreas:[{id:areaId,name:'Electrical',color:'#5aa6d9'}],
    measurementAreaGroups:[{id:'electrical',name:'Electrical',units:['A'],color:'#5aa6d9'}],
    uuts:[{id:uutId,name:uutName,description:'AC shunt under test',measurementArea:'Electrical',measurementAreaId:areaId,
      measurementAreaNames:['Electrical'],instrument:{id:uuid(),model:meta.test_instrument_model,serialNumber:meta.test_instrument_serial,
        description:'AC shunt under test',functions:[{id:uuid(),name:'AC current',unit:'A',ranges:currentRanges}]}}],
    tmdes:[...instruments.values()],testPoints,noteImages:[],uutTolerance:{},
    uncReq:{uncertaintyConfidence:95,reliability:85,calInt:12,neededTUR:4,reqPFA:2},
    detailSectionOrder:['instruments','equation','budget'],detailCollapsedSections:[]}};
}
