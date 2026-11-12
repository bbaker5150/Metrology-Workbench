import { describe, it, expect, vi } from "vitest";
import { choosePointRange, getPointUutRanges } from "./pointUutRange";
import { getAbsoluteLimits } from "./uncertaintyMath";
import { syncPointTolerances } from "./pointToleranceSync";
import { editQualifierRange } from "./qualifierRanges";
import { computePointRiskMetrics } from "./riskCompute";
const range = (id, unit, high) => ({ id, unit, min: 0, max: 10, tolerances: { floor: { high, low: -high, unit } } });
const uut = ranges => ({ id: "u", instrument: { functions: [{ id: "f", name: "Electrical", ranges }] } });
const point = (id, unit, source) => ({ id, associatedUutIds: ["u"], testPointInfo: { parameter: { value: 5, unit } }, uutTolerance: source });
describe("live UUT tolerance snapshots", () => {
  it.each([false, true])('preserves an imported budget when adding and naming a qualifier (explicit=%s)', explicit => {
    const instrument = uut([range('v', 'V', 1)]);
    const saved = getPointUutRanges(instrument)[0];
    let session = JSON.parse(JSON.stringify({ uuts: [instrument], tmdes: [],
      uncReq: { reliability: 95, reqPFA: 2, uncertaintyConfidence: 95, neededTUR: 4 },
      testPoints: [{ ...point('p', 'V', explicit ? choosePointRange(saved) : saved), measurementType: 'direct',
        tmdeTolerances: [{ id: 'tmde', floor: { high: .1, low: -.1, unit: 'V', distribution: '1.732' } }], components: [] }],
    }));
    const originalRisk = computePointRiskMetrics(session.testPoints[0], session);
    expect(originalRisk?.tur).toBeGreaterThan(0);
    for (const [action, patch] of [['enable', {}], ['patch', { text: 'Operating mode A' }]]) {
      const updated = editQualifierRange(session.uuts[0], 'v', action, patch).item;
      session = syncPointTolerances({ ...session, uuts: [updated] }, session);
      expect(session.testPoints[0].uutTolerance).toMatchObject({ rangeId: 'v', tolerances: { floor: { high: 1 } } });
      if (explicit) expect(session.testPoints[0].uutTolerance.rangeSelection).toBe('explicit');
      const risk = computePointRiskMetrics(session.testPoints[0], session);
      for (const key of ['tur', 'pfa', 'pfr']) expect(risk?.[key]).toBeCloseTo(originalRisk[key]);
    }
    const edited = structuredClone(session);
    edited.testPoints[0].testPointInfo.qualifier = { value: 'Different mode' };
    expect(syncPointTolerances(edited, session).testPoints[0].uutTolerance).toBeNull();
    const outOfRange = structuredClone(session);
    outOfRange.testPoints[0].testPointInfo.parameter.value = 20;
    expect(syncPointTolerances(outOfRange, session).testPoints[0].uutTolerance).toBeNull();
  });

  it('rejects an edited qualifier that conflicts with the value already supplied on the point', () => {
    const instrument = uut([{ ...range('v', 'V', 1), qualifierGroupId: 'q', qualifier: { text: 'A' } }]);
    const selected = { ...point('p', 'V', choosePointRange(getPointUutRanges(instrument)[0])),
      testPointInfo: { parameter: { value: 5, unit: 'V' }, qualifier: { value: 'A' } } };
    const before = { uuts: [instrument], testPoints: [selected] };
    const changed = editQualifierRange(instrument, 'v', 'patch', { text: 'B' }).item;
    expect(syncPointTolerances({ ...before, uuts: [changed] }, before).testPoints[0].uutTolerance).toBeNull();
  });

  it("does not serialize unchanged instrument definitions for point edits or copied collections", () => {
    const before = { uuts: [uut([range("v", "V", 1)])], tmdes: [{ id: "tmde", instrument: { functions: [] } }], testPoints: [point(1, "V", null)] };
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      const pointEdit = { ...before, testPoints: [{ ...before.testPoints[0], section: "Changed" }] };
      expect(syncPointTolerances(pointEdit, before)).toBe(pointEdit);
      const copiedCollections = { ...pointEdit, uuts: [...before.uuts], tmdes: [...before.tmdes] };
      expect(syncPointTolerances(copiedCollections, before)).toBe(copiedCollections);
      expect(stringify).not.toHaveBeenCalled();
    } finally { stringify.mockRestore(); }
  });

  it("refreshes all matching points and fills absent tolerances while preserving other units and manual specifications", () => {
    const before = { uuts: [uut([range("v", "V", 1), range("a", "A", 2)])], testPoints: [
      point(1, "V", { rangeId: "v", includeResolutionInBudget: false }),
      point(2, "V", null), point(3, "A", { rangeId: "a" }),
      point(4, "V", { floor: { high: 7, unit: "V" } }),
    ] };
    const after = syncPointTolerances({ ...before, uuts: [uut([range("v", "V", 3), range("a", "A", 2)])] }, before);
    expect(after.testPoints[0].uutTolerance.tolerances.floor.high).toBe(3);
    expect(after.testPoints[0].uutTolerance.includeResolutionInBudget).toBe(false);
    expect(after.testPoints[1].uutTolerance.tolerances.floor.high).toBe(3);
    expect(after.testPoints[2].uutTolerance.tolerances.floor.high).toBe(2);
    expect(after.testPoints[3]).toBe(before.testPoints[3]);
    expect(syncPointTolerances(after, after)).toBe(after);
  });
  it("clears removed source ranges rather than keeping stale tolerances or selecting another unit", () => {
    const before = { uuts: [uut([range("v", "V", 1)])], testPoints: [point(1, "V", { rangeId: "v" })] };
    const after = syncPointTolerances({ ...before, uuts: [uut([range("a", "A", 2)])] }, before);
    expect(after.testPoints[0].uutTolerance).toBeNull();
  });
});

