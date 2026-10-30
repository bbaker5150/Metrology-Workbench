import { expect, it } from "vitest";
import { resolvePointBudgetComponents } from "./resolvePointBudgetComponents";
import { computePointTmdeLimits } from "./pointTmdeLimits";
import { resolutionRange } from "./pointLimitDisplay";
import { getBudgetRangeWarnings } from "./pointDiagnostics";
import { resolveTmdeTransferComponent } from "./tmdeTransferComponent";

function fixture(size) {
  let reads = 0;
  const ranges = Array.from({ length: size }, (_, i) => ({
    id: `r${i}`, min: 0, max: 10, unit: "V",
    get resolution() { reads++; return .01; },
    tolerances: { floor: { high: 1, low: -1, unit: "V", distribution: "1.732" } },
  }));
  const master = { id: "meter", name: "Meter", instrument: { functions: [{ id: "f", unit: "V", ranges }] } };
  const nominal = { value: 5, unit: "V" };
  const point = { measurementType: "direct", testPointInfo: { parameter: nominal }, components: [{
    id: "c", type: "B", isBudgetInstance: true, tmdeBudgetSourceId: "meter", tmdeBudgetRangeId: "r0",
    tmdeBudgetFunctionId: "f", tmdeBudgetComponentKind: "Accuracy",
  }] };
  return { master, nominal, point, session: { tmdes: [master] }, reads: () => reads };
}

it("resolves selected budget rows, limits and transfer sources without normalizing unrelated specifications", () => {
  const large = fixture(2000);
  const small = fixture(1);
  const evaluate = ({ point, session, master, nominal }) => ({
    components: resolvePointBudgetComponents(point, session),
    limits: computePointTmdeLimits(point, session),
    range: resolutionRange(master, { rangeId: "r0", functionId: "f" }, nominal),
    warnings: getBudgetRangeWarnings({ components: point.components, directNominal: nominal, tmdes: session.tmdes }),
    transfer: resolveTmdeTransferComponent({ tmdeTransferSources: [{ sourceId: "meter", rangeId: "r0", functionId: "f",
      nominal, sensitivity: 2, role: "reader", direction: "forward" }] }, session, nominal),
  });
  const expected = evaluate(small);
  expect(evaluate(large)).toEqual(expected);
  expect(large.reads()).toBe(small.reads());
  expect(large.reads()).toBeLessThan(20);
  large.master.instrument.functions[0].ranges[0].tolerances.floor.high = 2;
  expect(evaluate(large).limits.high).toBe(7);
});

it("keeps nominal-based fallback and function tie-breaking for selected resolution ranges", () => {
  const master = { functions: [
    { id: "a", unit: "V", ranges: [{ id: "same", min: 0, max: 1, resolution: .001 }] },
    { id: "b", unit: "V", ranges: [{ id: "same", min: 0, max: 1, resolution: .002 }, { id: "large", min: 1, max: 10, resolution: .1 }] },
  ] };
  const selection = { rangeId: "same", functionId: "b" };
  expect(resolutionRange(master, selection, { value: .5, unit: "V" }).resolution).toBe(.002);
  expect(resolutionRange(master, selection, { value: 5, unit: "V" }).resolution).toBe(.1);
  expect(resolutionRange(master, selection, { value: 50, unit: "V" })).toEqual({});
  expect(resolutionRange(master, selection, { value: "", unit: "V" }).resolution).toBe(.002);
  expect(resolutionRange(master, { rangeId: "missing" }, { value: .5, unit: "V" }).resolution).toBe(.001);
  expect(resolutionRange(master, selection, { value: .5, unit: "A" })).toEqual({});
});
