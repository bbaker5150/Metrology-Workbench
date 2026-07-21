/**
 * riskBridge8.test.js — Phase 4 tests for the front-end/back-end bridge:
 * the minimum-input gate, resolution snapping of the physical guard band, the
 * MAIN/RISK field-name mapping, and the end-to-end computeRiskRow8 flow.
 */

import { describe, expect, test } from "vitest";
import {
  RISK8_OUTPUT_FIELD_MAP,
  rowHasMinimumRiskInputs,
  applyResolutionToGB,
  toMainRiskFields,
  computeRiskRow8,
} from "./riskBridge8";

const symRow = () => ({
  nominal: 10,
  lowerLimit: 9,
  upperLimit: 11,
  initialGB: 1,
  uCal: "",
  mu: "",
  xcal: "",
  tur: 4,
  reop: 0.9,
  turNeeded: "",
  originalInterval: 12,
  pfaTarget: 0.02,
  reopTarget: 0.85,
  decayModel: "",
  weibullBeta: "",
});

describe("rowHasMinimumRiskInputs", () => {
  test("a complete symmetric row passes", () => {
    expect(rowHasMinimumRiskInputs(symRow())).toBe(true);
  });

  test("missing TUR / REOP / targets fail the gate", () => {
    expect(rowHasMinimumRiskInputs({ ...symRow(), tur: "" })).toBe(false);
    expect(rowHasMinimumRiskInputs({ ...symRow(), reop: "" })).toBe(false);
    expect(rowHasMinimumRiskInputs({ ...symRow(), pfaTarget: "" })).toBe(false);
    expect(rowHasMinimumRiskInputs({ ...symRow(), reopTarget: "" })).toBe(false);
  });

  test("single-sided rows need only their one active limit", () => {
    // Dropping the upper limit reclassifies to a valid single-sided lower
    // (type 3): nominal + lower + risk inputs are present, so the gate passes.
    expect(rowHasMinimumRiskInputs({ ...symRow(), upperLimit: "" })).toBe(true);
    // type 4 (upper only) with all risk inputs present passes
    expect(
      rowHasMinimumRiskInputs({ ...symRow(), lowerLimit: "", upperLimit: 11 })
    ).toBe(true);
    // a single-sided upper missing its active (upper) limit cannot classify
    expect(
      rowHasMinimumRiskInputs({ ...symRow(), lowerLimit: "", upperLimit: "" })
    ).toBe(false);
  });

  test("approved type-5/6 correction accepts blank TUR with U_cal and PFA target", () => {
    const lowerUnknown = {
      ...symRow(),
      nominal: "",
      lowerLimit: 9,
      upperLimit: "",
      uCal: 0.1,
      tur: "",
      reop: "",
      reopTarget: "",
    };
    const upperUnknown = {
      ...lowerUnknown,
      lowerLimit: "",
      upperLimit: 11,
    };

    expect(rowHasMinimumRiskInputs(lowerUnknown)).toBe(true);
    expect(rowHasMinimumRiskInputs(upperUnknown)).toBe(true);
  });

  test("type-5/6 gate rejects populated TUR or missing boundary inputs", () => {
    const unknown = {
      ...symRow(),
      nominal: "",
      lowerLimit: 9,
      upperLimit: "",
      uCal: 0.1,
      tur: "",
      reop: "",
      reopTarget: "",
    };

    expect(rowHasMinimumRiskInputs({ ...unknown, tur: 4 })).toBe(false);
    expect(rowHasMinimumRiskInputs({ ...unknown, uCal: "" })).toBe(false);
    expect(rowHasMinimumRiskInputs({ ...unknown, pfaTarget: "" })).toBe(false);
  });

  test("invalid tolerance geometry fails the gate", () => {
    expect(rowHasMinimumRiskInputs({ ...symRow(), lowerLimit: 12, upperLimit: 11 })).toBe(false);
  });
});

