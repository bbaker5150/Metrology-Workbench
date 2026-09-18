import { expect, it } from "vitest";
import { decisionRiskStatus } from "./decisionRiskStatus";

it("uses the configured PFA threshold for both metrics", () => {
  for (const metric of ["pfa", "pfr"]) {
    expect(decisionRiskStatus(3, 4, metric)).toBe("good");
    expect(decisionRiskStatus(3, 2, metric)).toBe("bad");
    expect(decisionRiskStatus(6, 2, metric)).toBe("bad");
  }
});
it("retains the list's PFA rounding rule without rounding PFR", () => {
  expect(decisionRiskStatus(2.004, 2, "pfa")).toBe("good");
  expect(decisionRiskStatus(2.004, 2, "pfr")).toBe("bad");
  expect(decisionRiskStatus(2.006, 2, "pfa")).toBe("bad");
});
it("keeps missing results neutral and handles zero and missing requirements", () => {
  for (const value of [null, undefined, "", NaN, Infinity]) expect(decisionRiskStatus(value, 2)).toBe("neutral");
  expect(decisionRiskStatus(0, 0)).toBe("good");
  expect(decisionRiskStatus(1, 0)).toBe("bad");
  expect(decisionRiskStatus(1, undefined)).toBe("good");
});
