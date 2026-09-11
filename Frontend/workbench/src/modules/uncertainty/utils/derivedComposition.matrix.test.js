import { describe, expect, it } from "vitest";
import { calculateDerivedUncertainty } from "./uncertaintyMath";
import { computePointRiskMetrics } from "./riskCompute";

// ===========================================================================
// Derived multi-TMDE composition matrix.
//
// When N TMDEs map to ONE equation variable, the variable is the ADDITIVE
// composition of the pieces (the workbook's torque case: weights summing to a
// load). The metrology oracle is the EQUIVALENCE invariant (§C): that case must
// produce identical nominal / u_c / TUR / TAR / PFA / PFR as the SAME equation
// rewritten with the pieces as separate summed variables — which is the
// multi-variable derived path the BRG-3100 workbook already validates.
//
//   Form X (new):  y = f(a, …)         with TWO TMDEs on variable `a`
//   Form Y (ref):  y = f(a1 + a2, …)   with a1, a2 as independent variables
//
// Exact for additive + independent inputs because ∂y/∂a = ∂y/∂a1 = ∂y/∂a2, so
//   |∂y/∂a|·√(u₁²+u₂²)  ==  √((|∂y/∂a1|·u₁)² + (|∂y/∂a2|·u₂)²).
//
// Units are all to_si = 1 (V, A, W, Ohm, Hz…) so the equation math is identity
// and the first-principles block below can be hand-verified.
// ===========================================================================

const DIST = "1.7320508075688772"; // rectangular, divisor √3

const tmde = (name, type, value, unit, half, halfUnit = unit) => ({
  id: `${name}-${Math.random()}`,
  name,
  variableType: type,
  quantity: 1,
  measurementPoint: { value, unit },
  reading: { high: half, low: -half, unit: halfUnit, distribution: DIST, symmetric: true },
});

const uutTol = (high) => ({
  reading: { high, low: -high, unit: "%", distribution: DIST, symmetric: true },
});

const sessionData = {
  uncReq: {
    uncertaintyConfidence: 95,
    reliability: 85,
    neededTUR: 4,
    reqPFA: 2,
    guardBandMultiplier: 1,
  },
};

const derivedPoint = ({ eq, map, tmdes, resultValue, resultUnit, uutHigh = 2 }) => ({
  id: "p",
  measurementType: "derived",
  equationString: eq,
  variableMappings: map,
  tmdeTolerances: tmdes,
  components: [],
  uutTolerance: uutTol(uutHigh),
  testPointInfo: { parameter: { name: "y", value: String(resultValue), unit: resultUnit } },
});

const unc = (p) =>
  calculateDerivedUncertainty(
    p.equationString,
    p.variableMappings,
    p.tmdeTolerances,
    p.testPointInfo.parameter,
    p.components,
  );

// ---------------------------------------------------------------------------
// §C Equivalence matrix — Form X (2 TMDEs on `a`) vs Form Y (a1 + a2 split)
// ---------------------------------------------------------------------------

// a = 6 + 4 = 10, split into two independent pieces with their own specs.
const A1 = tmde("a1", "A", 6, "V", 0.06);
const A2 = tmde("a2", "A", 4, "V", 0.05);
// Form-Y twins (distinct variableTypes, same numbers/specs).
const A1y = tmde("a1", "A1", 6, "V", 0.06);
const A2y = tmde("a2", "A2", 4, "V", 0.05);

