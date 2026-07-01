import { describe, expect, it } from "vitest";
import {
  associateUutWithPoint,
  resolvePointAreaId,
  resolveAreaWorkspacePoint,
} from "./areaWorkspace";

describe("resolveAreaWorkspacePoint", () => {
  const points = [
    { id: "electrical-1", measurementAreaId: "electrical" },
    { id: "electrical-2", measurementAreaId: "electrical" },
    { id: "torque-1", measurementAreaId: "torque" },
  ];

  it("keeps the selected point when it belongs to the selected area", () => {
    expect(
      resolveAreaWorkspacePoint(points, "electrical-2", "electrical")?.id,
    ).toBe("electrical-2");
  });

  it("uses the first point in a newly selected area", () => {
    expect(resolveAreaWorkspacePoint(points, "torque-1", "electrical")?.id).toBe(
      "electrical-1",
    );
  });
});

describe("resolvePointAreaId", () => {
  it("inherits a missing point area from its active UUT", () => {
    expect(
      resolvePointAreaId(
        { associatedUutIds: ["fluke"] },
        [
          {
            id: "fluke",
            measurementAreaId: "electrical",
            measurementArea: "Electrical",
          },
        ],
        [{ id: "electrical", name: "Electrical" }],
        "fluke",
      ),
    ).toBe("electrical");
  });

  it("prefers the linked UUT area over a stale point area", () => {
    expect(
      resolvePointAreaId(
        { measurementAreaId: "flow", associatedUutIds: ["encoder"] },
        [
          {
            id: "encoder",
            measurementAreaId: "angular",
            measurementArea: "Angular Speed",
          },
        ],
        [
          { id: "flow", name: "Flow" },
          { id: "angular", name: "Angular Speed" },
        ],
      ),
    ).toBe("angular");
  });
});

describe("associateUutWithPoint", () => {
  it("adds a UUT to the active point without changing other points", () => {
    const points = [
      { id: "point-1", associatedUutIds: ["uut-1"] },
      { id: "point-2", associatedUutIds: [] },
    ];

    expect(associateUutWithPoint(points, "point-1", "uut-2")).toEqual([
      { id: "point-1", associatedUutIds: ["uut-1", "uut-2"] },
      { id: "point-2", associatedUutIds: [] },
    ]);
  });

  it("does not duplicate an existing association", () => {
    const points = [{ id: "point-1", associatedUutIds: ["uut-1"] }];

    expect(associateUutWithPoint(points, "point-1", "uut-1")).toEqual(points);
  });
});
