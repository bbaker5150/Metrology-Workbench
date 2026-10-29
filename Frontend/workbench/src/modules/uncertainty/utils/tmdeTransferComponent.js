import { getInstrumentRangeRows } from './instrumentFunctionSelection';
import { getBudgetComponentsFromTolerance } from '../features/analysis/utils/budgetUtils';
import { unresolvedComponent } from './incompleteBudget';
import { formatRangeLabel } from './rangeFormatting';
import { resolveErrorDistribution, unitSystem } from './uncertaintyMath';

// A transfer measurement can use several physical ranges in one correlated
// error contribution. Resolve the live range limits at each saved input value,
// then apply the recorded sensitivity (output-unit / input-unit). Sum correlated
// phases, take the largest repeated direction, and sum roles of a shared meter.
export function resolveTmdeTransferComponent(component, session, nominal) {
  try {
    const groups = new Map();
    const sourceDetails = [];
    const divisors = new Set();
    for (const source of component.tmdeTransferSources || []) {
      const master = session.tmdes.find(t => String(t.id) === String(source.sourceId));
      const range = master && getInstrumentRangeRows(master,{flattenTolerances:true}).find(r =>
        String(r.rangeId) === String(source.rangeId) && String(r.functionId) === String(source.functionId));
      if (!range) throw Error('The linked TMDE range is missing.');
      const resolved = getBudgetComponentsFromTolerance(range,source.nominal).filter(c=>Boolean(c.isResolution) === Boolean(component.isResolution) && !c.isManual);
      if (!resolved.length || resolved.some(c=>c.pendingReason || !Number.isFinite(c.value_native))) throw Error('Set uncertainty and distribution for the linked TMDE range.');
      const sensitivity = Number(source.sensitivity);
      if (!Number.isFinite(sensitivity)) throw Error('The saved transfer sensitivity is invalid.');
      const groupKey = `${source.role}:${source.direction}`;
      const group = groups.get(groupKey) || {role:source.role,standard:0,limit:0};
      for (const c of resolved) {
        const rawDivisor=Number(c.distributionDivisor);
        const divisor=c.isResolution && ["3.464","4.899"].includes(String(c.distributionDivisor)) ? rawDivisor / 2 : rawDivisor;
        divisors.add(divisor);
        const sourceScale = unitSystem.units[source.nominal.unit]?.to_si ?? 1;
        const scale = (unitSystem.units[c.unit_native]?.to_si ?? 1) / sourceScale;
        group.standard += Math.abs(sensitivity*c.value_native*scale);
        group.limit += Math.abs(sensitivity*(c.isResolution ? c.value_native*divisor : c.toleranceLimit_native)*scale);
      }
      groups.set(groupKey,group);
      sourceDetails.push({instrument:master.name,range:formatRangeLabel(range,{preferBounds:true}),nominal:source.nominal,sensitivity});
    }
    const roles = [...new Set([...groups.values()].map(g=>g.role))];
    const standard=roles.reduce((sum,role)=>sum+Math.max(...[...groups.values()].filter(g=>g.role===role).map(g=>g.standard)),0);
    const limit=roles.reduce((sum,role)=>sum+Math.max(...[...groups.values()].filter(g=>g.role===role).map(g=>g.limit)),0);
    if (!roles.length || !(Number(nominal?.value)>0)) throw Error('The transfer contribution has no valid input values.');
    const divisor=divisors.size===1 ? [...divisors][0] : limit/standard;
    return {...component,pendingReason:null,value:standard/Number(nominal.value)*1e6,value_native:standard,
      unit_native:nominal.unit,isBaseUnitValue:false,toleranceLimit_native:limit,
      distributionDivisor:resolveErrorDistribution(divisor)?.value || String(divisor),
      distribution:resolveErrorDistribution(divisor)?.label || 'Combined uncertainty',tmdeTransferDetails:sourceDetails,
      originalInput:{...component.originalInput,toleranceLimit:limit,errorDistributionDivisor:String(divisor),unit:nominal.unit}};
  } catch(error) { return unresolvedComponent(component,error.message); }
}
