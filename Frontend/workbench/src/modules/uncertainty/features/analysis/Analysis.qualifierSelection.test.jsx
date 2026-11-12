import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Analysis from "./Analysis";
import { useUncertaintyCalculation } from "./hooks/useUncertaintyCalculation";
import { choosePointRange, getPointUutRanges } from "../../utils/pointUutRange";

vi.mock("plotly.js-dist", () => ({ default: {} }));
vi.mock("./hooks/useUncertaintyCalculation", () => ({
  useUncertaintyCalculation: vi.fn(() => ({ calcResults: null, calculationError: null })),
}));
vi.mock("./hooks/useRiskCalculation", () => ({
  useRiskCalculation: () => ({ riskResults: null, riskInputs: {}, notification: null }),
}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

it.each([
  { scenario: "a missing parameter qualifier" },
  { scenario: "a stale parameter qualifier", parameterQualifier: { value: "AC", qualifier: { value: "90 days" } } },
  { scenario: "duplicate qualifier paths with distinct specification IDs", firstInterval: "1 year" },
])(
  "keeps the explicitly selected second nested leaf when opening a point with $scenario",
  async ({ parameterQualifier, firstInterval = "90 days" }) => {
    const uut = { id: "uut", description: "Qualified meter", instrument: {
      id: "definition", functions: [{ id: "voltage", name: "Voltage", unit: "V", ranges: [
        { id: "first", min: 0, max: 10, unit: "V", qualifierGroupId: "ac",
          qualifier: { text: "AC", qualifier: { text: firstInterval } },
          tolerances: { floor: { high: .1, low: -.1, unit: "V" } } },
        { id: "second", min: 0, max: 10, unit: "V", qualifierGroupId: "ac",
          qualifier: { text: "AC", qualifier: { text: "1 year" } },
          tolerances: { floor: { high: .4, low: -.4, unit: "V" } } },
      ] }],
    } };
    const qualifier = { value: "AC", qualifier: { value: "1 year" } };
    const point = { id: "point", viewMode: "point", measurementType: "direct", associatedUutIds: [uut.id],
      activeUutId: uut.id, components: [], tmdeTolerances: [],
      testPointInfo: { parameter: { name: "Voltage", value: 5, unit: "V", ...(parameterQualifier && { qualifier: parameterQualifier }) }, qualifier },
      uutTolerance: choosePointRange(getPointUutRanges(uut)[1], { includeResolutionInBudget: true }),
    };
    const save = vi.fn();
    render(<Analysis sessionData={{ id: "session", name: "Qualified session", uuts: [uut], tmdes: [], testPoints: [point], uncReq: {} }}
      testPointData={point} defaultTestPoint={{}} instruments={[]} onDataSave={save}
      preferredAnalysisMode="uncertaintyTool" />);
    await waitFor(() => expect(document.querySelector('[data-tour="uut-table"]')).toBeInTheDocument());
    const toleranceWrites = save.mock.calls.map(([patch]) => patch.uutTolerance).filter(Boolean);
    for (const tolerance of toleranceWrites) {
      expect(tolerance).toMatchObject({ rangeId: "second", rangeSelection: "explicit", includeResolutionInBudget: true,
        qualifier: { text: "AC", qualifier: { text: "1 year" } }, floor: { high: .4, low: -.4 } });
    }
    expect(useUncertaintyCalculation.mock.calls.at(-1)[4]).toMatchObject({ value: 5, unit: "V", qualifier });
    expect(point.uutTolerance.rangeId).toBe("second");
    expect(point.testPointInfo.qualifier).toBe(qualifier);
  },
);