const cases = [
  {
    name: "A1 product  y = a*b",
    x: { eq: "y = a*b", map: { a: "A", b: "B" }, tmdes: [A1, A2, tmde("b", "B", 2, "A", 0.01)], resultValue: 20, resultUnit: "W" },
    y: { eq: "y = (a1+a2)*b", map: { a1: "A1", a2: "A2", b: "B" }, tmdes: [A1y, A2y, tmde("b", "B", 2, "A", 0.01)], resultValue: 20, resultUnit: "W" },
  },
  {
    name: "A2 quotient numerator  y = a/b",
    x: { eq: "y = a/b", map: { a: "A", b: "B" }, tmdes: [A1, A2, tmde("b", "B", 2, "A", 0.01)], resultValue: 5, resultUnit: "Ohm" },
    y: { eq: "y = (a1+a2)/b", map: { a1: "A1", a2: "A2", b: "B" }, tmdes: [A1y, A2y, tmde("b", "B", 2, "A", 0.01)], resultValue: 5, resultUnit: "Ohm" },
  },
  {
    name: "A2 quotient denominator  y = c/a",
    x: { eq: "y = c/a", map: { c: "C", a: "A" }, tmdes: [tmde("c", "C", 50, "V", 0.1), A1, A2], resultValue: 5, resultUnit: "Ohm" },
    y: { eq: "y = c/(a1+a2)", map: { c: "C", a1: "A1", a2: "A2" }, tmdes: [tmde("c", "C", 50, "V", 0.1), A1y, A2y], resultValue: 5, resultUnit: "Ohm" },
  },
  {
    name: "A3 sum  y = a+b",
    x: { eq: "y = a+b", map: { a: "A", b: "B" }, tmdes: [A1, A2, tmde("b", "B", 3, "V", 0.02)], resultValue: 13, resultUnit: "V" },
    y: { eq: "y = a1+a2+b", map: { a1: "A1", a2: "A2", b: "B" }, tmdes: [A1y, A2y, tmde("b", "B", 3, "V", 0.02)], resultValue: 13, resultUnit: "V" },
  },
  {
    name: "A4 difference  y = a-b",
    x: { eq: "y = a-b", map: { a: "A", b: "B" }, tmdes: [A1, A2, tmde("b", "B", 3, "V", 0.02)], resultValue: 7, resultUnit: "V" },
    y: { eq: "y = a1+a2-b", map: { a1: "A1", a2: "A2", b: "B" }, tmdes: [A1y, A2y, tmde("b", "B", 3, "V", 0.02)], resultValue: 7, resultUnit: "V" },
  },
  {
    name: "A5 power  y = a^2",
    x: { eq: "y = a^2", map: { a: "A" }, tmdes: [A1, A2], resultValue: 100, resultUnit: "W" },
    y: { eq: "y = (a1+a2)^2", map: { a1: "A1", a2: "A2" }, tmdes: [A1y, A2y], resultValue: 100, resultUnit: "W" },
  },
  {
    name: "A7 log  y = 20*log10(a)",
    x: { eq: "y = 20*log10(a)", map: { a: "A" }, tmdes: [A1, A2], resultValue: 20, resultUnit: "Hz" },
    y: { eq: "y = 20*log10(a1+a2)", map: { a1: "A1", a2: "A2" }, tmdes: [A1y, A2y], resultValue: 20, resultUnit: "Hz" },
  },
  {
    name: "A12 composite-constant  y = a*b*0.9",
    x: { eq: "y = a*b*0.9", map: { a: "A", b: "B" }, tmdes: [A1, A2, tmde("b", "B", 2, "A", 0.01)], resultValue: 18, resultUnit: "W" },
    y: { eq: "y = (a1+a2)*b*0.9", map: { a1: "A1", a2: "A2", b: "B" }, tmdes: [A1y, A2y, tmde("b", "B", 2, "A", 0.01)], resultValue: 18, resultUnit: "W" },
  },
];

describe("derived multi-TMDE composition — Form X ≡ Form Y (additive, independent)", () => {
  cases.forEach((c) => {
    it(c.name, () => {
      const px = derivedPoint(c.x);
      const py = derivedPoint(c.y);

      const ux = unc(px);
      const uy = unc(py);
      expect(ux.error, `X uncertainty error: ${ux.error}`).toBeNull();
      expect(uy.error, `Y uncertainty error: ${uy.error}`).toBeNull();

      // Nominal: additive composition must match the summed-variable form.
      expect(ux.nominalResult).toBeCloseTo(uy.nominalResult, 9);
      // Combined input uncertainty must match.
      expect(ux.combinedUncertaintyNative).toBeCloseTo(uy.combinedUncertaintyNative, 9);

      const mx = computePointRiskMetrics(px, sessionData);
      const my = computePointRiskMetrics(py, sessionData);
      expect(mx, "X risk metrics null").not.toBeNull();
      expect(my, "Y risk metrics null").not.toBeNull();

      expect(mx.tur).toBeCloseTo(my.tur, 6);
      if (my.tar === undefined) expect(mx.tar).toBeUndefined();
      else expect(mx.tar).toBeCloseTo(my.tar, 6);
      expect(mx.pfa).toBeCloseTo(my.pfa, 6);
      expect(mx.pfr).toBeCloseTo(my.pfr, 6);
    });
  });
});