describe("applyResolutionToGB", () => {
  test("lower rounds up (inward), upper rounds down (inward)", () => {
    const out = { physGbLower: 9.123, physGbUpper: 10.877 };
    applyResolutionToGB(out, 0.01);
    expect(out.physGbLower).toBeCloseTo(9.13, 12);
    expect(out.physGbUpper).toBeCloseTo(10.87, 12);
  });

  test("collapsing band -> 'resolution too coarse' on both sides", () => {
    const out = { physGbLower: 9.6, physGbUpper: 10.4 };
    applyResolutionToGB(out, 1);
    expect(out.physGbLower).toBe("resolution too coarse");
    expect(out.physGbUpper).toBe("resolution too coarse");
  });

  test("non-numeric GB cells and invalid resolution are left untouched", () => {
    const out = { physGbLower: "check inputs", physGbUpper: 10.877 };
    applyResolutionToGB(out, 0.01);
    expect(out.physGbLower).toBe("check inputs");
    expect(out.physGbUpper).toBeCloseTo(10.87, 12);

    const out2 = { physGbLower: 9.123, physGbUpper: 10.877 };
    applyResolutionToGB(out2, 0); // res <= 0 is a no-op
    expect(out2.physGbLower).toBe(9.123);
    applyResolutionToGB(out2, ""); // blank resolution is a no-op
    expect(out2.physGbLower).toBe(9.123);
  });
});

describe("toMainRiskFields", () => {
  test("maps output keys to workbook MAIN/RISK column names", () => {
    const out = { obs: 0.9, pfa: 0.01, physGbLower: 9.2, gbInterval: 8 };
    const fields = toMainRiskFields(out);
    expect(fields.REOP_At_Test_TUR).toBe(0.9);
    expect(fields.Test_PFA).toBe(0.01);
    expect(fields.GB_LL).toBe(9.2);
    expect(fields.Interval_With_GB).toBe(8);
    // every mapped column is present
    for (const colName of Object.values(RISK8_OUTPUT_FIELD_MAP)) {
      expect(colName in fields).toBe(true);
    }
  });
});

describe("computeRiskRow8 end-to-end", () => {
  test("complete row computes and returns MAIN-named fields", () => {
    const { out, fields, computed } = computeRiskRow8(symRow());
    expect(computed).toBe(true);
    expect(typeof out.pfa).toBe("number");
    expect(typeof fields.Test_PFA).toBe("number");
    expect(fields.Test_PFA).toBe(out.pfa);
  });

  test("gate failure returns cleared outputs without computing", () => {
    const { out, fields, computed } = computeRiskRow8({ ...symRow(), tur: "" });
    expect(computed).toBe(false);
    expect(out.pfa).toBe("");
    expect(fields.Test_PFA).toBe("");
  });

  test("corrected bridge reaches the type-5 PFA-only handler", () => {
    const { out, fields, computed } = computeRiskRow8({
      ...symRow(),
      nominal: "",
      lowerLimit: 9,
      upperLimit: "",
      uCal: 0.1,
      tur: "",
      reop: "",
      reopTarget: "",
    });

    expect(computed).toBe(true);
    expect(out.tolType).toBe(5);
    expect(out.statusMit).toBe("OK");
    expect(fields.PFA_With_GB).toBe(0.02);
    expect(typeof fields.GB_LL).toBe("number");
    expect(fields.REOP_At_Test_TUR).toBe("");
    expect(fields.Test_PFR).toBe("");
  });

  test("resolution snaps the physical guard band in the flow", () => {
    // Coarse resolution should snap GB_LL up and GB_UL down onto the grid.
    const { out } = computeRiskRow8(symRow(), { resolution: 0.1 });
    if (typeof out.physGbLower === "number") {
      expect(Math.round(out.physGbLower * 10)).toBeCloseTo(out.physGbLower * 10, 6);
    }
    if (typeof out.physGbUpper === "number") {
      expect(Math.round(out.physGbUpper * 10)).toBeCloseTo(out.physGbUpper * 10, 6);
    }
  });

  test("enforceMinimumInputs=false lets a partial row through to the driver", () => {
    // Without the gate, computeOneRow handles the partial row (missing TUR ->
    // "missing required input"), rather than being cleared by the bridge.
    const { out, computed } = computeRiskRow8(
      { ...symRow(), tur: "" },
      { enforceMinimumInputs: false }
    );
    expect(computed).toBe(true);
    expect(out.statusCore).toBe("missing required input");
  });
});
