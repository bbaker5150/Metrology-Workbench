import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SidebarPointItem } from "./App";

vi.mock("plotly.js-dist", () => ({ default: {} }));

describe("measurement-point Risk 8 metric interactions", () => {
  test("re-evaluates metric colors against the live risk requirements", () => {
    const common = {
      point: {
        id: "point-thresholds",
        testPointInfo: { parameter: { value: 1, unit: "V" } },
        riskMetrics: { pfa: 1.5, pfr: 1.5, tur: 3, tar: 3 },
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
    expect(screen.getByTitle(/^PFA/)).toHaveStyle({ color: "var(--status-good)" });
    expect(screen.getByTitle(/^TUR/)).toHaveStyle({ color: "var(--status-good)" });

    rerender(<SidebarPointItem {...common} riskRequirements={{ reqPFA: 1, neededTUR: 4 }} />);
    expect(screen.getByTitle(/^PFA/)).toHaveStyle({ color: "var(--status-warning)" });
    expect(screen.getByTitle(/^PFR/)).toHaveStyle({ color: "var(--status-warning)" });
    expect(screen.getByTitle(/^TUR/)).toHaveStyle({ color: "var(--status-warning)" });
    expect(screen.getByTitle(/^TAR/)).toHaveStyle({ color: "var(--status-warning)" });
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
    const pfa = screen.getByTitle("PFA — Ctrl+click for breakdown");
    fireEvent.click(pfa, { ctrlKey: true });

    expect(onSelect).toHaveBeenCalledWith({
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(onShowRiskBreakdown).toHaveBeenCalledWith("pfa");

    fireEvent.click(screen.getByTitle("PFR — Ctrl+click for breakdown"), {
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
            noGbPfa: 2,
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

    expect(screen.getByTitle("R_REOP at test-point TUR - Ctrl+click for breakdown")).toHaveTextContent("84.18%");
    expect(screen.getByTitle("Maximum R_REOP - Ctrl+click for breakdown")).toHaveTextContent("100.00%");
    expect(screen.getByTitle("R_meas - Ctrl+click for breakdown")).toHaveTextContent("85.69%");
    expect(screen.getByTitle("Targeted R_REOP with GB - Ctrl+click for breakdown")).toHaveTextContent("86.47%");
    expect(screen.getByTitle("Calibration Interval with Guard Banding")).toHaveTextContent(
      "5.40849",
    );
    expect(screen.getByTitle("PFA without GB - Ctrl+click for breakdown")).toHaveTextContent("2.00%");
    expect(screen.getByTitle("PFR without GB - Ctrl+click for breakdown")).toHaveTextContent("3.61%");
    expect(screen.getByTitle("Calibration Interval without Guard Banding - Ctrl+click for breakdown")).toHaveTextContent(
      "4.69473132",
    );
    expect(screen.getByTitle("Targeted R_REOP without GB - Ctrl+click for breakdown")).toHaveTextContent("88.27%");

    const interactiveMetrics = [
      ["R_REOP at test-point TUR - Ctrl+click for breakdown", "observedreop"],
      ["Maximum R_REOP - Ctrl+click for breakdown", "maxreop"],
      ["R_meas - Ctrl+click for breakdown", "truereop"],
      ["Targeted R_REOP with GB - Ctrl+click for breakdown", "gbmeasrel"],
      ["PFA without GB - Ctrl+click for breakdown", "nogbpfa"],
      ["PFR without GB - Ctrl+click for breakdown", "nogbpfr"],
      ["Calibration Interval without Guard Banding - Ctrl+click for breakdown", "calint"],
      ["Targeted R_REOP without GB - Ctrl+click for breakdown", "measrel"],
    ];
    interactiveMetrics.forEach(([title, modalType]) => {
      fireEvent.click(screen.getByTitle(title), { ctrlKey: true });
      expect(onShowRiskBreakdown).toHaveBeenLastCalledWith(modalType);
    });
  });
});