// ---------------------------------------------------------------------------
// First-principles absolute anchor — torque-style product, two weights.
//   y = m * L,  m = 12 + 8 = 20,  L = 0.5,  y = 10
//   each weight: ±0.02 rectangular (u_i = 0.02/√3),  L: ±0.001 rectangular
// ---------------------------------------------------------------------------
describe("derived multi-TMDE composition — first-principles absolute", () => {
  const m1 = tmde("m1", "Mass", 12, "N", 0.02);
  const m2 = tmde("m2", "Mass", 8, "N", 0.02);
  const L = tmde("L", "Length", 0.5, "m", 0.001);
  const p = derivedPoint({
    eq: "y = m * L",
    map: { m: "Mass", L: "Length" },
    tmdes: [m1, m2, L],
    resultValue: 10,
    resultUnit: "Hz", // to_si = 1, identity math
    uutHigh: 2,
  });

  it("nominal is the SUM of the two masses times L (20*0.5 = 10)", () => {
    const r = unc(p);
    expect(r.error).toBeNull();
    expect(r.nominalResult).toBeCloseTo(10, 9);
  });

  it("combined input uncertainty propagates RSS through sensitivities", () => {
    const r = unc(p);
    const uM = Math.sqrt(2) * (0.02 / Math.sqrt(3)); // two independent weights
    const uL = 0.001 / Math.sqrt(3);
    // y = m*L: ∂y/∂m = L = 0.5, ∂y/∂L = m = 20
    const expected = Math.sqrt((0.5 * uM) ** 2 + (20 * uL) ** 2);
    expect(r.combinedUncertaintyNative).toBeCloseTo(expected, 12);
  });

  it("produces finite, sensible risk metrics", () => {
    const mtr = computePointRiskMetrics(p, sessionData);
    expect(mtr).not.toBeNull();
    expect(Number.isFinite(mtr.tur)).toBe(true);
    expect(mtr.tar).toBeUndefined(); // input and output units are not comparable
    expect(Number.isFinite(mtr.pfa)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Guard relaxation — a freshly-assigned (empty-valued) source must NOT blank
// the panel. The empty piece is ignored until the user enters its value.
// ---------------------------------------------------------------------------
describe("derived multi-TMDE composition — empty source does not blank risk", () => {
  const valued = tmde("m1", "Mass", 12, "N", 0.02);
  const empty = { ...tmde("m2", "Mass", 0, "N", 0.02), measurementPoint: { value: "", unit: "N" } };
  const L = tmde("L", "Length", 0.5, "m", 0.001);

  it("computes from the valued source while a sibling is mid-entry", () => {
    const p = derivedPoint({
      eq: "y = m * L",
      map: { m: "Mass", L: "Length" },
      tmdes: [valued, empty, L],
      resultValue: 6, // 12 * 0.5 — only the valued mass contributes yet
      resultUnit: "Hz",
    });
    const m = computePointRiskMetrics(p, sessionData);
    expect(m, "risk blanked with an empty sibling source").not.toBeNull();
    expect(unc(p).nominalResult).toBeCloseTo(6, 9); // empty piece ignored, not summed

    // Once the second piece gets a value, it composes additively.
    const filled = derivedPoint({
      eq: "y = m * L",
      map: { m: "Mass", L: "Length" },
      tmdes: [valued, tmde("m2", "Mass", 8, "N", 0.02), L],
      resultValue: 10, // (12 + 8) * 0.5
      resultUnit: "Hz",
    });
    expect(unc(filled).nominalResult).toBeCloseTo(10, 9);
  });
});
