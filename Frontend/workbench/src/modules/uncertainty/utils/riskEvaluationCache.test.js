import { expect, it, vi } from "vitest";
import { createRiskEvaluationCache } from "./riskEvaluationCache";
import { computeRiskEvaluationMap } from "./riskCompute";

const point = id => ({ id, measurementType: "direct", testPointInfo: { parameter: { value: 10, unit: "V" } },
  uutTolerance: { floor: { high: 1, low: -1, unit: "V", symmetric: true, distribution: "1.732" } },
  components: [{ id: "repeatability", type: "A", name: "Repeatability", value: 20, unit: "ppm", dof: 9 }], tmdeTolerances: [] });
const requirements = { reliability: 85, measRelCalcAssumed: 90, reqPFA: 2, neededTUR: 4, uncertaintyConfidence: 95, calInt: 12 };

it("reuses unchanged point calculations while edits, removals and shared changes match a fresh evaluation", () => {
  const evaluate = vi.fn(computeRiskEvaluationMap), cached = createRiskEvaluationCache(evaluate);
  let points = [point("a"), point("b"), point("c")];
  let session = { id: 1, testPoints: points, uncReq: requirements, tmdes: [], uuts: [] };
  const check = (expectedCalls, guardband = false) => {
    evaluate.mockClear();
    const result = cached(points, session, guardband);
    expect(result).toEqual(computeRiskEvaluationMap(points, session, guardband));
    expect(evaluate).toHaveBeenCalledTimes(expectedCalls);
  };
  check(3);
  check(0);
  points = [points[0], { ...points[1], components: [{ ...points[1].components[0], value: 40 }] }, points[2]];
  session = { ...session, testPoints: points };
  check(1);
  session = { ...session, uncReq: { ...requirements, uncertaintyConfidence: 99 } };
  check(3);
  session = { ...session, tmdes: [{ id: "new-standard" }] };
  check(3);
  session = { ...session, dynamicBudgetDefinitions: [] };
  check(3);
  check(3, true);
  points = points.slice(0, 2);
  session = { ...session, testPoints: points };
  check(0, true);
  session = { ...session, id: 2 };
  check(2, true);
});