it("keeps mass and acceleration separate", () => {
  const before = { uuts: [uut([range("mass", "g", 1)])], testPoints: [point(1, "g", null)] };
  const after = syncPointTolerances({ ...before, uuts: [uut([range("gravity", "G_accel", 4), range("mass", "g", 2)])] }, before);
  expect(after.testPoints[0].uutTolerance.rangeId).toBe("mass");
});

it("does not select empty editor drafts as unlimited ranges", () => {
  const before = { uuts: [uut([range("v", "V", 1)])], testPoints: [point(1, "V", {rangeId:"v"}), point(2,"V",null)] };
  const draft = {id:"draft",unit:"V",min:"",max:"",tolerances:{floor:{high:"",low:"",unit:"V"}}};
  const after = syncPointTolerances({...before,uuts:[uut([draft,range("v","V",1)])]},before);
  expect(after.testPoints.map(p=>p.uutTolerance.rangeId)).toEqual(["v","v"]);
  const unbounded = {...draft,tolerances:{floor:{high:2,low:-2,unit:"V"}}};
  const withSpec = syncPointTolerances({...before,uuts:[uut([unbounded])]},before);
  expect(withSpec.testPoints[0].uutTolerance.rangeId).toBe("draft");
});

it("retains an explicitly selected range across bias edits for prefixed or conflicting point units", () => {
  const original = uut([range("v", "V", 1)]);
  const before = { uuts: [original], testPoints: [point(1, "mV", { rangeId: "v" }), point(2, "A", { rangeId: "v" })] };
  const edited = structuredClone(original);
  edited.instrument.functions[0].ranges[0].tolerances.bias = { value: .1, unit: "V" };
  const after = syncPointTolerances({ ...before, uuts: [edited] }, before);
  for (const p of after.testPoints) {
    expect(p.uutTolerance.rangeId).toBe("v");
    expect(p.uutTolerance.tolerances.bias.value).toBe(.1);
    expect(p.uutTolerance.includeResolutionInBudget).toBe(false);
  }
});

it("requires a point-specific choice for overlapping ranges and keeps that choice through edits and reload", () => {
  const narrow = { ...range("15", "psig", 2), max: 15 };
  const wide = { ...range("100", "psig", 5), max: 100 };
  const instrument = uut([narrow, wide]);
  const first = point(1, "psig", { rangeId: "15" });
  first.testPointInfo.parameter.value = 10;
  const legacy = { uuts: [instrument], testPoints: [first, { ...first, id: 2, uutTolerance: null }] };
  const reopened = syncPointTolerances(legacy);
  for (const p of reopened.testPoints) {
    expect(p.uutTolerance).toEqual({ rangeSelection: "required" });
    expect(getAbsoluteLimits(p.uutTolerance, p.testPointInfo.parameter)).toMatchObject({ low: "N/A", high: "N/A" });
  }
  const selected = { ...reopened, testPoints: reopened.testPoints.map((p, i) => i ? p : {
    ...p, uutTolerance: choosePointRange(getPointUutRanges(instrument)[1]),
  }) };
  const reordered = syncPointTolerances({ ...selected, uuts: [uut([wide, { ...narrow, tolerances: { floor: { high: 3, unit: "psig" } } }])] }, selected);
  const restored = syncPointTolerances(JSON.parse(JSON.stringify(reordered)));
  expect(restored.testPoints[0].uutTolerance).toMatchObject({ rangeId: "100", rangeSelection: "explicit", tolerances: { floor: { high: 5 } } });
  expect(restored.testPoints[1].uutTolerance).toEqual({ rangeSelection: "required" });
  const changed = syncPointTolerances({ ...restored, testPoints: restored.testPoints.map(p => ({
    ...p, testPointInfo: { parameter: { value: 60, unit: "psig" } },
  })) }, restored);
  expect(changed.testPoints[1].uutTolerance.rangeId).toBe("100");
});
