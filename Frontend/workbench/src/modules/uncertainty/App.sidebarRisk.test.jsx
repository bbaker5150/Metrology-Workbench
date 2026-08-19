import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SidebarPointItem } from "./App";

vi.mock("plotly.js-dist", () => ({ default: {} }));

describe("measurement-point value editing", () => {
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

    fireEvent.click(screen.getByTitle(/^Value: 25 psi/));

    expect(onSelect).toHaveBeenCalledOnce();
    const input = document.querySelector(".sidebar-inline-input.value");
    expect(input).toHaveValue("25");
    expect(input).toHaveFocus();
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
      .toHaveTextContent("0.01000 V");
    expect(screen.getByTitle("0.0199996324953"))
      .toHaveTextContent("0.02000 V");
    expect(screen.getByTitle("3.141592653589793")).toHaveTextContent("3.14");
    expect(screen.getByTitle("0.123456789012345")).toHaveTextContent("0.12%");
  });
});
