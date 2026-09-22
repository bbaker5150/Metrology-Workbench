import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import RiskInputTrace from "./RiskInputTrace";
it("shows manual sources, their divisor and the actual signed net-bias calculation", () => {
 const point = { testPointInfo: { parameter: { value: 10, unit: "V" } }, uutBias: { mode: "override", value: .2, unit: "V" }, measurementBias: { mode: "manual", value: -.1, unit: "V" }, components: [] };
 render(<RiskInputTrace modalType="pfa" results={{ nativeUnit: "V", nominalValue: 10, LLow: 9, LUp: 11, uCal: .05, expandedUncertainty: .1 }} trace={{ point, session: {}, calculation: { calculatedBudgetGroups: [{ id: "final", label: "Final", unit: "V", components: [{ id: "manual", name: "Connector repeatability", isManual: true, value_native: .05, unit_native: "V", distribution: "Normal", distributionDivisor: "2" }], results: { combined: .05, expanded: .1, k_value: 2 } }] } }} />);
 expect(screen.getByText("Connector repeatability")).toBeInTheDocument();
 expect(screen.getByText("Normal / 2")).toBeInTheDocument();
 expect(screen.getByText(/entered net system bias replaces/)).toBeInTheDocument();
 expect(screen.getByText(/observed mean = UUT mean/)).toHaveTextContent("10.10000 V");
 expect(screen.getByText(/Combined u =/)).toHaveTextContent("expanded U = k × u = 0.1000000 V");
});
it("explains why unknown-measurement models do not use retained bias values", () => {
 render(<RiskInputTrace modalType="pfa" results={{ riskMethod: "risk8-pfa-boundary", nativeUnit: "V" }} trace={{ point: { testPointInfo: { parameter: { unit: "V" } }, uutTolerance: { singleSided: { measurement: "unknown" } } }, session: {} }} />);
 expect(screen.getByText(/model ignores UUT and calibration biases/)).toBeInTheDocument();
 expect(screen.queryByText(/observed mean = UUT mean/)).not.toBeInTheDocument();
});
