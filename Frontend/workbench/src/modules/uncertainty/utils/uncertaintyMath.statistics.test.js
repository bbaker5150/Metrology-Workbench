import { describe, expect, it } from "vitest";
import {
  CumNorm,
  DISTRIBUTION_NOT_SET,
  InvNormalDistribution,
  PHID,
  PHIDInv,
  bivariateNormalCDF,
  calcTAR,
  calcTUR,
  combineWithCorrelation,
  correlationKey,
  distributionDivisorValue,
  errorDistributions,
  getCorrelation,
  getKValueFromTDistribution,
  normalQuantile,
  resDwn,
  resUp,
  snapLimitsToResolution,
  studentTQuantile,
  uutUnc,
  uutUncLL,
  uutUncUL,
  vbNormSDist,
} from "./uncertaintyMath";

// ---------------------------------------------------------------------------
// The statistical core the whole budget rests on. Expected values here are
// published reference values (Student-t tables, the standard normal quantile),
// not snapshots of the implementation, so a regression in the numerics fails
// rather than silently re-baselining.
// ---------------------------------------------------------------------------

describe("distributionDivisorValue", () => {
  it("resolves the legacy rounded divisor strings to their exact constants", () => {
    // The persisted schema keeps "1.732"; Risk 8.0's VBA calculates with Sqr(3).
    expect(distributionDivisorValue("1.732")).toBe(Math.sqrt(3));
    expect(distributionDivisorValue("3.464")).toBe(Math.sqrt(12));
    expect(distributionDivisorValue("2.449")).toBe(Math.sqrt(6));
    expect(distributionDivisorValue("4.899")).toBe(Math.sqrt(24));
    expect(distributionDivisorValue("1.414")).toBe(Math.sqrt(2));
  });

  it("accepts an already-exact divisor and returns the same constant", () => {
    expect(distributionDivisorValue(Math.sqrt(3))).toBe(Math.sqrt(3));
  });

  it("normalizes both persisted Rayleigh spellings onto the workbook's 4.178", () => {
    expect(distributionDivisorValue("4.179")).toBe(4.178);
    expect(distributionDivisorValue("4.178")).toBe(4.178);
  });

  it("passes an unrecognized positive divisor through unchanged", () => {
    expect(distributionDivisorValue("2.5")).toBe(2.5);
  });

  it("returns NaN for the not-set sentinel", () => {
    expect(distributionDivisorValue(DISTRIBUTION_NOT_SET)).toBeNaN();
  });

  it.each([["-1"], ["0"], ["abc"], [null], [undefined]])(
    "returns NaN for the invalid divisor %s",
    (raw) => {
      expect(distributionDivisorValue(raw)).toBeNaN();
    },
  );

  it("resolves every selectable distribution except Not Set to a positive divisor", () => {
    for (const { value } of errorDistributions) {
      const divisor = distributionDivisorValue(value);
      if (value === DISTRIBUTION_NOT_SET) expect(divisor).toBeNaN();
      else expect(divisor).toBeGreaterThan(0);
    }
  });
});

describe("normalQuantile", () => {
  it("returns the exact two-sided 95% coverage factor the workbook reports", () => {
    // EqBudget reports k = 1.9599639845; simple-statistics' probit is 0.14% short.
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 12);
  });

  it("matches the published 90% and 99% quantiles", () => {
    expect(normalQuantile(0.95)).toBeCloseTo(1.6448536269514722, 10);
    expect(normalQuantile(0.995)).toBeCloseTo(2.5758293035489004, 9);
  });

  it("is zero at the median and antisymmetric about it", () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 12);
    expect(normalQuantile(0.1)).toBeCloseTo(-normalQuantile(0.9), 10);
  });

  it("stays accurate in the far tails, where the rational branch changes", () => {
    // p < 0.02425 and p > 0.97575 take the tail branches.
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232306167813, 8);
    expect(normalQuantile(0.999)).toBeCloseTo(3.090232306167813, 8);
  });

  it("saturates at infinity outside the open unit interval", () => {
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
    expect(normalQuantile(-0.5)).toBe(-Infinity);
    expect(normalQuantile(2)).toBe(Infinity);
  });

  it("round-trips through the CDF", () => {
    for (const p of [0.01, 0.25, 0.5, 0.75, 0.975, 0.999]) {
      expect(CumNorm(normalQuantile(p))).toBeCloseTo(p, 10);
    }
  });
});

