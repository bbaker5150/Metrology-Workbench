import { describe, expect, it } from "vitest";
import {
  applyManualToleranceDistribution,
  createInlineManualComponent,
  getInlineManualDraft,
  normalizeInlineManualComponent,
} from "./manualComponentUtils";

describe("inline manual budget components", () => {
  it("creates a calculation-safe expanded draft in the requested input budget", () => {
    const component = createInlineManualComponent({
      id: "manual-1",
      scope: {
        kind: "input",
        variableType: "Voltage",
        label: "Voltage",
        nominalPoint: { value: 10, unit: "V" },
      },
    });

    expect(component).toMatchObject({
      id: "manual-1",
      value: 0,
      value_native: 0,
      variableType: "Voltage",
      isManual: true,
      isInlineManual: true,
      inlineDraft: true,
      originalInput: {
        inputMode: "tolerance",
        unit: "V",
      },
    });
    expect(Number.isFinite(component.value)).toBe(true);
  });

  it("normalizes a tolerance limit through its distribution divisor", () => {
    const component = createInlineManualComponent({
      id: "manual-2",
      referencePoint: { value: 10, unit: "V" },
    });
    const normalized = normalizeInlineManualComponent({
      component,
      referencePoint: { value: 10, unit: "V" },
      draft: {
        ...getInlineManualDraft(component),
        name: "Thermal drift",
        toleranceLimit: "1",
        errorDistributionDivisor: "1.732",
        unit: "V",
      },
    });

    expect(normalized.name).toBe("Thermal drift");
    expect(normalized.distribution).toMatch(/Rectangular/i);
    expect(normalized.value).toBeCloseTo(100000 / Math.sqrt(3), 6);
    expect(normalized.value_native).toBeCloseTo(1 / Math.sqrt(3), 10);
    expect(normalized.unit_native).toBe("V");
    expect(normalized.manualRawValue).toBe(1);
    expect(normalized.inlineDraft).toBe(false);
  });

  it("normalizes the same multi-term tolerance shape used by UUT and TMDE rows", () => {
    const component = createInlineManualComponent({
      id: "manual-shaped",
      referencePoint: { value: 10, unit: "V" },
    });
    const tolerance = {
      reading: {
        high: "1",
        low: "-1",
        unit: "%",
        distribution: "1.732",
        symmetric: true,
      },
      range: {
        value: "20",
        high: "0.5",
        low: "-0.5",
        unit: "%",
        distribution: "1.732",
        symmetric: true,
      },
      floor: {
        high: "0.02",
        low: "-0.02",
        unit: "V",
        distribution: "1.732",
        symmetric: true,
      },
    };
    const normalized = normalizeInlineManualComponent({
      component,
      referencePoint: { value: 10, unit: "V" },
      draft: {
        ...getInlineManualDraft(component),
        name: "Composite specification",
        tolerance,
      },
    });

    const expectedPpm = Math.sqrt(
      (10000 / Math.sqrt(3)) ** 2 +
        (10000 / Math.sqrt(3)) ** 2 +
        (2000 / Math.sqrt(3)) ** 2,
    );
    expect(normalized.value).toBeCloseTo(expectedPpm, 5);
    expect(normalized.value_native).toBeCloseTo(
      (expectedPpm / 1e6) * 10,
      10,
    );
    expect(normalized.distribution).toBe("Rectangular");
    expect(normalized.originalInput.tolerance).toEqual(tolerance);
    expect(normalized.inlineValidation).toBeNull();
  });

  it("uses the selected measurement-point value for a manual %IV tolerance", () => {
    const component = createInlineManualComponent({
      id: "manual-iv",
      referencePoint: { value: 20, unit: "V" },
    });
    const tolerance = applyManualToleranceDistribution(
      {
        reading: {
          high: "1",
          low: "-1",
          value: "1",
          unit: "%",
          symmetric: true,
        },
      },
      "1.732",
    );
    const normalized = normalizeInlineManualComponent({
      component,
      referencePoint: { value: 20, unit: "V" },
      draft: {
        ...getInlineManualDraft(component),
        tolerance,
      },
    });

    expect(normalized.value_native).toBeCloseTo(0.2 / Math.sqrt(3), 8);
    expect(normalized.distribution).toBe("Rectangular");
    expect(normalized.inlineValidation).toBeNull();
  });

  it("promotes a legacy scalar tolerance into the canonical inline shape", () => {
    const draft = getInlineManualDraft({
      id: "legacy-manual",
      type: "B",
      manualInputMode: "tolerance",
      originalInput: {
        inputMode: "tolerance",
        toleranceLimit: "0.25",
        unit: "V",
        errorDistributionDivisor: "2.000",
        tolerance: {},
      },
    });

    expect(draft.tolerance).toEqual({
      floor: {
        high: "0.25",
        low: "-0.25",
        unit: "V",
        distribution: "2.000",
        symmetric: true,
      },
    });
  });

  it("keeps an unsupported single-sided error source harmless and explicit", () => {
    const component = createInlineManualComponent({
      id: "manual-single-sided",
      referencePoint: { value: 10, unit: "V" },
    });
    const normalized = normalizeInlineManualComponent({
      component,
      referencePoint: { value: 10, unit: "V" },
      draft: {
        ...getInlineManualDraft(component),
        tolerance: {
          singleSided: {
            direction: "high",
            measurement: "known",
            limit: "11",
            unit: "V",
          },
        },
      },
    });

    expect(normalized.value).toBe(0);
    expect(normalized.value_native).toBe(0);
    expect(normalized.inlineValidation).toMatch(/does not define/i);
  });

  it("accepts a standard uncertainty directly with k=1", () => {
    const component = createInlineManualComponent({
      id: "manual-3",
      referencePoint: { value: 10, unit: "V" },
    });
    const normalized = normalizeInlineManualComponent({
      component,
      referencePoint: { value: 10, unit: "V" },
      draft: {
        ...getInlineManualDraft(component),
        name: "Known standard uncertainty",
        inputMode: "standard",
        standardUncertainty: "0.25",
        unit: "V",
      },
    });

    expect(normalized.distribution).toBe("Standard uncertainty (k=1)");
    expect(normalized.distributionDivisor).toBe("1");
    expect(normalized.value).toBeCloseTo(25000, 8);
    expect(normalized.value_native).toBeCloseTo(0.25, 12);
    expect(normalized.originalInput.inputMode).toBe("standard");
  });

  it("keeps incomplete or non-convertible drafts harmless to budget math", () => {
    const component = createInlineManualComponent({
      id: "manual-4",
      referencePoint: { value: "", unit: "V" },
    });
    const normalized = normalizeInlineManualComponent({
      component,
      referencePoint: { value: "", unit: "V" },
      draft: {
        ...getInlineManualDraft(component),
        toleranceLimit: "1",
        unit: "A",
      },
    });

    expect(normalized.value).toBe(0);
    expect(normalized.value_native).toBe(0);
    expect(normalized.inlineValidation).toBeTruthy();
    expect(Number.isFinite(normalized.value)).toBe(true);
  });
});
