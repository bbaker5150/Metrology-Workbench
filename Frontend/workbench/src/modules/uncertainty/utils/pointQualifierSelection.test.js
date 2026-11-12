import { describe, expect, it } from "vitest";
import { getPointQualifierChoices, normalizeSelectedQualifier, validatePointQualifierChoice, applyPointQualifierChoice, formatPointQualifierSelection } from "./pointQualifierSelection";
import { getPointUutRanges, resolvePointRange } from "./pointUutRange";
import { getAbsoluteLimits } from "./uncertaintyMath";
import { syncPointTolerances } from "./pointToleranceSync";

const leaf = (id, qualifier, error = 1) => ({ id, min: 0, max: 100, unit: "V", qualifierGroupId: "voltage", qualifier,
  tolerances: { floor: { high: error, low: -error, unit: "V" } } });
const instrument = ranges => ({ id: "uut", instrument: { qualifierColumnNames: ["Frequency", "Interval"],
  functions: [{ id: "voltage", name: "Voltage", unit: "V", ranges }] } });
const nominal = { parameter: { value: 50, unit: "V" } };

describe("point qualifier choices", () => {
  it("offers alternative primary-compatible leaves even with no or a conflicting current qualifier", () => {
    const uut = instrument([leaf("ten", { text: "10 Hz" }, 1), leaf("hundred", { text: "100 Hz" }, 2),
      { ...leaf("out", { text: "1000 Hz" }), min: 60 }, { ...leaf("other-unit", { text: "10 Hz" }), unit: "A" }]);
    const choices = getPointQualifierChoices(uut, nominal);
    expect(choices.map(choice => choice.range.rangeId)).toEqual(["ten", "hundred"]);
    expect(choices.map(choice => choice.summary)).toEqual(["±1.00 V", "±2.00 V"]);
    expect(choices[0]).toMatchObject({ functionName: "Voltage", path: [{ name: "Frequency", label: "10 Hz" }] });
    expect(getPointQualifierChoices(uut, { ...nominal, qualifier: { value: "Unrelated" } })).toEqual(choices);
    expect(getPointQualifierChoices(uut, { parameter: { value: 50000, unit: "mV" } }).map(choice => choice.key)).toEqual(choices.map(choice => choice.key));
    expect(getPointQualifierChoices(uut, { parameter: { value: "", unit: "V" } })).toEqual([]);
  });

  it("distinguishes identical qualifier paths across functions and retains leaf identities after reorder", () => {
    const uut = instrument([leaf("first", { text: "10 Hz" }), leaf("second", { text: "10 Hz" }, 2)]);
    uut.instrument.functions.push({ id: "other-function", name: "Other", ranges: [leaf("first", { text: "10 Hz" })] });
    const choices = getPointQualifierChoices(uut, nominal);
    expect(new Set(choices.map(choice => choice.key)).size).toBe(3);
    const reordered = structuredClone(uut);
    reordered.instrument.functions[0].ranges.reverse();
    expect(getPointQualifierChoices(reordered, nominal).map(choice => choice.key)).toEqual([choices[1].key, choices[0].key, choices[2].key]);
  });

  it("filters single-value primary ranges by their exact value", () => {
    const uut = instrument([{ ...leaf("single", { text: "Mode A" }), min: "", max: "", isSingleValue: true, value: 50 }]);
    expect(getPointQualifierChoices(uut, nominal)).toHaveLength(1);
    expect(getPointQualifierChoices(uut, { parameter: { value: 49, unit: "V" } })).toEqual([]);
  });

  it("uses visible qualifier headings and keeps nested labels distinct", () => {
    const uut = instrument([leaf("first", { name: "Old name", text: "100 Hz", qualifier: { text: "24 months" } }),
      leaf("second", { text: "100 Hz", qualifier: { text: "60 months" } })]);
    const choices = getPointQualifierChoices(uut, nominal);
    expect(choices[0].path.map(node => node.name)).toEqual(["Frequency", "Interval"]);
    const labels = choices.map(choice => formatPointQualifierSelection(normalizeSelectedQualifier(choice.range.qualifier)));
    expect(labels).toEqual(["100 Hz › 24 months", "100 Hz › 60 months"]);
  });
});