describe("CumNorm / PHID / vbNormSDist", () => {
  it("is 0.5 at the mean", () => {
    expect(CumNorm(0)).toBeCloseTo(0.5, 12);
  });

  it("matches the standard normal table at ±1.96", () => {
    expect(CumNorm(1.96)).toBeCloseTo(0.9750021048517796, 10);
    expect(CumNorm(-1.96)).toBeCloseTo(0.0249978951482205, 10);
  });

  it("is symmetric: F(-z) = 1 - F(z)", () => {
    for (const z of [0.5, 1, 2, 3]) {
      expect(CumNorm(-z)).toBeCloseTo(1 - CumNorm(z), 12);
    }
  });

  it("covers the 68-95-99.7 rule", () => {
    expect(CumNorm(1) - CumNorm(-1)).toBeCloseTo(0.6826894921370859, 9);
    expect(CumNorm(2) - CumNorm(-2)).toBeCloseTo(0.9544997361036416, 9);
    expect(CumNorm(3) - CumNorm(-3)).toBeCloseTo(0.9973002039367398, 9);
  });

  it("exposes the same CDF through the workbook's aliases", () => {
    expect(PHID(1.96)).toBeCloseTo(CumNorm(1.96), 12);
    expect(vbNormSDist(1.96)).toBeCloseTo(CumNorm(1.96), 12);
  });

  it("inverts through PHIDInv and InvNormalDistribution", () => {
    expect(PHIDInv(0.975)).toBeCloseTo(1.959963984540054, 9);
    expect(InvNormalDistribution(0.975)).toBeCloseTo(1.959963984540054, 9);
    expect(PHIDInv(0.5)).toBeCloseTo(0, 10);
  });
});

describe("studentTQuantile", () => {
  // Published two-sided 95% Student-t critical values.
  it.each([
    [1, 12.7062047361747],
    [2, 4.302652729911275],
    [5, 2.570581835636197],
    [10, 2.2281388519649385],
    [30, 2.0422724563012378],
    [100, 1.9839715184496334],
  ])("matches the t table at nu=%i for p=0.975", (df, expected) => {
    expect(studentTQuantile(0.975, df)).toBeCloseTo(expected, 6);
  });

  it("is zero at the median for any finite dof", () => {
    expect(studentTQuantile(0.5, 5)).toBe(0);
  });

  it("is antisymmetric about the median", () => {
    expect(studentTQuantile(0.025, 10)).toBeCloseTo(-studentTQuantile(0.975, 10), 10);
  });

  it("is always wider than the normal quantile at finite dof", () => {
    for (const df of [1, 5, 30, 1000]) {
      expect(studentTQuantile(0.975, df)).toBeGreaterThan(normalQuantile(0.975));
    }
  });

  it("converges to the normal quantile as dof grows", () => {
    expect(studentTQuantile(0.975, 1e6)).toBeCloseTo(normalQuantile(0.975), 5);
  });

  it("collapses to the normal quantile for infinite or absurd dof", () => {
    expect(studentTQuantile(0.975, Infinity)).toBe(normalQuantile(0.975));
    expect(studentTQuantile(0.975, 1e8)).toBe(normalQuantile(0.975));
    expect(studentTQuantile(0.975, NaN)).toBe(normalQuantile(0.975));
  });

  it("collapses to the normal quantile for non-positive dof", () => {
    expect(studentTQuantile(0.975, 0)).toBe(normalQuantile(0.975));
    expect(studentTQuantile(0.975, -3)).toBe(normalQuantile(0.975));
  });

  it("shrinks monotonically as dof increases", () => {
    const ks = [1, 2, 5, 10, 30, 120].map((df) => studentTQuantile(0.975, df));
    for (let i = 1; i < ks.length; i++) expect(ks[i]).toBeLessThan(ks[i - 1]);
  });
});

