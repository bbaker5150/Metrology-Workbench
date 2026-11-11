import { describe, expect, it } from "vitest";
import { mergeSessionInstrumentEdit } from "./sessionInstrumentEdit";

describe("mergeSessionInstrumentEdit", () => {
  const previous = () => ({
    id: "session-row", quantity: 3, assetId: "asset-123", measurementAreaNames: ["Torque", "Voltage"],
    libraryInstrumentId: "shared", definitionId: "shared", instrumentId: "shared",
    sourceInstrumentId: "shared", sourceInstrument: { id: "shared", name: "source" },
    instrument: { id: "shared", scope: "validated", libraryInstrumentId: "shared" },
  });

  it("adopts the fresh definition and remaps omitted legacy aliases while retaining session metadata", () => {
    const old = previous();
    const instrument = { id: "session-definition", libraryInstrumentId: "session-definition", sourceId: "shared", scope: "session" };
    const next = mergeSessionInstrumentEdit(old, { instrument, libraryInstrumentId: instrument.id });
    expect(next).toMatchObject({ id: "session-row", quantity: 3, assetId: "asset-123",
      measurementAreaNames: ["Torque", "Voltage"], libraryInstrumentId: instrument.id,
      definitionId: instrument.id, instrumentId: instrument.id, sourceInstrumentId: instrument.id,
      sourceInstrument: { id: instrument.id, name: "source" }, instrument });
    expect(old).toEqual(previous());
  });

  it("retains explicit replacement aliases and unrelated reference IDs", () => {
    const next = mergeSessionInstrumentEdit({ ...previous(), instrumentId: "unrelated" }, {
      instrument: { id: "new" }, definitionId: null, sourceInstrumentId: "other", libraryInstrumentId: "new",
    });
    expect(next).toMatchObject({ instrumentId: "unrelated", definitionId: null, sourceInstrumentId: "other", libraryInstrumentId: "new" });
  });

  it("keeps identity and nested references on an unchanged save", () => {
    const old = previous();
    const next = mergeSessionInstrumentEdit(old, { instrument: old.instrument, description: "Saved" });
    expect(next).toEqual({ ...old, description: "Saved" });
    expect(next.sourceInstrument).toBe(old.sourceInstrument);
    expect(next.instrument).toBe(old.instrument);
  });
});
