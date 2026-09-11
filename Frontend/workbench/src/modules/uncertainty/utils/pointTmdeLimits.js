import { matchingResolution } from "./pointLimitDisplay";
import { parse } from "mathjs";
import { calculateUncertaintyFromToleranceObject, unitSystem } from "./uncertaintyMath";
import { getInstrumentRangeRows } from "./instrumentFunctionSelection";
import { reconcileTmdeInstances, refreshTmdeInstancesFromMasters } from "./tmdeReconcile";
import { validateEquation } from "./equationValidation";

const numeric = v => v !== "" && v != null && Number.isFinite(Number(v));
const finite = pair => {
  if (!pair.every(Number.isFinite)) throw Error("The equation produces unbounded TMDE limits.");
  return pair;
};
// Interval arithmetic encloses the entire input bands, including interior extrema.
// Repeated variables may widen the enclosure; never claim an unverified tight bound.
function interval(node, scope) {
  if (node.isParenthesisNode) return interval(node.content, scope);
  if (node.isConstantNode) return finite([Number(node.value), Number(node.value)]);
  if (node.isSymbolNode) {
    if (scope[node.name]) return scope[node.name];
    if (node.name === "pi") return [Math.PI, Math.PI];
    if (node.name === "e") return [Math.E, Math.E];
    throw Error(`Missing nominal or tolerance for equation input ${node.name}.`);
  }
  const a = (node.args || []).map(n => interval(n, scope));
  const [x, y] = a;
  if (node.isOperatorNode) {
    switch (node.op) {
      case "+": return y ? finite([x[0]+y[0], x[1]+y[1]]) : x;
      case "-": return y ? finite([x[0]-y[1], x[1]-y[0]]) : [-x[1],-x[0]];
      case "*": { const v=x.flatMap(i=>y.map(j=>i*j)); return finite([Math.min(...v),Math.max(...v)]); }
      case "/": {
        if (y[0]<=0 && y[1]>=0) throw Error("A denominator crosses zero within the TMDE limits.");
        const v=x.flatMap(i=>y.map(j=>i/j)); return finite([Math.min(...v),Math.max(...v)]);
      }
      case "^": {
        if (y[0]!==y[1]) throw Error("Variable exponents are not supported for TMDE limit propagation.");
        const n=y[0];
        if ((!Number.isInteger(n) && x[0]<0) || (n<0 && x[0]<=0 && x[1]>=0)) throw Error("The power is undefined within the TMDE limits.");
        const v=[x[0]**n,x[1]**n];
        if (n>0 && Number.isInteger(n) && n%2===0 && x[0]<=0 && x[1]>=0) v.push(0);
        return finite([Math.min(...v),Math.max(...v)]);
      }
    }
  }
  if (node.isFunctionNode) {
    const name=node.fn.name;
    if (name==="abs") return [x[0]<=0&&x[1]>=0 ? 0 : Math.min(...x.map(Math.abs)),Math.max(...x.map(Math.abs))];
    if (["sqrt","exp","log","log10"].includes(name) && a.length===1) {
      if ((name==="sqrt" && x[0]<0) || (name.startsWith("log") && x[0]<=0)) throw Error("The function is undefined within the TMDE limits.");
      return finite(x.map(Math[name]));
    }
  }
  throw Error("This equation operation is not supported for TMDE limit propagation.");
}

