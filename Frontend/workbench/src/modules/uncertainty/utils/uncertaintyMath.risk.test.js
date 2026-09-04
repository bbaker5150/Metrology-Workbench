import { describe, expect, it } from "vitest";
import {
  CalIntMgr,
  CalRelMgr,
  GBMultMgr,
  PFAMgr,
  PFAwGBMgr,
  PFRMgr,
  PFRwGBMgr,
  calcTUR,
  gbLowMgr,
  gbUpMgr,
} from "./uncertaintyMath";

// ---------------------------------------------------------------------------
// Decision-risk managers (PFA / PFR / guard banding), the ILAC-G8 side of the
// workbook. Assertions here are mostly *relational* — how the numbers must
// move when TUR degrades or the PFA requirement tightens — so they encode the
// physics rather than freezing arbitrary digits.
// ---------------------------------------------------------------------------

// A symmetric +/-1 tolerance around a nominal of 10, measured on-nominal.
const NOMINAL = 10;
const AVG = 10;
const TOL_LOW = 9;
const TOL_UP = 11;
const EOP_RELIABILITY = 0.95;

const pfaAt = (measUnc, tur) =>
  PFAMgr(NOMINAL, AVG, TOL_LOW, TOL_UP, measUnc, EOP_RELIABILITY, tur, 4);
const pfrAt = (measUnc, tur) =>
  PFRMgr(NOMINAL, AVG, TOL_LOW, TOL_UP, measUnc, EOP_RELIABILITY, tur, 4);

describe("PFAMgr", () => {
  it("returns the six-element PFA breakdown", () => {
    const result = pfaAt(0.25, 4);
    expect(result).toHaveLength(6);
    result.forEach((v) => expect(Number.isFinite(v)).toBe(true));
  });

  it("splits the total false-accept risk evenly across a symmetric tolerance", () => {
    const [total, lower, upper] = pfaAt(0.25, 4);
    expect(lower).toBeCloseTo(upper, 12);
    expect(lower + upper).toBeCloseTo(total, 12);
  });

  it("reports a small false-accept risk at a healthy 4:1 TUR", () => {
    const [total] = pfaAt(0.25, 4);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(0.01);
  });

  it("grows monotonically as the TUR degrades", () => {
    const [pfa4] = pfaAt(0.25, 4);
    const [pfa2] = pfaAt(0.5, 2);
    const [pfa1] = pfaAt(1.0, 1);
    expect(pfa2).toBeGreaterThan(pfa4);
    expect(pfa1).toBeGreaterThan(pfa2);
  });

  it("stays a probability across the TUR range", () => {
    for (const [unc, tur] of [[0.25, 4], [0.5, 2], [1.0, 1]]) {
      const [total] = pfaAt(unc, tur);
      expect(total).toBeGreaterThanOrEqual(0);
      expect(total).toBeLessThanOrEqual(1);
    }
  });

  it("blanks the whole row when the measurement uncertainty is unusable", () => {
    expect(PFAMgr(NOMINAL, AVG, TOL_LOW, TOL_UP, "x", EOP_RELIABILITY, 4, 4)).toEqual([
      "", "", "", "", "", "",
    ]);
  });

  it("blanks the whole row when the spec has no limits", () => {
    expect(PFAMgr(NOMINAL, AVG, "", "", 0.25, EOP_RELIABILITY, 4, 4)).toEqual([
      "", "", "", "", "", "",
    ]);
  });
});

describe("PFRMgr", () => {
  it("returns the three-element PFR breakdown", () => {
    const result = pfrAt(0.25, 4);
    expect(result).toHaveLength(3);
    result.forEach((v) => expect(Number.isFinite(v)).toBe(true));
  });

  it("splits false-reject risk evenly across a symmetric tolerance", () => {
    const [total, lower, upper] = pfrAt(0.25, 4);
    expect(lower).toBeCloseTo(upper, 12);
    expect(lower + upper).toBeCloseTo(total, 12);
  });

  it("grows sharply as the TUR degrades", () => {
    const [pfr4] = pfrAt(0.25, 4);
    const [pfr2] = pfrAt(0.5, 2);
    const [pfr1] = pfrAt(1.0, 1);
    expect(pfr2).toBeGreaterThan(pfr4);
    expect(pfr1).toBeGreaterThan(pfr2);
  });

  it("exceeds the false-accept risk at every TUR, since acceptance is at the tolerance limit", () => {
    for (const [unc, tur] of [[0.25, 4], [0.5, 2], [1.0, 1]]) {
      expect(pfrAt(unc, tur)[0]).toBeGreaterThan(pfaAt(unc, tur)[0]);
    }
  });

  it("blanks the row for unusable inputs", () => {
    expect(PFRMgr(NOMINAL, AVG, TOL_LOW, TOL_UP, "x", EOP_RELIABILITY, 4, 4)).toEqual([
      "", "", "",
    ]);
  });
});

