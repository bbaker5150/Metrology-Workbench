import { describe, expect, it } from "vitest";
import {
  DETAIL_SECTION_IDS,
  detailSectionOrderValue,
  moveDetailSection,
  normalizeDetailSectionOrder,
} from "./detailSectionOrder";

describe("detail section ordering", () => {
  it("normalizes missing, duplicate, and unknown section ids", () => {
    expect(normalizeDetailSectionOrder(["budget", "budget", "unknown"])).toEqual([
      "budget",
      "instruments",
      "equation",
      "bias",
    ]);
    expect(normalizeDetailSectionOrder()).toEqual(DETAIL_SECTION_IDS);
  });

  it("moves a dragged section to the target position", () => {
    expect(
      moveDetailSection(["instruments", "equation", "budget"], "budget", "instruments"),
    ).toEqual(["budget", "instruments", "equation", "bias"]);
  });

  it("assigns adjacent order values to a section header and its content", () => {
    const order = ["budget", "instruments", "equation", "bias"];
    expect(detailSectionOrderValue(order, "instruments")).toBe(10);
    expect(detailSectionOrderValue(order, "instruments", 2)).toBe(12);
    expect(detailSectionOrderValue(order, "bias")).toBe(30);
  });

  it("lets the bias section move ahead of the budget tables", () => {
    expect(moveDetailSection(DETAIL_SECTION_IDS, "bias", "budget"))
      .toEqual(["instruments", "equation", "bias", "budget"]);
  });
});