export function computePointTmdeLimits(point, session = {}) {
  const entries=[];
  try {
    const nominal=point.testPointInfo?.parameter;
    if (!numeric(nominal?.value) || !unitSystem.units[nominal?.unit]) throw Error("Enter a measurement value and unit to calculate TMDE limits.");
    const derived=point.measurementType==="derived";
    const sources=refreshTmdeInstancesFromMasters(reconcileTmdeInstances(point.tmdeTolerances || [],session.tmdes || []),session.tmdes || []).map(t=>({
      id:t.id,sourceId:t.sourceId || t.id,rangeId:t.rangeId || t.tolerance?.id,variableType:t.variableType,
      name:t.name || t.description || "TMDE",tolerance:t.tolerance || t,
      nominal:derived ? (point.variableNominals?.[Object.keys(point.variableMappings || {}).find(k=>point.variableMappings[k]===t.variableType)] || t.measurementPoint) : (t.measurementPoint || nominal),quantity:Math.max(1,Number(t.quantity)||1)
    }));
    const seen=new Set(sources.map(s=>JSON.stringify([String(s.sourceId),String(s.rangeId),s.variableType || ""])));
    for (const c of point.components || []) {
      if (!c.tmdeBudgetSourceId) continue;
      const master=(session.tmdes || []).find(t=>String(t.id)===String(c.tmdeBudgetSourceId)||String(t.sourceId)===String(c.tmdeBudgetSourceId));
      if (!master) throw Error("A linked TMDE is missing; reassign its budget source.");
      const ranges=getInstrumentRangeRows(master,{flattenTolerances:true});
      const range=c.tmdeBudgetRangeId
        ? ranges.find(r=>String(r.rangeId??r.id)===String(c.tmdeBudgetRangeId) && (!c.tmdeBudgetFunctionId || !r.functionId || String(r.functionId)===String(c.tmdeBudgetFunctionId)))
        : ranges.find(r=>r.functionName===c.tmdeBudgetFunctionName) || ranges[0];
      if (!range) throw Error("A linked TMDE range is missing; reassign its budget source.");
      const reference = derived ? point.variableNominals?.[Object.keys(point.variableMappings || {}).find(k=>point.variableMappings[k]===c.variableType)] : nominal;
      if (range.unit && unitSystem.units[range.unit] && reference?.unit && unitSystem.units[range.unit].quantity !== unitSystem.units[reference.unit]?.quantity) throw Error("TMDE and measurement units differ; correct the equation input units.");
      const key=JSON.stringify([String(master.id),String(range.rangeId??range.id),c.variableType || ""]);
      if (seen.has(key) || sources.some(s=>String(s.sourceId)===String(master.id) && s.variableType===c.variableType && (!s.rangeId || String(s.rangeId)===String(range.rangeId??range.id)))) continue;
      seen.add(key);
      const symbol=Object.keys(point.variableMappings || {}).find(k=>point.variableMappings[k]===c.variableType);
      sources.push({id:key,name:master.name || master.description || c.name || "TMDE",tolerance:range,
        nominal:derived ? point.variableNominals?.[symbol] : nominal,variableType:c.variableType,quantity:1});
    }
    if (!sources.length) throw Error("No TMDE specification is linked to this point.");
    const bands={};
    let lowDev=0,highDev=0;
    for (const source of sources) {
      let ref=source.nominal;
      const targetUnit=source.tolerance.unit || source.tolerance.functionUnit;
      if (derived && targetUnit && ref?.unit && targetUnit !== ref.unit && unitSystem.units[targetUnit]?.quantity === unitSystem.units[ref.unit]?.quantity) {
        ref={value:unitSystem.fromBaseUnit(unitSystem.toBaseUnit(Number(ref.value),ref.unit),targetUnit),unit:targetUnit};
      }
      if (!numeric(ref?.value) || !unitSystem.units[ref?.unit]) throw Error("A TMDE measurement value or unit is missing.");
      const specs=(calculateUncertaintyFromToleranceObject(source.tolerance,ref).breakdown || []).filter(c=>numeric(c.absoluteLow)&&numeric(c.absoluteHigh));
      if (!specs.length) throw Error("A linked TMDE has no usable specification limits.");
      const value=Number(ref.value),scale=unitSystem.units[ref.unit].to_si;
      const lo=specs.reduce((v,c)=>v+Number(c.absoluteLow)-value,0),hi=specs.reduce((v,c)=>v+Number(c.absoluteHigh)-value,0);
      if (lo>hi) throw Error("A TMDE lower limit exceeds its upper limit.");
      entries.push({id:source.id,variableType:source.variableType,description:source.name,quantity:source.quantity,
        low:`${value+lo} ${ref.unit}`,high:`${value+hi} ${ref.unit}`,rawLow:value+lo,rawHigh:value+hi,unit:ref.unit,resolution:matchingResolution(source.tolerance,ref.unit)});
      if (derived) {
        const symbol=Object.keys(point.variableMappings || {}).find(k=>point.variableMappings[k]===source.variableType);
        if (!symbol) throw Error("A TMDE is not mapped to an equation input.");
        const previous=bands[symbol] || {lo:0,hi:0,nominal:0};
        previous.lo+=lo*scale*source.quantity; previous.hi+=hi*scale*source.quantity;
        previous.nominal+=value*scale*source.quantity; bands[symbol]=previous;
      } else {
        if (unitSystem.units[ref.unit].quantity!==unitSystem.units[nominal.unit].quantity) throw Error("TMDE and UUT units differ; use a measurement equation.");
        lowDev+=lo*scale*source.quantity;highDev+=hi*scale*source.quantity;
      }
    }
    if (derived && entries.some(entry => unitSystem.units[entry.unit]?.quantity !== unitSystem.units[nominal.unit]?.quantity)) {
      return { low:null, high:null, span:null, entries, reason:"TAR is unavailable: TMDE limits are in different physical units from the measurement point.", method:"Individual TMDE specification limits" };
    }
    let low,high;
    if (derived) {
      const validation=validateEquation(point.equationString);
      if (validation.status!=="ok") throw Error("Enter a valid measurement equation.");
      const scope={};
      for (const symbol of validation.variables) {
        if (!bands[symbol]) throw Error(`No TMDE specification is linked to input ${symbol}.`);
        const ref=point.variableNominals?.[symbol],b=bands[symbol];
        const center=numeric(ref?.value)&&unitSystem.units[ref?.unit] ? unitSystem.toBaseUnit(Number(ref.value),ref.unit) : b.nominal;
        scope[symbol]=[center+b.lo,center+b.hi];
      }
      [low,high]=interval(parse(validation.expression),scope).map(v=>v/unitSystem.units[nominal.unit].to_si);
    } else {
      low=Number(nominal.value)+lowDev/unitSystem.units[nominal.unit].to_si;
      high=Number(nominal.value)+highDev/unitSystem.units[nominal.unit].to_si;
    }
    if (!(high > low)) throw Error("The TMDE specification has zero width; TAR is unavailable.");
    return {low,high,span:high-low,entries,unit:nominal.unit,reason:null,
      method:derived ? "Conservative equation bounds from TMDE specification limits" : "Combined TMDE specification limits"};
  } catch(error) { return {low:null,high:null,span:null,entries,reason:error.message}; }
}