describe("point qualifier values and selected specifications", () => {
  it("normalizes text and singular numeric qualifiers without retaining obsolete child values or duplicate units", () => {
    const old = { value: 7, unit: "Hz", qualifier: { value: "Old child" } };
    expect(normalizeSelectedQualifier({ text: "DC mode", unit: "Hz" }, old)).toEqual({ name: "Qualifier", value: "DC mode", unit: "" });
    expect(normalizeSelectedQualifier({ name: "Frequency", value: 1000, unit: "Hz" })).toMatchObject({ name: "Frequency", value: 1000, min: 1000, max: 1000, unit: "Hz", isSingleValue: true });
    expect(normalizeSelectedQualifier({ min: 0, max: 0, unit: "Hz" })).toMatchObject({ value: 0, isSingleValue: true });
    expect(old.qualifier.value).toBe("Old child");
  });

  it("requires an actual in-band numeric value, preserving equivalent units without inventing one", () => {
    const range = leaf("band", { min: 10, max: 100, unit: "Hz", qualifier: { text: "24 months" } });
    const blank = normalizeSelectedQualifier(range.qualifier);
    expect(blank.value).toBe("");
    expect(blank.qualifier.value).toBe("24 months");
    expect(validatePointQualifierChoice({ range }, blank).compatible).toBe(false);
    expect(normalizeSelectedQualifier(range.qualifier, { value: 200, unit: "Hz" }).value).toBe("");
    const selected = normalizeSelectedQualifier(range.qualifier, { value: 0.05, unit: "kHz" });
    expect(selected).toMatchObject({ value: 0.05, unit: "kHz", min: 0.01, max: 0.1 });
    expect(validatePointQualifierChoice({ range }, selected)).toEqual({ compatible: true, reason: "" });
    expect(validatePointQualifierChoice({ range }, { ...selected, qualifier: { value: "60 months" } }).compatible).toBe(false);
  });

  it("atomically applies one nested leaf and survives point resolution, recalculation inputs, and session reload", () => {
    const uut = instrument([leaf("first", { text: "100 Hz", qualifier: { text: "24 months" } }, 1),
      leaf("second", { text: "100 Hz", qualifier: { text: "60 months" } }, 2)]);
    const oldQualifier = { value: "Old", qualifier: { value: "Old child" } };
    const point = { id: "p", associatedUutIds: ["uut"], testPointInfo: { ...nominal, qualifier: oldQualifier,
      parameter: { ...nominal.parameter, qualifier: oldQualifier } }, uutTolerance: { includeResolutionInBudget: true },
      components: [{ id: "custom" }], section: "Section" };
    const sibling = { ...point, id: "sibling" };
    const choice = getPointQualifierChoices(uut, nominal)[1];
    const selected = applyPointQualifierChoice(point, choice);
    expect(selected.testPointInfo.parameter.qualifier).toBe(selected.testPointInfo.qualifier);
    expect(selected.uutTolerance).toMatchObject({ rangeId: "second", rangeSelection: "explicit", includeResolutionInBudget: true });
    expect(selected.components).toBe(point.components);
    const resolved = resolvePointRange(getPointUutRanges(uut), selected.testPointInfo, selected.uutTolerance);
    expect(resolved.rangeId).toBe("second");
    expect(getAbsoluteLimits(resolved, selected.testPointInfo.parameter, { snap: false })).toMatchObject({ low: "48.00000 V", high: "52.00000 V" });
    const before = { uuts: [uut], testPoints: [point, sibling] };
    const saved = syncPointTolerances({ ...before, testPoints: [selected, sibling] }, before);
    expect(saved.testPoints[1]).toBe(sibling);
    expect(syncPointTolerances(JSON.parse(JSON.stringify(saved))).testPoints[0].uutTolerance.rangeId).toBe("second");
    expect(point.testPointInfo.qualifier).toBe(oldQualifier);
  });

  it("supplies the qualifier to parameter-based calculation consumers for modern points", () => {
    const uut = instrument([leaf("first", { text: "100 Hz" })]);
    const selected = applyPointQualifierChoice({ id: "p", testPointInfo: nominal }, getPointQualifierChoices(uut, nominal)[0]);
    expect(selected.testPointInfo.parameter.qualifier).toBe(selected.testPointInfo.qualifier);
    expect(nominal.parameter.qualifier).toBeUndefined();
    expect(formatPointQualifierSelection({ value: 0, unit: "Hz" })).toBe("0 Hz");
    expect(formatPointQualifierSelection({ value: "1000 Hz", unit: "Hz" })).toBe("1000 Hz");
    expect(formatPointQualifierSelection({ value: "", unit: "Hz" })).toBe("");
    expect(formatPointQualifierSelection()).toBe("");
  });
});