describe("getKValueFromTDistribution", () => {
  it("defaults to the 95% two-sided coverage factor", () => {
    expect(getKValueFromTDistribution(10)).toBeCloseTo(2.2281388519649385, 6);
  });

  it("honors the configured confidence rather than assuming 95%", () => {
    // This is the bug the exact implementation replaced: a hard-coded 95% table.
    expect(getKValueFromTDistribution(10, 0.95)).toBeCloseTo(1.8124611228107335, 6);
    expect(getKValueFromTDistribution(10, 0.995)).toBeCloseTo(3.169272672327235, 6);
  });

  it("falls back to the normal quantile when dof is infinite or unknown", () => {
    expect(getKValueFromTDistribution(Infinity)).toBeCloseTo(1.959963984540054, 10);
    expect(getKValueFromTDistribution(NaN)).toBeCloseTo(1.959963984540054, 10);
  });
});

describe("correlation handling", () => {
  it("builds an order-independent key so rho_ij and rho_ji collide", () => {
    expect(correlationKey("b", "a")).toBe(correlationKey("a", "b"));
  });

  it("treats a component as perfectly correlated with itself", () => {
    expect(getCorrelation({}, "x", "x")).toBe(1);
  });

  it("defaults to independence for an unlisted or unparseable pair", () => {
    expect(getCorrelation({}, "a", "b")).toBe(0);
    expect(getCorrelation({ "a|b": "nonsense" }, "a", "b")).toBe(0);
    expect(getCorrelation(undefined, "a", "b")).toBe(0);
  });

  it("reads a stored coefficient regardless of argument order", () => {
    const map = { [correlationKey("a", "b")]: 0.5 };
    expect(getCorrelation(map, "a", "b")).toBe(0.5);
    expect(getCorrelation(map, "b", "a")).toBe(0.5);
  });
});

