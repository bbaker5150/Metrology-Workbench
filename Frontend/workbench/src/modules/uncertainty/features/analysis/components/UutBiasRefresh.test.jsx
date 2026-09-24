import { expect, it } from "vitest";
import { findUpdatedUutToleranceForPoint } from "./UncertaintyPanel";
import { computePointRiskMetrics } from "../../../utils/riskCompute";
import { biasFixture } from "../../../utils/measurementBias.fixtures";

it("refreshes unopened UUT points without restoring a legacy resolution budget setting", () => {
  const { point, session } = biasFixture();
  const original = { id: "uut", instrument: { ranges: [{ id: "range", min: 0, max: 20, unit: "A",
    resolution: ".01", resolutionUnit: "V", includeResolutionInBudget: true, tolerances: point.uutTolerance }] } };
  const updated = structuredClone(original);
  updated.instrument.ranges[0].tolerances.bias = { value: ".2", unit: "A" };
  session.uuts = [original];
  const points = [1, 2].map(id => ({ ...point, id, activeUutId: "uut", associatedUutIds: ["uut"],
    uutTolerance: { ...point.uutTolerance, rangeId: "range", includeResolutionInBudget: false } }));
  const before = points.map(p => computePointRiskMetrics(p, session));
  session.uuts = [updated];
  for (const [i, p] of points.entries()) {
    const uutTolerance = findUpdatedUutToleranceForPoint(original, updated, p);
    expect(uutTolerance.includeResolutionInBudget).toBe(false);
    expect(uutTolerance.bias.value).toBe(".2");
    const risk = computePointRiskMetrics({ ...p, uutTolerance }, session);
    expect(risk).not.toBeNull();
    expect(risk.pfa).not.toBe(before[i].pfa);
  }
});
