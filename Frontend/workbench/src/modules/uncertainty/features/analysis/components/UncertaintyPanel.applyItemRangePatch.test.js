import { describe, expect, it } from "vitest";
import { applyItemRangePatch } from "./UncertaintyPanel";

// A freshly added inline instrument has `functions: []`, so its row renders a
// synthetic { id: "default" } range. Editing the unit/min/max/resolution must
// materialize a real range instead of being silently dropped.
describe("applyItemRangePatch on a new instrument with no ranges", () => {
  const newInstrument = () => ({
    id: "uut-1",
    instrument: { id: "inst-1", manufacturer: "", model: "", functions: [] },
  });

  it("materializes a range carrying a unit edit", () => {
    const patched = applyItemRangePatch(newInstrument(), "default", {
      unit: "SCCM",
    });
    const ranges = patched.instrument.functions.flatMap((fn) => fn.ranges);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].unit).toBe("SCCM");
    expect(ranges[0].id).toBeTruthy();
    expect(ranges[0].id).not.toBe("default");
  });

  it("materializes a range carrying a bound edit", () => {
    const patched = applyItemRangePatch(newInstrument(), "default", {
      min: "0",
    });
    const ranges = patched.instrument.functions.flatMap((fn) => fn.ranges);
    expect(ranges[0].min).toBe("0");
  });

  it("still routes a pure tolerance edit to the flat tolerance home", () => {
    const tol = { floor: { high: "1" } };
    const patched = applyItemRangePatch(newInstrument(), "default", {
      tolerances: tol,
    });
    expect(patched.tolerance).toEqual(tol);
    expect(patched.instrument.functions).toHaveLength(0);
  });

  it("patches in place when a real matching range exists", () => {
    const item = {
      id: "uut-2",
      instrument: {
        functions: [{ id: "fn1", unit: "V", ranges: [{ id: "r1", unit: "V" }] }],
      },
    };
    const patched = applyItemRangePatch(item, "r1", { unit: "mV" });
    expect(patched.instrument.functions[0].ranges[0].unit).toBe("mV");
    // No extra range was created.
    expect(patched.instrument.functions[0].ranges).toHaveLength(1);
  });
});