describe("guard-band solving", () => {
  const gbLow = (req, unc = 0.25) =>
    gbLowMgr(req, NOMINAL, AVG, TOL_LOW, TOL_UP, unc, EOP_RELIABILITY);
  const gbUp = (req, unc = 0.25) =>
    gbUpMgr(req, NOMINAL, AVG, TOL_LOW, TOL_UP, unc, EOP_RELIABILITY);

  it("leaves the acceptance limits at the tolerance limits when PFA already meets the requirement", () => {
    // PFA at 4:1 is ~0.7%, comfortably inside a 2% requirement.
    expect(gbLow(0.02)).toEqual([TOL_LOW, 1]);
    expect(gbUp(0.02)).toEqual([TOL_UP, 1]);
  });

  it("pulls the acceptance limits inward when the requirement is stricter than the achieved PFA", () => {
    const [low, multLow] = gbLow(0.001);
    const [up, multUp] = gbUp(0.001);
    expect(low).toBeGreaterThan(TOL_LOW);
    expect(up).toBeLessThan(TOL_UP);
    expect(multLow).toBeLessThan(1);
    expect(multUp).toBeLessThan(1);
  });

  it("keeps the guard band symmetric about the nominal for a symmetric tolerance", () => {
    const [low] = gbLow(0.001);
    const [up] = gbUp(0.001);
    expect(NOMINAL - low).toBeCloseTo(up - NOMINAL, 9);
  });

  it("tightens further as the PFA requirement gets stricter", () => {
    const [, multLoose] = gbLow(0.001);
    const [, multTight] = gbLow(0.0001);
    expect(multTight).toBeLessThan(multLoose);
  });

  it("reports the same multiplier from both edges of a symmetric tolerance", () => {
    expect(gbLow(0.001)[1]).toBeCloseTo(gbUp(0.001)[1], 12);
  });
});

describe("GBMultMgr", () => {
  it("reports the fraction of the tolerance span the acceptance band keeps", () => {
    // Acceptance 9.19..10.81 spans 1.62 of the 2.0 tolerance span.
    expect(GBMultMgr(0.001, NOMINAL, AVG, TOL_LOW, TOL_UP, 9.19, 10.81)).toBeCloseTo(
      0.81,
      9,
    );
  });

  it("is 1 when the acceptance limits are the tolerance limits", () => {
    expect(GBMultMgr(0.001, NOMINAL, AVG, TOL_LOW, TOL_UP, TOL_LOW, TOL_UP)).toBeCloseTo(
      1,
      9,
    );
  });

  it("shrinks as the acceptance band narrows", () => {
    const wide = GBMultMgr(0.001, NOMINAL, AVG, TOL_LOW, TOL_UP, 9.5, 10.5);
    const narrow = GBMultMgr(0.001, NOMINAL, AVG, TOL_LOW, TOL_UP, 9.8, 10.2);
    expect(narrow).toBeLessThan(wide);
  });
});

describe("risk with a guard band applied", () => {
  const gbLimits = [9.19, 10.81];

  it("drives the false-accept risk well below the un-guard-banded value", () => {
    const [withGb] = PFAwGBMgr(
      NOMINAL, AVG, TOL_LOW, TOL_UP, 0.25, EOP_RELIABILITY, ...gbLimits,
    );
    const [withoutGb] = pfaAt(0.25, 4);
    expect(withGb).toBeLessThan(withoutGb);
  });

  it("raises the false-reject risk, which is the cost of guard banding", () => {
    const [withGb] = PFRwGBMgr(
      NOMINAL, AVG, TOL_LOW, TOL_UP, 0.25, EOP_RELIABILITY, ...gbLimits,
    );
    const [withoutGb] = pfrAt(0.25, 4);
    expect(withGb).toBeGreaterThan(withoutGb);
  });

  it("reduces to the un-guard-banded risk when acceptance equals tolerance", () => {
    const [withGb] = PFAwGBMgr(
      NOMINAL, AVG, TOL_LOW, TOL_UP, 0.25, EOP_RELIABILITY, TOL_LOW, TOL_UP,
    );
    const [withoutGb] = pfaAt(0.25, 4);
    expect(withGb).toBeCloseTo(withoutGb, 12);
  });

  it("keeps both guard-banded risks as valid probabilities", () => {
    const pfa = PFAwGBMgr(NOMINAL, AVG, TOL_LOW, TOL_UP, 0.25, EOP_RELIABILITY, ...gbLimits);
    const pfr = PFRwGBMgr(NOMINAL, AVG, TOL_LOW, TOL_UP, 0.25, EOP_RELIABILITY, ...gbLimits);
    for (const v of [pfa[0], pfr[0]]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("calibration interval managers", () => {
  it("keeps the requested interval when the achieved reliability already meets the requirement", () => {
    const [interval, reqRel, measRel] = CalIntMgr(
      NOMINAL, AVG, TOL_LOW, TOL_UP, 0.25, 0.95, 0.95, 4, 4, 365, 0.02,
    );
    expect(interval).toBe(365);
    expect(reqRel).toBeCloseTo(0.95, 9);
    expect(measRel).toBeCloseTo(0.95, 9);
  });

  it("reports the required and achieved reliability as a pair", () => {
    const result = CalRelMgr(
      NOMINAL, AVG, TOL_LOW, TOL_UP, 0.25, 0.95, 0.95, 4, 4, 365, 0.02,
    );
    expect(result).toHaveLength(2);
    result.forEach((v) => {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });
});

describe("TUR consistency with the risk inputs", () => {
  it("agrees with the uncertainties used to drive the PFA cases", () => {
    expect(calcTUR(NOMINAL, AVG, TOL_LOW, TOL_UP, 0.25)).toBeCloseTo(4, 12);
    expect(calcTUR(NOMINAL, AVG, TOL_LOW, TOL_UP, 0.5)).toBeCloseTo(2, 12);
    expect(calcTUR(NOMINAL, AVG, TOL_LOW, TOL_UP, 1.0)).toBeCloseTo(1, 12);
  });
});
