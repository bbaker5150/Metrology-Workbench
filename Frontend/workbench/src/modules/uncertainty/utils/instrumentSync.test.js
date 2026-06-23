import { describe, it, expect } from "vitest";
import {
  SYNC_NONE,
  SYNC_GREEN,
  SYNC_RED,
  buildValidatedSnapshot,
  isValidatedLinked,
  diffFromSnapshot,
  computeSyncState,
  buildSyncPayload,
} from "./instrumentSync";

const validated = (overrides = {}) => ({
  id: "v1",
  manufacturer: "Fluke",
  model: "5730A",
  description: "AC/DC Standard",
  functions: [{ name: "DCV", ranges: [] }],
  scope: "validated",
  validatedSnapshot: {
    manufacturer: "Fluke",
    model: "5730A",
    description: "AC/DC Standard",
    functions: [{ name: "DCV", ranges: [] }],
  },
  ...overrides,
});

describe("instrumentSync", () => {
  it("a local-only instrument is unlinked and shows no icon", () => {
    const local = { id: "l1", manufacturer: "Keysight", model: "34470A", scope: "local" };
    expect(isValidatedLinked(local)).toBe(false);
    expect(computeSyncState(local)).toBe(SYNC_NONE);
  });

  it("a validated instrument matching its snapshot is green", () => {
    expect(computeSyncState(validated())).toBe(SYNC_GREEN);
    expect(diffFromSnapshot(validated())).toEqual([]);
  });

  it("a diverged validated instrument is red with a field diff", () => {
    const diverged = validated({ description: "Edited locally" });
    expect(computeSyncState(diverged)).toBe(SYNC_RED);
    const diff = diffFromSnapshot(diverged);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({
      field: "description",
      from: "AC/DC Standard",
      to: "Edited locally",
    });
  });

  it("detects divergence inside the nested functions tree", () => {
    const diverged = validated({ functions: [{ name: "DCV", ranges: [{ id: "r1" }] }] });
    expect(computeSyncState(diverged)).toBe(SYNC_RED);
    expect(diffFromSnapshot(diverged).map((d) => d.field)).toContain("functions");
  });

  it("ignores key ordering (no false divergence)", () => {
    const reordered = validated({
      functions: [{ ranges: [], name: "DCV" }], // keys swapped vs snapshot
    });
    expect(computeSyncState(reordered)).toBe(SYNC_GREEN);
  });

  it("ignores session-context fields (area/asset) for divergence", () => {
    const recontextualized = validated({
      measurementArea: "DC Voltage",
      measurementAreaColor: "#3498db",
      assetId: "CAL-1",
      quantity: 3,
    });
    expect(computeSyncState(recontextualized)).toBe(SYNC_GREEN);
  });

  it("treats a linked instrument with no snapshot yet as green", () => {
    const linkedNoSnap = { id: "x", scope: "validated", manufacturer: "Fluke", model: "5730A" };
    expect(computeSyncState(linkedNoSnap)).toBe(SYNC_GREEN);
  });

  it("links via sourceId even when scope is local (loaded-from-shared, diverged)", () => {
    const loaded = {
      id: "copy",
      scope: "local",
      sourceId: "v1",
      manufacturer: "Fluke",
      model: "5730A",
      description: "tweaked",
      functions: [],
      validatedSnapshot: {
        manufacturer: "Fluke",
        model: "5730A",
        description: "AC/DC Standard",
        functions: [],
      },
    };
    expect(isValidatedLinked(loaded)).toBe(true);
    expect(computeSyncState(loaded)).toBe(SYNC_RED);
  });

  it("buildValidatedSnapshot captures only the defining fields", () => {
    const snap = buildValidatedSnapshot(validated({ assetId: "ignore-me" }));
    expect(Object.keys(snap).sort()).toEqual(
      ["description", "functions", "manufacturer", "model"].sort(),
    );
    expect(snap.assetId).toBeUndefined();
  });

  it("buildSyncPayload promotes to validated, re-snapshots, and carries the password", () => {
    const diverged = validated({ description: "Edited locally", scope: "local", sourceId: "v1" });
    const payload = buildSyncPayload(diverged, "calibrate");
    expect(payload.id).toBe("v1");
    expect(payload.scope).toBe("validated");
    expect(payload.password).toBe("calibrate");
    expect(payload.sourceId).toBe("v1");
    // Re-snapshot reflects the CURRENT (edited) definition, so a subsequent
    // computeSyncState on the synced record is green.
    expect(payload.validatedSnapshot.description).toBe("Edited locally");
    expect(computeSyncState({ ...payload })).toBe(SYNC_GREEN);
  });

  it("falls back to id as sourceId when syncing a brand-new instrument", () => {
    const fresh = { id: "new1", manufacturer: "X", model: "Y", description: "", functions: [] };
    expect(buildSyncPayload(fresh, "pw").sourceId).toBe("new1");
  });
});
