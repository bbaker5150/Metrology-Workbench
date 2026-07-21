import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import RiskBreakdownModal from "./RiskBreakdownModals";
import {
  computeKnownAsymmetricRisk8,
  computeKnownMeasurementRisk8,
  computeKnownTwoSidedRisk8,
  toKnownMeasurementSummary,
} from "../../../../utils/risk8/knownMeasurementRisk8";

const engineResult = computeKnownMeasurementRisk8({
  tolerance: {
    singleSided: {
      direction: "low",
      limit: 9,
      measurement: "known",
      unit: "V",
    },
  },
  nominal: 10,
  riskAverage: 10,
  expandedUncertaintyNative: 0.25,
  tur: 4,
  assumedReop: 0.95,
  requiredReop: 0.9,
  reqPFA: 0.02,
  initialGB: 1,
  originalInterval: 12,
});

const results = {
  ...toKnownMeasurementSummary(engineResult),
  nativeUnit: "V",
  nominalValue: 10,
  LLow: 9,
  LUp: undefined,
  riskAverage: 10,
  expandedUncertainty: 0.25,
  tar: 10,
  tmdeToleranceSpan: 0.2,
  gbInputs: {
    reqPFA: 0.02,
    measRelTarget: 0.9,
    measrelCalcAssumed: 0.95,
    calibrationInt: 12,
    initialGB: 1,
    safeRes: 0,
  },
  risk8: {
    meta: engineResult.meta,
    input: engineResult.input,
    out: engineResult.out,
    diagnostics: engineResult.diagnostics,
  },
};