describe("combineWithCorrelation", () => {
  const c = (id, contribution) => ({ id, contribution });

  it("reduces to plain RSS when nothing is correlated", () => {
    expect(combineWithCorrelation([c("a", 3), c("b", 4)])).toBeCloseTo(5, 12);
  });

  it("adds linearly at perfect positive correlation", () => {
    const rho = { [correlationKey("a", "b")]: 1 };
    expect(combineWithCorrelation([c("a", 3), c("b", 4)], rho)).toBeCloseTo(7, 12);
  });

  it("cancels at perfect negative correlation", () => {
    const rho = { [correlationKey("a", "b")]: -1 };
    expect(combineWithCorrelation([c("a", 3), c("b", 4)], rho)).toBeCloseTo(1, 12);
  });

  it("lets a signed sensitivity turn a positive correlation into a reduction", () => {
    // e.g. a ratio V1/V2, where the second sensitivity is negative.
    const rho = { [correlationKey("a", "b")]: 1 };
    expect(combineWithCorrelation([c("a", 3), c("b", -3)], rho)).toBeCloseTo(0, 10);
  });

  it("clamps a non positive-semidefinite matrix to zero instead of returning NaN", () => {
    const rho = { [correlationKey("a", "b")]: -5 };
    const result = combineWithCorrelation([c("a", 1), c("b", 1)], rho);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  it("skips non-finite contributions rather than poisoning the sum", () => {
    expect(combineWithCorrelation([c("a", 3), c("b", NaN), c("c", 4)])).toBeCloseTo(5, 12);
    expect(combineWithCorrelation([c("a", 3), c("b", Infinity)])).toBeCloseTo(3, 12);
  });

  it("returns zero for an empty budget", () => {
    expect(combineWithCorrelation([])).toBe(0);
  });

  it("handles a single contribution", () => {
    expect(combineWithCorrelation([c("a", 2.5)])).toBeCloseTo(2.5, 12);
  });

  it("is never negative", () => {
    expect(combineWithCorrelation([c("a", -3), c("b", -4)])).toBeCloseTo(5, 12);
  });

  it("combines three correlated contributions pairwise", () => {
    // u_c^2 = 1 + 1 + 1 + 2(0.5)(1)(1) x 3 pairs = 3 + 3 = 6
    const rho = {
      [correlationKey("a", "b")]: 0.5,
      [correlationKey("a", "c")]: 0.5,
      [correlationKey("b", "c")]: 0.5,
    };
    expect(combineWithCorrelation([c("a", 1), c("b", 1), c("c", 1)], rho)).toBeCloseTo(
      Math.sqrt(6),
      12,
    );
  });
});

describe("resolution rounding", () => {
  it("rounds a low limit inward (up) and a high limit inward (down)", () => {
    expect(resDwn(10.54, 0.1)).toBeCloseTo(10.6, 10);
    expect(resUp(10.56, 0.1)).toBeCloseTo(10.5, 10);
  });

  it("leaves an on-grid value in place despite unit round-trip dust", () => {
    // 0.1 psig -> SI -> psig can come back as 0.10000000000000002, making 10.5
    // divide to 104.9999...; a naive floor would drop a full resolution count.
    expect(resDwn(10.5, 0.10000000000000002)).toBeCloseTo(10.5, 9);
    expect(resUp(10.5, 0.10000000000000002)).toBeCloseTo(10.5, 9);
  });

  it("never collapses a non-zero limit to zero under a coarse resolution", () => {
    // This produced the GBLOW/GBUP "0" display bug: truncating 0.05 to a 1.0
    // grid lands on 0, so the raw value is kept instead.
    expect(resUp(0.05, 1)).toBe(0.05);
  });

  it("moves a sub-resolution value onto the nearest grid line away from zero", () => {
    // Both directions floor/truncate onto the grid; neither returns 0.
    expect(resDwn(0.05, 1)).toBe(1);
    expect(resDwn(-0.05, 1)).toBe(-1);
    expect(resUp(-0.05, 1)).toBe(-1);
  });

  it("passes non-finite values straight through so a failed solve shows as N/A", () => {
    expect(resDwn(NaN, 0.1)).toBeNaN();
    expect(resUp(NaN, 0.1)).toBeNaN();
    expect(resDwn(Infinity, 0.1)).toBe(Infinity);
    expect(resUp(-Infinity, 0.1)).toBe(-Infinity);
  });

  it("is a no-op for a missing or non-positive resolution", () => {
    expect(resDwn(5.5, 0)).toBe(5.5);
    expect(resDwn(5.5, -1)).toBe(5.5);
    expect(resDwn(5.5, NaN)).toBe(5.5);
    expect(resUp(5.5, 0)).toBe(5.5);
  });

  it("leaves exact zero alone", () => {
    expect(resDwn(0, 0.1)).toBe(0);
    expect(resUp(0, 0.1)).toBe(0);
  });

  it("rounds negative values away from zero for resDwn and toward -inf for resUp", () => {
    expect(resDwn(-10.54, 0.1)).toBeCloseTo(-10.6, 9);
    expect(resUp(-10.54, 0.1)).toBeCloseTo(-10.6, 9);
  });
});

describe("snapLimitsToResolution", () => {
  it("pulls both limits inward onto the resolution grid", () => {
    expect(snapLimitsToResolution(9.94, 10.36, 0.1)).toEqual({ low: 10, high: 10.3 });
  });

  it("leaves the band untouched when the resolution is missing or invalid", () => {
    expect(snapLimitsToResolution(1, 2, 0)).toEqual({ low: 1, high: 2 });
    expect(snapLimitsToResolution(1, 2, -0.5)).toEqual({ low: 1, high: 2 });
    expect(snapLimitsToResolution(1, 2, NaN)).toEqual({ low: 1, high: 2 });
  });

  it("leaves the band untouched rather than collapsing it to a point", () => {
    // Snapping 9.94/10.06 to a 0.1 grid would put both limits at 10.0.
    expect(snapLimitsToResolution(9.94, 10.06, 0.1)).toEqual({ low: 9.94, high: 10.06 });
  });

  it("leaves the band untouched rather than inverting it", () => {
    expect(snapLimitsToResolution(9.99, 10.01, 1)).toEqual({ low: 9.99, high: 10.01 });
  });

  it("keeps an already-on-grid band exactly where it is", () => {
    expect(snapLimitsToResolution(9.5, 10.5, 0.1)).toEqual({ low: 9.5, high: 10.5 });
  });
});

describe("calcTAR", () => {
  it("is the ratio of the tolerance span to the standard's span for a two-sided spec", () => {
    // (11 - 9) / (10.5 - 9.5) = 2:1
    expect(calcTAR(10, 10, 9, 11, 9.5, 10.5)).toBeCloseTo(2, 12);
  });

  it("uses the half-span against the measured average for a lower-threshold spec", () => {
    expect(calcTAR(10, 10, 9, "", 9.5, 10.5)).toBeCloseTo(2, 12);
  });

  it("uses the half-span against the measured average for an upper-threshold spec", () => {
    expect(calcTAR(10, 10, "", 11, 9.5, 10.5)).toBeCloseTo(2, 12);
  });

  it("returns an empty string when either standard limit is not a number", () => {
    expect(calcTAR(10, 10, 9, 11, "x", 10.5)).toBe("");
    expect(calcTAR(10, 10, 9, 11, 9.5, "")).toBe("");
  });

  it("scales with a tighter standard", () => {
    // Halving the standard's span doubles the accuracy ratio.
    expect(calcTAR(10, 10, 9, 11, 9.75, 10.25)).toBeCloseTo(4, 12);
  });

  it("returns an empty string when the spec has neither limit", () => {
    expect(calcTAR(10, 10, "", "", 9.5, 10.5)).toBe("");
    expect(calcTUR(10, 10, "", "", 0.25)).toBe("");
  });
});

describe("calcTUR", () => {
  it("is tolerance span over twice the measurement uncertainty for a two-sided spec", () => {
    // (11 - 9) / (2 x 0.25) = 4:1
    expect(calcTUR(10, 10, 9, 11, 0.25)).toBeCloseTo(4, 12);
  });

  it("scales inversely with the measurement uncertainty", () => {
    expect(calcTUR(10, 10, 9, 11, 1)).toBeCloseTo(1, 12);
    expect(calcTUR(10, 10, 9, 11, 0.125)).toBeCloseTo(8, 12);
  });

  it("uses the single-sided distance for threshold specs", () => {
    expect(calcTUR(10, 10, 9, "", 0.25)).toBeCloseTo(4, 12);
    expect(calcTUR(10, 10, "", 11, 0.25)).toBeCloseTo(4, 12);
  });

  it("returns an empty string when the measurement uncertainty is not a number", () => {
    expect(calcTUR(10, 10, 9, 11, "abc")).toBe("");
    expect(calcTUR(10, 10, 9, 11, "")).toBe("");
  });
});

describe("UUT uncertainty back-solve", () => {
  it("solves a positive UUT sigma from the end-of-period reliability", () => {
    expect(uutUnc(0.95, 0.25, -1, 1)).toBeCloseTo(0.4447670981839885, 9);
  });

  it("returns a wider sigma for a lower in-tolerance reliability", () => {
    expect(uutUnc(0.8, 0.25, -1, 1)).toBeGreaterThan(uutUnc(0.95, 0.25, -1, 1));
  });

  it("solves the single-sided variants symmetrically about the average", () => {
    const lower = uutUncLL(0.95, 0.25, 10, 9);
    const upper = uutUncUL(0.95, 0.25, 10, 11);
    expect(lower).toBeCloseTo(upper, 9);
    expect(lower).toBeGreaterThan(0);
  });
});

describe("bivariateNormalCDF", () => {
  it("is the product of the marginals when the variables are independent", () => {
    expect(bivariateNormalCDF(0, 0, 0)).toBeCloseTo(0.25, 6);
    expect(bivariateNormalCDF(1.96, 1.96, 0)).toBeCloseTo(CumNorm(1.96) ** 2, 4);
  });

  it("exceeds the independent case under positive correlation", () => {
    expect(bivariateNormalCDF(0, 0, 0.5)).toBeGreaterThan(0.25);
  });

  it("falls below the independent case under negative correlation", () => {
    expect(bivariateNormalCDF(0, 0, -0.5)).toBeLessThan(0.25);
  });

  it("stays a probability across a range of correlations", () => {
    for (const r of [-0.9, -0.5, 0, 0.5, 0.9]) {
      const p = bivariateNormalCDF(0.5, -0.5, r);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});
