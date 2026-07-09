import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import UncertaintyBudgetTable from "./UncertaintyBudgetTable";

// ContributionPlot draws with the real Plotly bundle; stub it so the budget
// table tests stay fast and deterministic (they only assert the graph mounts).
vi.mock("plotly.js-dist", () => ({
  default: {
    react: vi.fn(),
    purge: vi.fn(),
    Plots: { resize: vi.fn() },
    Icons: { camera: { width: 1000, path: "" } },
    toImage: vi.fn(),
  },
}));

beforeAll(() => {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const renderDirectBudget = (overrides = {}) => {
  const props = {
    components: [
      {
        id: "measurement-equation",
        name: "Measurement Equation Uncertainty",
        sourcePointLabel: "Measurement Equation",
        type: "B",
        value: 1,
        unit: "in-oz",
        distribution: "Other (Std. Unc.)",
        isCore: true,
      },
    ],
    calcResults: {
      combined_uncertainty: 1,
      effective_dof: Infinity,
      k_value: 2,
      expanded_uncertainty: 2,
    },
    referencePoint: { name: "Torque", unit: "in-oz" },
    uncertaintyConfidence: 95,
    measurementType: "direct",
    hasTmde: true,
    onAddManualComponent: vi.fn(),
    onOpenRepeatability: vi.fn(),
    ...overrides,
  };

  const view = render(<UncertaintyBudgetTable {...props} />);
  return { ...props, ...view };
};

describe("UncertaintyBudgetTable direct budget actions", () => {
  it("explains distribution deviations with spec and current values", () => {
    renderDirectBudget({
      components: [
        {
          id: "accuracy",
          name: "DMM Accuracy",
          sourcePointLabel: "10 V",
          type: "B",
          value: 1,
          unit: "V",
          distribution: "Normal",
          distributionDivisor: "2",
          isCore: true,
          specOverride: true,
          specBaseline: {
            distributionOverridden: true,
            distributionLabel: "Rectangular",
          },
        },
      ],
    });

    expect(
      screen.getByTitle(
        /Distribution changed from Rectangular \(spec\) to Normal \(current\)/i,
      ),
    ).toBeInTheDocument();
  });

  it("adds budget components through one 'Add component to budget' button", () => {
    const onAddTmdeToBudget = vi.fn();
    renderDirectBudget({ onAddTmdeToBudget });

    // The separate settings cog is gone; Add / Repeatability / manual component
    // now live in the single Add menu (owned by the panel picker).
    expect(
      screen.queryByTitle("Settings for Torque Uncertainty Budget"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Add component to budget" }),
    );
    expect(onAddTmdeToBudget).toHaveBeenCalledOnce();
    // The scope tells that menu it may offer a manual component and repeatability
    // for this direct final budget.
    expect(onAddTmdeToBudget.mock.calls[0][0]).toMatchObject({
      kind: "final",
      canAddManual: true,
      canAddRepeatability: true,
    });
  });

  it("renders uncertainty at a fixed precision without nominal table data", () => {
    renderDirectBudget({
      components: [
        {
          id: "measurement-equation",
          name: "Measurement Equation Uncertainty",
          sourcePointLabel: "Nominal 12.34567",
          type: "B",
          value: 1.234567,
          unit: "V",
          distribution: "Other (Std. Unc.)",
          isCore: true,
        },
      ],
      referencePoint: { name: "Voltage", unit: "V" },
    });

    expect(screen.getByText("1.235 V")).toBeInTheDocument();
    expect(screen.queryByText("Nominal 12.34567")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Source / Nominal" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "DOF" }),
    ).not.toBeInTheDocument();

    // Sig figs are no longer user-configurable — no per-table settings cog.
    expect(
      screen.queryByTitle("Settings for Voltage Uncertainty Budget"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Uncertainty Sig Figs"),
    ).not.toBeInTheDocument();
  });

  it("shows clean instrument descriptions and DOF only for Type A rows", () => {
    renderDirectBudget({
      components: [
        {
          id: "tmde-accuracy",
          name: "Mock DMM - Accuracy",
          sourceDisplayName: "Cox Flowmeter CPT-84-AN-C-C02",
          sourcePointLabel: "10 V",
          type: "B",
          value: 1,
          unit: "V",
          distribution: "Normal",
          distributionDivisor: "2",
          sourceTmdeId: "tmde-1",
        },
        {
          id: "repeatability",
          name: "Repeatability",
          sourcePointLabel: "N=10",
          type: "A",
          value: 0.2,
          unit: "V",
          value_native: 0.2,
          unit_native: "V",
          distribution: "Normal",
          dof: 9,
        },
      ],
    });

    expect(screen.getByText("Cox Flowmeter CPT-84-AN-C-C02")).toBeInTheDocument();
    expect(screen.queryByText("Mock DMM - Accuracy")).not.toBeInTheDocument();
    expect(screen.queryByText("10 V")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "DOF" })).toBeInTheDocument();
    expect(screen.getByText("9.000")).toBeInTheDocument();
  });

  it("renders every budget table at the same fixed precision", () => {
    renderDirectBudget({
      measurementType: "derived",
      referencePoint: { name: "Power", unit: "W" },
      calcResults: {
        calculatedBudgetGroups: [
          {
            id: "voltage-input",
            kind: "input",
            label: "Voltage Uncertainty Budget",
            variableType: "Voltage",
            unit: "V",
            components: [
              {
                id: "voltage-source",
                name: "Voltage source",
                sourcePointLabel: "10 V",
                type: "B",
                value: 1.234567,
                unit: "V",
                distribution: "Other (Std. Unc.)",
                isCore: true,
              },
            ],
            results: {
              combined: 1.234567,
              effective_dof: Infinity,
              k_value: 2,
              expanded: 2.469134,
            },
          },
          {
            id: "current-input",
            kind: "input",
            label: "Current Uncertainty Budget",
            variableType: "Current",
            unit: "A",
            components: [
              {
                id: "current-source",
                name: "Current source",
                sourcePointLabel: "2 A",
                type: "B",
                value: 7.654321,
                unit: "A",
                distribution: "Other (Std. Unc.)",
                isCore: true,
              },
            ],
            results: {
              combined: 7.654321,
              effective_dof: Infinity,
              k_value: 2,
              expanded: 15.308642,
            },
          },
        ],
      },
    });

    expect(screen.getAllByText("1.235 V")).toHaveLength(2);
    expect(screen.getAllByText("7.654 A")).toHaveLength(2);

    // No per-table sig-fig control remains — precision is fixed for every table.
    expect(
      screen.queryByLabelText("Uncertainty Sig Figs"),
    ).not.toBeInTheDocument();
  });

  it("uses empirical Monte Carlo values for the final budget totals", () => {
    renderDirectBudget({
      components: [
        {
          id: "measurement-equation",
          name: "Measurement Equation Uncertainty",
          sourcePointLabel: "Measurement Equation",
          type: "B",
          value: 1,
          unit: "V",
          distribution: "Other (Std. Unc.)",
          isCore: true,
        },
      ],
      calcResults: {
        combined_uncertainty: 1,
        effective_dof: Infinity,
        k_value: 2,
        expanded_uncertainty: 2,
      },
      referencePoint: { name: "Voltage", unit: "V" },
      propagationMode: "montecarlo",
      riskResults: {
        riskMethod: "empirical",
        pfa: 1.1,
        pfr: 2.2,
        tur: 4,
      },
      mcSummary: {
        meanBase: 10,
        uBase: 1.5,
        intervalLowBase: 7,
        intervalHighBase: 14,
      },
    });

    expect(
      screen.getAllByText("Monte Carlo", { selector: ".method-chip" }),
    ).toHaveLength(2);
    expect(screen.getByText("Empirical")).toBeInTheDocument();
    expect(screen.getByText("1.500 V")).toBeInTheDocument();
    expect(screen.getByText("+4.0000 / -3.0000")).toBeInTheDocument();
    expect(
      screen.getByText(/Empirical shortest 95% coverage interval/),
    ).toBeInTheDocument();
  });

  it("shows contribution graph from the bottom display setting", () => {
    const view = renderDirectBudget({
      showContribution: true,
      setShowContribution: vi.fn(),
      components: [
        {
          id: "accuracy",
          name: "DMM Accuracy",
          type: "B",
          value: 10,
          value_native: 0.01,
          unit_native: "V",
          distribution: "Rectangular",
          isCore: true,
        },
      ],
      calcResults: {
        combined_uncertainty: 10,
        effective_dof: Infinity,
        k_value: 2,
        expanded_uncertainty: 20,
        calculatedBudgetComponents: [
          {
            id: "accuracy",
            name: "DMM Accuracy",
            value: 10,
            value_native: 0.01,
          },
        ],
      },
      referencePoint: { name: "Voltage", unit: "V" },
    });

    expect(view.container.querySelector(".bargraph-container")).toBeInTheDocument();
  });

  it("does not show bottom-card sig fig settings", () => {
    renderDirectBudget();

    fireEvent.click(screen.getByTitle("Display settings"));

    expect(screen.getByText("Show contribution")).toBeInTheDocument();
    expect(screen.queryByLabelText("Expanded Unc (U) Sig Figs")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Risk Sig Figs")).not.toBeInTheDocument();
    expect(screen.queryByText("Display Precision")).not.toBeInTheDocument();
  });

  it("keeps instrument-linked Type B distribution read-only in the budget table", () => {
    renderDirectBudget({
      components: [
        {
          id: "instr-typeb",
          name: "Head Pressure",
          type: "B",
          value: 10,
          value_native: 0.01,
          unit_native: "psig",
          distribution: "Rectangular (resolution)",
          distributionDivisor: "3.464",
          typeBSourceId: "typeb-1",
          typeBSourceTmdeId: "tmde-1",
          originalInput: {
            inputMode: "tolerance",
            toleranceLimit: "0.03464",
            errorDistributionDivisor: "3.464",
            unit: "psig",
          },
        },
      ],
    });

    expect(screen.getByText("Head Pressure")).toBeInTheDocument();
    expect(screen.getByText("Rectangular (resolution)")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Edit Component")).not.toBeInTheDocument();
    expect(screen.getByTitle("Remove Component")).toBeInTheDocument();
  });
});
