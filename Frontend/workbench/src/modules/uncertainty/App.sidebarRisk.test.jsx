import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  copyPointBudget,
  getConsecutiveSidebarCellGroup,
  getUutReassignmentPointIds,
  pastePointBudget,
  SidebarPointItem,
} from "./App";

vi.mock("plotly.js-dist", () => ({ default: {} }));

describe("measurement-point value editing", () => {
  test("groups consecutive repeated categorical cells", () => {
    const points = [
      { id: "p1", section: "4.2.11" },
      { id: "p2", section: "4.2.11" },
      { id: "p3", section: "4.2.12" },
    ];

    expect(
      getConsecutiveSidebarCellGroup(points, 0, (point) => point.section),
    ).toEqual({ isStart: true, span: 2, pointIds: ["p1", "p2"] });
    expect(
      getConsecutiveSidebarCellGroup(points, 1, (point) => point.section),
    ).toEqual({ isStart: false, span: 2, pointIds: ["p1", "p2"] });
  });

  test("copies and replaces only uncertainty-budget fields", () => {
    const source = {
      id: "source",
      components: [{ id: "component-1", name: "Repeatability" }],
      tmdeTolerances: [{ id: "tmde-1" }],
      inputCorrelations: { a: { b: 0.5 } },
      equationString: "a+b",
    };
    const target = {
      id: "target",
      components: [{ id: "old" }],
      coverageFactorMode: "manual",
      equationString: "x*y",
      testPointInfo: { parameter: { value: 10, unit: "V" } },
    };

    const budget = copyPointBudget(source);
    const pasted = pastePointBudget(target, budget);

    expect(pasted.components).toEqual(source.components);
    expect(pasted.components).not.toBe(source.components);
    expect(pasted.tmdeTolerances).toEqual(source.tmdeTolerances);
    expect(pasted.inputCorrelations).toEqual(source.inputCorrelations);
    expect(pasted).not.toHaveProperty("coverageFactorMode");
    expect(pasted.equationString).toBe("x*y");
    expect(pasted.testPointInfo).toEqual(target.testPointInfo);
  });

  test("opens the simplified UUT cell on demand without exposing database ids", async () => {
    const onUutChange = vi.fn();
    render(
      <SidebarPointItem
        point={{ id: "point-uut", testPointInfo: { parameter: { value: 1, unit: "V" } } }}
        uutName="Bench DMM"
        currentUutId="uut-1"
        uutOptions={[
          { id: "uut-1", label: "Bench DMM" },
          { id: "uut-2", label: "Backup DMM" },
        ]}
        onUutChange={onUutChange}
        isSelected
        onSelect={vi.fn()}
        onSave={vi.fn()}
        visibleColumns={{ uut: true }}
      />,
    );

    expect(screen.queryByRole("listbox", { name: "UUT" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "UUT" }));
    const list = await screen.findByRole("listbox", { name: "UUT" });
    expect(list.querySelector("small")).toBeNull();
    fireEvent.click(within(list).getByRole("option", { name: "Backup DMM" }));
    expect(onUutChange).toHaveBeenCalledWith("uut-2");
  });

  test("reassigns all selected point rows from a selected UUT cell", () => {
    expect(
      getUutReassignmentPointIds({
        selectedPointIds: ["p2", "p3"],
        currentPointId: "p2",
      }),
    ).toEqual(["p2", "p3"]);
    expect(
      getUutReassignmentPointIds({
        selectedPointIds: ["p2", "p3"],
        currentPointId: "p1",
      }),
    ).toEqual(["p1"]);
  });

  test("does not expose obsolete drag behavior on measurement-point rows", () => {
    const { container } = render(
      <SidebarPointItem
        point={{
          id: "point-not-draggable",
          testPointInfo: { parameter: { value: 25, unit: "psi" } },
        }}
        isSelected={false}
        isActivePoint={false}
        isTableSelected={false}
        onSelect={vi.fn()}
        onSave={vi.fn()}
        visibleColumns={{ value: true }}
      />,
    );

    expect(container.querySelector(".point-grid-item")).not.toHaveAttribute(
      "draggable",
    );
  });

  test("selects an unselected point and focuses its value input with one click", () => {
    const onSelect = vi.fn();
    render(
      <SidebarPointItem
        point={{
          id: "point-inline-value",
          testPointInfo: { parameter: { value: 25, unit: "psi" } },
        }}
        isSelected={false}
        isActivePoint={false}
        isTableSelected={false}
        onSelect={onSelect}
        onSave={vi.fn()}
        visibleColumns={{
          section: false,
          value: true,
          qualifier: false,
          tolerance: false,
          lowLimit: false,
          highLimit: false,
          standardUncertainty: false,
          measurementUncertainty: false,
          tmdeLow: false,
          tmdeHigh: false,
          pfa: false,
          pfr: false,
          tur: false,
          tar: false,
        }}
      />,
    );

    fireEvent.click(screen.getByTitle("25 psi"));

    expect(onSelect).toHaveBeenCalledOnce();
    const input = document.querySelector(".sidebar-inline-input.value");
    expect(input).toHaveValue("25");
    expect(input).toHaveFocus();
  });

  test("advances value entry after Enter commits the current point", async () => {
    const onSave = vi.fn();
    const onAdvanceValue = vi.fn();
    render(
      <SidebarPointItem
        point={{
          id: "point-enter",
          testPointInfo: { parameter: { value: "", unit: "V" } },
        }}
        isSelected
        onSelect={vi.fn()}
        onSave={onSave}
        onAdvanceValue={onAdvanceValue}
        visibleColumns={{ value: true }}
      />,
    );

    fireEvent.click(document.querySelector(".point-value"));
    const input = document.querySelector(".sidebar-inline-input.value");
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        testPointInfo: expect.objectContaining({
          parameter: expect.objectContaining({ value: "10" }),
        }),
      }),
    );
    await waitFor(() => expect(onAdvanceValue).toHaveBeenCalledOnce());
  });

  test("opens an already-mounted blank row when value focus advances", async () => {
    const common = {
      point: {
        id: "point-precreated",
        testPointInfo: { parameter: { value: "", unit: "V" } },
      },
      isSelected: false,
      onSelect: vi.fn(),
      onSave: vi.fn(),
      onAutoEditConsumed: vi.fn(),
      visibleColumns: { value: true },
    };
    const { rerender } = render(
      <SidebarPointItem {...common} autoEditValue={false} />,
    );

    rerender(<SidebarPointItem {...common} autoEditValue />);

    await waitFor(() =>
      expect(document.querySelector(".sidebar-inline-input.value")).toHaveFocus(),
    );
    expect(common.onAutoEditConsumed).toHaveBeenCalledOnce();
  });
});

