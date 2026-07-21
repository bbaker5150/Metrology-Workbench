import { describe, expect, it } from "vitest";
import {
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
