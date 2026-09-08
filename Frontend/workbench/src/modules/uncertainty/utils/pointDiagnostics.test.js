import { describe, expect, it } from "vitest";
import {
  getBudgetRangeWarnings,
  getPointDiagnostics,
} from "./pointDiagnostics";

const session = { uncReq: { reliability: 95, reqPFA: 2 } };
const point = {
  testPointInfo: { parameter: { value: 5, unit: "V" } },
  uutTolerance: {
    floor: {
      high: 1,
      low: -1,
      unit: "V",
      symmetric: true,
      distribution: "1.732",
    },
  },
  components: [{ id: "manual", name: "Repeatability", value: 100, dof: 9 }],
};
const source = {
  id: "accuracy",
  name: "DMM accuracy",
  isBudgetInstance: true,
  tmdeBudgetRangeId: "r",
  tmdeBudgetRange: { min: 10, max: 20, unit: "V" },
  value: 10,
};

describe("point diagnostics", () => {
  it("evaluates legacy derived source tolerances in their input units", () => {
    const legacy = {
      ...point,
      testPointInfo: { parameter: { value: 10, unit: "W" } },
      uutTolerance: { floor: { high: 1, low: -1, unit: "W", symmetric: true } },
      measurementType: "derived",
      equationString: "x * y",
      variableMappings: { x: "Voltage", y: "Current" },
      components: [],
      tmdeTolerances: [
        {
          id: "v",
          variableType: "Voltage",
          measurementPoint: { value: 5, unit: "V" },
          tolerance: {
            floor: {
              high: 0.01,
              low: -0.01,
              unit: "V",
              symmetric: true,
              distribution: "1.732",
            },
          },
        },
        {
          id: "i",
          variableType: "Current",
          measurementPoint: { value: 2, unit: "A" },
          tolerance: {
            floor: {
              high: 0.01,
              low: -0.01,
              unit: "A",
              symmetric: true,
              distribution: "1.732",
            },
          },
        },
      ],
    };
    expect(getPointDiagnostics(legacy, session)).toEqual([]);
  });

  it("identifies the nominal and exact range and includes every offending source", () => {
    const warnings = getBudgetRangeWarnings({
      components: [source, { ...source, id: "second" }],
      directNominal: { value: 5, unit: "V" },
    });
    expect(warnings.final).toHaveLength(2);
    expect(warnings.final[0].reason).toContain(
      "Measurement Point 5 V does not fall within error source range: 10 to 20 V.",
    );
    expect(
      getPointDiagnostics({ ...point, components: [source] }, session).join(
        " ",
      ),
    ).toContain("DMM accuracy: Measurement Point 5 V");
  });
  it("converts unit prefixes and accepts zero and inclusive range boundaries", () => {
    for (const value of [0, 1000])
      expect(
        getBudgetRangeWarnings({
          components: [
            { ...source, tmdeBudgetRange: { min: 0, max: 1, unit: "V" } },
          ],
          directNominal: { value, unit: "mV" },
        }),
      ).toEqual({});
  });
  it("uses a derived input's nominal, not the output nominal", () => {
    const warnings = getBudgetRangeWarnings({
      components: [{ ...source, variableType: "Voltage" }],
      measurementType: "derived",
      directNominal: { value: 15, unit: "W" },
      groups: [
        {
          kind: "input",
          variableType: "Voltage",
          nominalPoint: { value: 5, unit: "V" },
        },
      ],
    });
    expect(warnings.Voltage[0].reason).toContain("Equation input Voltage 5 V");
  });
  it("reports missing equation values and empty budgets together", () => {
    const messages = getPointDiagnostics(
      {
        ...point,
        measurementType: "derived",
        equationString: "a * b",
        variableMappings: { a: "Voltage", b: "Current" },
        variableNominals: { a: { value: 5, unit: "V" } },
        components: [],
      },
      session,
    );
    expect(messages.join(" ")).toContain("nominal value and unit");
    expect(messages.join(" ")).toContain("Current");
    expect(messages.join(" ")).toContain("No error sources");
  });
  it("flags a derived result that differs from the point and clears it after correction", () => {
    const derived = {
      ...point,
      measurementType: "derived",
      equationString: "a * b",
      variableMappings: { a: "Voltage", b: "Current" },
      variableNominals: {
        a: { value: 5, unit: "V" },
        b: { value: 2, unit: "A" },
      },
      testPointInfo: { parameter: { value: 12, unit: "W" } },
    };
    expect(getPointDiagnostics(derived, session).join(" ")).toContain(
      "Equation result 10 W does not equal Measurement Point 12 W",
    );
    expect(
      getPointDiagnostics(
        { ...derived, testPointInfo: { parameter: { value: 10, unit: "W" } } },
        session,
      ).join(" "),
    ).not.toContain("does not equal");
  });
  it("explains incompatible equation units", () => {
    const derived = {
      ...point,
      measurementType: "derived",
      equationString: "a * b",
      variableMappings: { a: "Voltage", b: "Current" },
      variableNominals: {
        a: { value: 5, unit: "V" },
        b: { value: 2, unit: "A" },
      },
    };
    expect(getPointDiagnostics(derived, session).join(" ")).toContain(
      "Unit mismatch",
    );
  });
  it("does not warn for a complete direct budget", () => {
    expect(getPointDiagnostics(point, session)).toEqual([]);
  });
  it("explains bad limits and session settings without hiding other warnings", () => {
    const messages = getPointDiagnostics(
      { ...point, uutTolerance: {}, components: [] },
      { uncReq: { reliability: 100 } },
    );
    expect(messages.join(" ")).toContain("No error sources");
    expect(messages.join(" ")).toContain("distinct lower and upper limits");
    expect(messages.join(" ")).toContain("REOP Required");
  });
  it("accepts PFA-only unknown-measurement cases without demanding two limits or REOP", () => {
    const unknown = {
      ...point,
      uutTolerance: {
        singleSided: { measurement: "unknown", direction: "high", limit: 10 },
      },
    };
    expect(getPointDiagnostics(unknown, { uncReq: { reqPFA: 2 } })).toEqual([]);
  });
});
