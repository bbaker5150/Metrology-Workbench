import { describe, it, expect } from "vitest";
import {
  SYNC_NONE,
  SYNC_GREEN,
  SYNC_RED,
  SYNC_ORANGE,
  SYNC_YELLOW,
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
  it("shows unsaved session instruments as red", () => { expect(computeSyncState({ id: "draft" })).toBe(SYNC_RED); });
  it("a local-only instrument is unlinked and orange", () => {
    const local = { id: "l1", manufacturer: "Keysight", model: "34470A", scope: "local" };
    expect(isValidatedLinked(local)).toBe(false);
    expect(computeSyncState(local)).toBe(SYNC_ORANGE);
  });

  it("an explicit localOverride forces red even when the snapshot matches", () => {
    expect(computeSyncState(validated({ localOverride: true }))).toBe(SYNC_RED);
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
    expect(computeSyncState(loaded)).toBe(SYNC_ORANGE);
  });

  it("buildValidatedSnapshot captures only the defining fields", () => {
    const snap = buildValidatedSnapshot(validated({ assetId: "ignore-me" }));
    expect(Object.keys(snap).sort()).toEqual(
      ["description", "functions", "manufacturer", "model", "typeBComponents", "ranges", "tmdeSecondaryUncertainties", "qualifierColumnNames", "customColumns"].sort(),
    );
    expect(snap.assetId).toBeUndefined();
  });

  it("submits a private working copy while preserving its origin and prior baseline", () => {
    const local = validated({ id: "draft", scope: "local", sourceId: "v1", description: "Edited" });
    const payload = buildSyncPayload(local);
    expect(payload).toMatchObject({ id: "draft", scope: "pending", sourceId: "v1", validatedSnapshot: local.validatedSnapshot });
    expect(payload).not.toHaveProperty("password");
    expect(computeSyncState(payload)).toBe(SYNC_YELLOW);
    const edit = buildSyncPayload(validated());
    expect(edit.id).not.toBe("v1");
    expect(edit.sourceId).toBe("v1");
    expect(buildSyncPayload({id: "new"})).toMatchObject({id: "new", scope: "pending", sourceId: ""});
  });
});