describe("Risk 8.0 breakdown modal", () => {
  test("uses the Risk 8 Type 2 calculation chain for asymmetric PFA", () => {
    const asymmetricEngine = computeKnownAsymmetricRisk8({
      nominal: 20,
      riskAverage: 20,
      lowerLimit: 19,
      upperLimit: 25,
      expandedUncertaintyNative: 1.13159879,
      tur: 2.65,
      assumedReop: 0.85,
      requiredReop: 0.85,
      turNeeded: 4,
      reqPFA: 0.02,
      initialGB: 1,
      originalInterval: 12,
      resolution: 0.01,
    });
    const asymmetricResults = {
      ...toKnownMeasurementSummary(asymmetricEngine),
      nativeUnit: "V",
      nominalValue: 20,
      LLow: 19,
      LUp: 25,
      riskAverage: 20,
      expandedUncertainty: 1.13159879,
      tar: 3,
      tmdeToleranceSpan: 2,
      gbInputs: { reqPFA: 0.02, measRelTarget: 0.85 },
      risk8: {
        meta: asymmetricEngine.meta,
        input: asymmetricEngine.input,
        out: asymmetricEngine.out,
        diagnostics: asymmetricEngine.diagnostics,
      },
    };

    render(
      <RiskBreakdownModal
        isOpen
        onClose={vi.fn()}
        modalType="pfa"
        data={{ results: asymmetricResults, inputs: {} }}
      />,
    );

    expect(
      screen.getByText("Method: Risk 8.0 Type 2 asymmetric measurement known."),
    ).toBeInTheDocument();
    expect(screen.getByText("Normalized Two-Sided Model")).toBeInTheDocument();
    expect(
      screen.getByText("Core Risk 8.0 Type 2: decision probabilities"),
    ).toBeInTheDocument();
  });

  test("uses the Risk 8 calculation details for single-sided PFA", () => {
    render(
      <RiskBreakdownModal
        isOpen
        onClose={vi.fn()}
        modalType="pfa"
        data={{ results, inputs: {} }}
      />,
    );

    expect(
      screen.getByText("Risk 8.0 Probability of False Accept Breakdown"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("risk8-breakdown")).toBeInTheDocument();
    expect(
      screen.getByText("Method: Risk 8.0 single-sided measurement known."),
    ).toBeInTheDocument();
    expect(screen.getByText("Normalized Single-Sided Model")).toBeInTheDocument();
    expect(
      screen.getByText("Core Risk 8.0: normalized calibration uncertainty"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Core Risk 8.0: recover the UUT population spread"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Core Risk 8.0: classify the probability regions"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/bivariate-normal integrals/i)).not.toBeInTheDocument();
  });

  test("explains that TAR is upstream rather than a Risk 8 output", () => {
    render(
      <RiskBreakdownModal
        isOpen
        onClose={vi.fn()}
        modalType="tar"
        data={{ results, inputs: {} }}
      />,
    );

    expect(
      screen.getByText(/Risk 8.0 consumes TUR.*does not recalculate TAR/i),
    ).toBeInTheDocument();
  });

  test("shows the substituted exponential interval equation", () => {
    render(
      <RiskBreakdownModal
        isOpen
        onClose={vi.fn()}
        modalType="gbcalint"
        data={{ results, inputs: {} }}
      />,
    );

    expect(
      screen.getByText("E1 exponential interval calculation"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Observed reliability is used for exponential reliability decay/i),
    ).toBeInTheDocument();
  });

  test("renders every workbook risk and mitigation metric breakdown", () => {
    const metricExpectations = {
      tur: "Test Uncertainty Ratio",
      tar: "Test Accuracy Ratio",
      pfa: "Probability of False Accept",
      pfr: "Probability of False Reject",
      observedreop: "Observed Reliability at Test-Point TUR",
      maxreop: "Maximum Achievable Reliability",
      truereop: "True UUT Reliability",
      gbmult: "Guardband Multiplier",
      gblow: "Lower Guardband Limit",
      gbhigh: "Upper Guardband Limit",
      gbpfa: "PFA with Guardbanding",
      gbpfr: "PFR with Guardbanding",
      gbcalint: "Calibration Interval with Guardbanding",
      gbmeasrel: "Targeted Reliability with Guardbanding",
      nogbpfa: "PFA without Guardbanding",
      nogbpfr: "PFR without Guardbanding",
      calint: "Calibration Interval without Guardbanding",
      measrel: "Measurement Reliability without Guardbanding",
    };

    Object.entries(metricExpectations).forEach(([modalType, expectedText]) => {
      const { unmount } = render(
        <RiskBreakdownModal
          isOpen
          onClose={vi.fn()}
          modalType={modalType}
          data={{ results, inputs: {} }}
        />,
      );

      expect(screen.getAllByText(expectedText).length).toBeGreaterThan(0);
      expect(screen.getByTestId("risk8-breakdown")).toBeInTheDocument();
      unmount();
    });
  });

  test("uses Risk 8 details for symmetric guardband PFA without legacy fields", () => {
    const symmetricEngine = computeKnownTwoSidedRisk8({
      nominal: 25,
      riskAverage: 25,
      lowerLimit: 24.8,
      upperLimit: 25.2,
      expandedUncertaintyNative: 0.063255766,
      tur: 3.16,
      assumedReop: 0.85,
      requiredReop: 0.85,
      turNeeded: 4,
      reqPFA: 0.02,
      initialGB: 1,
      originalInterval: 12,
      resolution: 0.001,
    });
    const symmetricResults = {
      ...toKnownMeasurementSummary(symmetricEngine),
      nativeUnit: "in",
      nominalValue: 25,
      LLow: 24.8,
      LUp: 25.2,
      riskAverage: 25,
      expandedUncertainty: 0.063255766,
      gbInputs: {
        reqPFA: 0.02,
        measRelTarget: 0.85,
        calibrationInt: 12,
      },
      gbResults: {
        GBPFA: toKnownMeasurementSummary(symmetricEngine).gbPfa,
      },
      risk8: {
        meta: symmetricEngine.meta,
        input: symmetricEngine.input,
        out: symmetricEngine.out,
        diagnostics: symmetricEngine.diagnostics,
      },
    };

    render(
      <RiskBreakdownModal
        isOpen
        onClose={vi.fn()}
        modalType="gbpfa"
        data={{ results: symmetricResults, inputs: {} }}
      />,
    );

    expect(
      screen.getByText("Method: Risk 8.0 two-sided symmetric measurement known."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Recommended guardband: decision probabilities"),
    ).toBeInTheDocument();
  });

  test("older saved guardband results fall back safely when intermediates are absent", () => {
    const legacyResults = {
      nativeUnit: "V",
      gbPfa: 2,
      gbPfr: 3.21,
      gbResults: { GBPFA: 2, GBPFR: 3.21 },
    };

    const { unmount } = render(
      <RiskBreakdownModal
        isOpen
        onClose={vi.fn()}
        modalType="gbpfa"
        data={{ results: legacyResults, inputs: {} }}
      />,
    );
    expect(screen.getByText(/Detailed legacy bivariate intermediates were not stored/i)).toBeInTheDocument();
    expect(screen.getByText(/PFA with guardbanding: 2.0000%/i)).toBeInTheDocument();
    unmount();

    render(
      <RiskBreakdownModal
        isOpen
        onClose={vi.fn()}
        modalType="gbpfr"
        data={{ results: legacyResults, inputs: {} }}
      />,
    );
    expect(screen.getByText(/PFR with guardbanding: 3.2100%/i)).toBeInTheDocument();
  });
});
