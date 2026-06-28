import { describe, expect, test } from "vitest";
import {
  findSidebarPointOccurrence,
  getSidebarPointRange,
  getVisibleSidebarPointOrder,
} from "./sidebarPointSelection";

// Function -> UUT -> Point shape. The same UUT can appear under two functions;
// the Unassigned bucket is a pseudo-function with a pseudo-UUT.
const sidebarData = [
  {
    id: "DC Voltage|V",
    name: "DC Voltage",
    uutGroups: [
      { id: "uut-1", points: [{ id: "point-2" }, { id: "point-1" }] },
      { id: "uut-2", points: [{ id: "point-1" }, { id: "point-3" }] },
    ],
  },
  {
    id: "__unassigned_function__",
    name: "Unassigned Points",
    isUnassigned: true,
    uutGroups: [
      {
        id: "__unassigned_uut__",
        isUnassigned: true,
        points: [{ id: "point-free" }],
      },
    ],
  },
];

describe("getVisibleSidebarPointOrder", () => {
  test("emits points only for expanded function + UUT nodes, honoring sort", () => {
    const entries = getVisibleSidebarPointOrder(
      sidebarData,
      {
        expandedFunctions: new Set(["DC Voltage|V", "__unassigned_function__"]),
        expandedUuts: new Set(["DC Voltage|V::uut-1"]),
      },
      (points) => [...points].sort((a, b) => a.id.localeCompare(b.id)),
    );

    expect(entries).toEqual([
      { pointId: "point-1", contextUutId: "uut-1" },
      { pointId: "point-2", contextUutId: "uut-1" },
      // Unassigned bucket follows function expansion (no per-UUT key).
      { pointId: "point-free", contextUutId: null },
    ]);
  });

  test("a collapsed function hides its points", () => {
    const entries = getVisibleSidebarPointOrder(sidebarData, {
      expandedFunctions: new Set([]),
      expandedUuts: new Set(["DC Voltage|V::uut-1"]),
    });
    expect(entries).toEqual([]);
  });

  test("distinguishes the same point rendered under different UUTs", () => {
    const entries = getVisibleSidebarPointOrder(sidebarData, {
      expandedFunctions: new Set(["DC Voltage|V"]),
      expandedUuts: new Set(["DC Voltage|V::uut-1", "DC Voltage|V::uut-2"]),
    });

    // uut-1: point-2, point-1 ; uut-2: point-1, point-3
    expect(findSidebarPointOccurrence(entries, "point-1", "uut-1")).toBe(1);
    expect(findSidebarPointOccurrence(entries, "point-1", "uut-2")).toBe(2);
    expect(
      getSidebarPointRange(
        entries,
        { pointId: "point-2", contextUutId: "uut-1" },
        { pointId: "point-3", contextUutId: "uut-2" },
      ),
    ).toEqual(["point-2", "point-1", "point-3"]);
  });
});
