import { describe, expect, it } from "vitest";
import {
  isDiscoveredInstrumentAvailable,
  isSameInstrumentAddress,
  normalizeInstrumentAddress,
} from "./instrumentStatus";

describe("instrument status helpers", () => {
  it("compares persisted VISA addresses without casing or whitespace drift", () => {
    expect(normalizeInstrumentAddress(" gpib0::4::instr ")).toBe("GPIB0::4::INSTR");
    expect(isSameInstrumentAddress("GPIB0::4::INSTR", "gpib0::4::instr")).toBe(true);
  });

  it("treats an identified discovery result as available independently of ISR support", () => {
    expect(isDiscoveredInstrumentAvailable({
      address: "GPIB0::4::INSTR",
      identity: "FLUKE,5730A,1234,1.0",
    })).toBe(true);
    expect(isDiscoveredInstrumentAvailable({
      address: "GPIB0::22::INSTR",
      identity: "HEWLETT-PACKARD,34420A,0,1.0",
    })).toBe(true);
  });

  it("rejects stale unidentified discovery entries", () => {
    expect(isDiscoveredInstrumentAvailable({
      address: "GPIB0::4::INSTR",
      identity: "N/A - Instrument connected but did not identify.",
    })).toBe(false);
    expect(isDiscoveredInstrumentAvailable({ address: "", identity: "FLUKE,5730A" })).toBe(false);
  });
});