describe("measurement-point Risk 8 metric interactions", () => {
  test("re-evaluates metric colors against the live risk requirements", () => {
    const common = {
      point: {
        id: "point-thresholds",
        testPointInfo: { parameter: { value: 1, unit: "V" } },
        riskMetrics: { pfa: 1.5, pfr: 1.6, tur: 3, tar: 3.1 },
      },
      isSelected: true,
      isActivePoint: true,
      isTableSelected: false,
      onSelect: vi.fn(),
      onSave: vi.fn(),
      visibleColumns: {
        section: false, value: false, tolerance: false, lowLimit: false,
        highLimit: false, standardUncertainty: false, measurementUncertainty: false,
        tmdeLow: false, tmdeHigh: false, pfa: true, pfr: true, tur: true, tar: true,
      },
    };
    const { rerender } = render(
      <SidebarPointItem {...common} riskRequirements={{ reqPFA: 2, neededTUR: 3 }} />,
    );
    expect(screen.getByTitle("1.5")).toHaveStyle({ color: "var(--status-good)" });
    expect(screen.getByTitle("3")).toHaveStyle({ color: "var(--status-good)" });

    rerender(<SidebarPointItem {...common} riskRequirements={{ reqPFA: 1, neededTUR: 4 }} />);
    expect(screen.getByTitle("1.5")).toHaveStyle({ color: "var(--status-warning)" });
    expect(screen.getByTitle("1.6")).toHaveStyle({ color: "var(--status-warning)" });
    expect(screen.getByTitle("3")).toHaveStyle({ color: "var(--status-warning)" });
    expect(screen.getByTitle("3.1")).toHaveStyle({ color: "var(--status-warning)" });
  });

  test("does not show a Risk 8 badge and Ctrl-click requests the PFA breakdown", () => {
    const onSelect = vi.fn();
    const onShowRiskBreakdown = vi.fn();
    render(
      <SidebarPointItem
        point={{
          id: "point-1",
          testPointInfo: { parameter: { value: 2, unit: "V" } },
          riskMetrics: {
            riskMethod: "risk8-single-sided-known",
            pfa: 0.11,
            pfr: 0.12,
          },
        }}
        isSelected
        isActivePoint
        isTableSelected={false}
        onSelect={onSelect}
        onSave={vi.fn()}
        onShowRiskBreakdown={onShowRiskBreakdown}
        visibleColumns={{
          section: false,
          value: false,
          tolerance: false,
          lowLimit: false,
          highLimit: false,
          standardUncertainty: false,
          measurementUncertainty: false,
          tmdeLow: false,
          tmdeHigh: false,
          pfa: true,
          pfr: true,
          tur: false,
          tar: false,
          gbPfa: false,
          gbPfr: false,
          gbMult: false,
          gbLow: false,
          gbHigh: false,
          gbCalInt: false,
          noGbCalInt: false,
          noGbMeasRel: false,
        }}
      />,
    );

    expect(screen.queryByText("Risk 8")).not.toBeInTheDocument();
    const pfa = screen.getByTitle("0.11");
    fireEvent.click(pfa, { ctrlKey: true });

    expect(onSelect).toHaveBeenCalledWith({
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(onShowRiskBreakdown).toHaveBeenCalledWith("pfa");

    fireEvent.click(screen.getByTitle("0.12"), {
      ctrlKey: true,
    });
    expect(onShowRiskBreakdown).toHaveBeenNthCalledWith(2, "pfr");
  });

  test("renders the complete workbook risk and mitigation result set", () => {
    const onShowRiskBreakdown = vi.fn();
    render(
      <SidebarPointItem
        point={{
          id: "point-parity",
          testPointInfo: { parameter: { value: 25, unit: "psi" } },
          riskMetrics: {
            observedReop: 84.18,
            pfa: 2.35,
            pfr: 3.86,
            maxReop: 100,
            trueReop: 85.69,
            gbMult: 98.47,
            gbLow: 0.04978,
            gbHigh: 0.05025,
            gbPfa: 2,
            gbPfr: 4.18,
            gbCalInt: 5.40849,
            gbMeasRel: 86.47,
            noGbPfa: 2.01,
            noGbPfr: 3.61,
            noGbCalInt: 4.69473132,
            noGbMeasRel: 88.27,
          },
        }}
        isSelected
        isActivePoint
        isTableSelected={false}
        onSelect={vi.fn()}
        onSave={vi.fn()}
        onShowRiskBreakdown={onShowRiskBreakdown}
        visibleColumns={{
          section: false,
          value: false,
          qualifier: false,
          tolerance: false,
          lowLimit: false,
          highLimit: false,
          standardUncertainty: false,
          measurementUncertainty: false,
          tmdeLow: false,
          tmdeHigh: false,
          pfa: true,
          pfr: true,
          tur: false,
          tar: false,
          observedReop: true,
          maxReop: true,
          trueReop: true,
          gbPfa: true,
          gbPfr: true,
          gbMult: true,
          gbLow: true,
          gbHigh: true,
          gbCalInt: true,
          gbMeasRel: true,
          noGbPfa: true,
          noGbPfr: true,
          noGbCalInt: true,
          noGbMeasRel: true,
        }}
      />,
    );

    expect(screen.getByTitle("84.18")).toHaveTextContent("84.18%");
    expect(screen.getByTitle("100")).toHaveTextContent("100.00%");
    expect(screen.getByTitle("85.69")).toHaveTextContent("85.69%");
    expect(screen.getByTitle("86.47")).toHaveTextContent("86.47%");
    expect(screen.getByTitle("5.40849")).toHaveTextContent(
      "5.40849",
    );
    expect(screen.getByTitle("2.01")).toHaveTextContent("2.01%");
    expect(screen.getByTitle("3.61")).toHaveTextContent("3.61%");
    expect(screen.getByTitle("4.69473132")).toHaveTextContent(
      "4.69473132",
    );
    expect(screen.getByTitle("88.27")).toHaveTextContent("88.27%");

    const interactiveMetrics = [
      ["84.18", "observedreop"],
      ["100", "maxreop"],
      ["85.69", "truereop"],
      ["86.47", "gbmeasrel"],
      ["2.01", "nogbpfa"],
      ["3.61", "nogbpfr"],
      ["4.69473132", "calint"],
      ["88.27", "measrel"],
    ];
    interactiveMetrics.forEach(([titlePattern, modalType]) => {
      fireEvent.click(screen.getByTitle(titlePattern), { ctrlKey: true });
      expect(onShowRiskBreakdown).toHaveBeenLastCalledWith(modalType);
    });
  });

  test("hover titles retain full precision while cells stay compact", () => {
    render(
      <SidebarPointItem
        point={{
          id: "point-precision",
          testPointInfo: { parameter: { value: 1, unit: "V" } },
          combined_uncertainty_absolute_base: 0.00999981624765,
          expanded_uncertainty_absolute_base: 0.0199996324953,
          riskMetrics: { tur: 3.141592653589793, pfa: 0.123456789012345 },
        }}
        isSelected
        isActivePoint
        isTableSelected={false}
        onSelect={vi.fn()}
        onSave={vi.fn()}
        visibleColumns={{
          value: false,
          standardUncertainty: true,
          measurementUncertainty: true,
          tur: true,
          pfa: true,
        }}
      />,
    );

    expect(screen.getByTitle("0.00999981624765"))
      .toHaveTextContent("0.01000");
    expect(screen.getByTitle("0.0199996324953"))
      .toHaveTextContent("0.02000");
    expect(screen.getByTitle("3.141592653589793")).toHaveTextContent("3.14");
    expect(screen.getByTitle("0.123456789012345")).toHaveTextContent("0.12%");
  });
});
