import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UncertaintyBudgetTable from "./UncertaintyBudgetTable";

const contributionShares = (container) =>
  Object.fromEntries(
    Array.from(container.querySelectorAll("[data-contribution-label]")).map(
      (row) => [
        row.dataset.contributionLabel,
        Number(row.dataset.contributionPercentage),
      ],
    ),
  );

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
  it("keeps manually added components at the bottom of the budget", () => {
    const { container } = renderDirectBudget({
      components: [
        {
          id: "manual-saved",
          name: "Operator influence",
          type: "B",
          value: 0.1,
          value_native: 0.1,
          unit_native: "V",
          distribution: "Rectangular",
          distributionDivisor: "1.732",
          isManual: true,
          isInlineManual: true,
          inlineDraft: false,
          originalInput: {
            inputMode: "standard",
            standardUncertainty: "0.1",
            unit: "V",
          },
        },
        {
          id: "uut-resolution",
          name: "UUT Resolution",
          type: "B",
          value: 0.02,
          value_native: 0.02,
          unit_native: "V",
          distribution: "Rectangular (resolution)",
          isResolution: true,
        },
      ],
      referencePoint: { name: "Voltage", value: 10, unit: "V" },
    });

    const rows = Array.from(
      container.querySelectorAll(".uncertainty-budget-table tbody > tr"),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("UUT Resolution");
    expect(rows[1]).toHaveTextContent("Operator influence");
  });

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
    expect(onAddTmdeToBudget.mock.calls[0][0]).not.toHaveProperty(
      "canAddPropagation",
    );
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

    expect(screen.getAllByText("1.235 V")).toHaveLength(1);
    expect(screen.getAllByText("7.654 A")).toHaveLength(1);
    expect(screen.getByText("1.234567 V")).toBeInTheDocument();
    expect(screen.getByText("7.654321 A")).toBeInTheDocument();

    // No per-table sig-fig control remains — precision is fixed for every table.
    expect(
      screen.queryByLabelText("Uncertainty Sig Figs"),
    ).not.toBeInTheDocument();
  });

  it("switches derived propagation methods and shows the fixed Type B approximation", () => {
    const onTrials = vi.fn();
    const onMethod = vi.fn();
    renderDirectBudget({
      measurementType: "derived",
      calcResults: {
        calculatedBudgetGroups: [
          {
            id: "final_budget",
            kind: "final",
            label: "Voltage Uncertainty Budget",
            unit: "V",
            components: [
              {
                id: "risk8_monte_carlo_uncertainty",
                name: "Monte Carlo Approximation",
                type: "B",
                value_native: 1.5,
                unit_native: "V",
                dof: 24,
                distribution: "Standard uncertainty (k=1)",
                distributionDivisor: 1,
                isCore: true,
                isPropagationSummary: true,
                propagationMethod: "montecarlo",
                trials: 25000,
              },
            ],
            results: {
              combined: 1.5,
              effective_dof: 24,
              k_value: 2.064,
              expanded: 3.096,
            },
          },
        ],
      },
      referencePoint: { name: "Voltage", unit: "V" },
      budgetPropagationMethod: "montecarlo",
      monteCarloTrials: 25000,
      onMonteCarloTrialsChange: onTrials,
      onPropagationMethodChange: onMethod,
    });

    expect(screen.queryByText("Risk 8.0 Monte Carlo")).not.toBeInTheDocument();
    expect(screen.getByText("Monte Carlo Approximation")).toBeInTheDocument();
    expect(screen.getByText("Standard uncertainty (k=1)")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByLabelText("Use Monte Carlo approximation")).toBeChecked();
    expect(screen.getByLabelText("Monte Carlo trials")).toHaveValue(25000);
    expect(screen.getByLabelText("Monte Carlo trials")).toBeEnabled();
    expect(screen.getAllByText("24.00")).toHaveLength(2);
    // k=1 means the approximation's tolerance limit and standard uncertainty
    // are intentionally identical. Results cards retain calculation precision
    // separately from the table's fixed four-significant-digit formatting.
    expect(screen.getAllByText("1.500 V")).toHaveLength(2);
    expect(screen.getByText("1.5 V")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Monte Carlo trials"), {
      target: { value: "50000" },
    });
    fireEvent.blur(screen.getByLabelText("Monte Carlo trials"));
    expect(onTrials).toHaveBeenCalledWith(50000);
    fireEvent.click(screen.getByLabelText("Use Monte Carlo approximation"));
    expect(onMethod).toHaveBeenCalledWith("equation");
    expect(
      screen.queryByRole("button", { name: /Remove Monte Carlo/i }),
    ).not.toBeInTheDocument();
  });

  it("defaults a newly enabled Monte Carlo method to 10,000 trials", () => {
    renderDirectBudget({
      measurementType: "derived",
      budgetPropagationMethod: "montecarlo",
      onPropagationMethodChange: vi.fn(),
    });

    expect(screen.getByLabelText("Monte Carlo trials")).toHaveValue(10000);
    expect(screen.getByLabelText("Monte Carlo trials")).toBeEnabled();
  });

  it("shows the true expanded result and simplified derived headings", () => {
    renderDirectBudget({
      measurementType: "derived",
      referencePoint: { name: "Torque", unit: "in-oz" },
      calcResults: {
        calculatedBudgetGroups: [
          {
            id: "length-input",
            kind: "input",
            label: "Length (l) Uncertainty Budget",
            variableType: "Length",
            unit: "in",
            components: [],
            results: {
              combined: 0.00102,
              effective_dof: Infinity,
              k_value: 1.96,
              expanded: 0.00102 * 1.96,
            },
          },
        ],
      },
    });

    expect(
      screen.queryByRole("heading", { name: "Uncertainty Budget", level: 3 }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Length Uncertainty Budget", level: 4 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Length \(l\) Uncertainty Budget/i)).not.toBeInTheDocument();
    expect(screen.getByText("0.0019992 in")).toBeInTheDocument();
    expect(screen.queryByText("0.002000 in")).not.toBeInTheDocument();
  });

  it("keeps the Monte Carlo trial count visible but disabled for Taylor Series", () => {
    renderDirectBudget({
      measurementType: "derived",
      budgetPropagationMethod: "linear",
      monteCarloTrials: 25000,
      onMonteCarloTrialsChange: vi.fn(),
      onPropagationMethodChange: vi.fn(),
    });

    const trials = screen.getByLabelText("Monte Carlo trials");
    expect(trials).toHaveValue(25000);
    expect(trials).toBeDisabled();
    expect(trials.closest(".budget-mc-trials")).toHaveClass("is-disabled");
  });

  it("does not offer Monte Carlo for direct budgets", () => {
    renderDirectBudget({
      measurementType: "direct",
      budgetPropagationMethod: "montecarlo",
      monteCarloTrials: 25000,
      onPropagationMethodChange: vi.fn(),
      onMonteCarloTrialsChange: vi.fn(),
    });

    expect(
      screen.queryByLabelText("Use Monte Carlo approximation"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Monte Carlo trials")).not.toBeInTheDocument();
    expect(screen.queryByText("Taylor Series")).not.toBeInTheDocument();
  });

  it("shows contribution graph from the bottom display setting", async () => {
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
          {
            id: "resolution",
            name: "UUT Resolution",
            value: 20,
            value_native: 0.02,
          },
        ],
      },
      referencePoint: { name: "Voltage", unit: "V" },
    });

    await waitFor(() => {
      expect(view.container.querySelector(".bargraph-container")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Hide contribution chart" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(contributionShares(view.container)).toEqual({
      "UUT Resolution": 80,
      "DMM Accuracy": 20,
    });
    expect(
      view.container.querySelector('[data-contribution-label="DMM Accuracy"]'),
    ).toHaveAttribute("title", expect.stringContaining("Variance contribution"));
  });

  it("updates an open contribution graph when the calculated budget changes", async () => {
    const baseProps = {
      components: [],
      showContribution: true,
      setShowContribution: vi.fn(),
      measurementType: "direct",
      referencePoint: { name: "Voltage", unit: "V" },
    };
    const makeResults = (accuracy) => ({
      combined_uncertainty: 1,
      effective_dof: Infinity,
      k_value: 2,
      expanded_uncertainty: 2,
      calculatedBudgetComponents: [
        {
          id: "accuracy",
          name: "DMM Accuracy",
          value_native: accuracy,
        },
        {
          id: "resolution",
          name: "UUT Resolution",
          value_native: 0.02,
        },
      ],
    });

    const view = render(
      <UncertaintyBudgetTable {...baseProps} calcResults={makeResults(0.01)} />,
    );
    await waitFor(() =>
      expect(contributionShares(view.container)).toEqual({
        "UUT Resolution": 80,
        "DMM Accuracy": 20,
      }),
    );

    view.rerender(
      <UncertaintyBudgetTable {...baseProps} calcResults={makeResults(0.02)} />,
    );

    await waitFor(() =>
      expect(contributionShares(view.container)).toEqual({
        "DMM Accuracy": 50,
        "UUT Resolution": 50,
      }),
    );
  });

  it("charts each Taylor Series input instead of the derived summary row", async () => {
    const view = renderDirectBudget({
      measurementType: "derived",
      budgetPropagationMethod: "equation",
      showContribution: true,
      setShowContribution: vi.fn(),
      referencePoint: { name: "Torque", unit: "in-oz" },
      calcResults: {
        calculatedBudgetGroups: [
          {
            id: "measurement_equation",
            kind: "equation",
            label: "Taylor Series Approximation",
            method: "equation",
            unit: "in-oz",
            rows: [
              {
                id: "length",
                name: "Length (l)",
                standardUncertainty: 0.001,
                unit: "in",
                sensitivityCoefficient: 2,
                contribution: 0.002,
              },
              {
                id: "weight",
                name: "Weight (w)",
                standardUncertainty: 0.0004,
                unit: "ozf",
                sensitivityCoefficient: 1,
                contribution: 0.0004,
              },
            ],
            results: { combined: 0.002 },
          },
          {
            id: "final_budget",
            kind: "final",
            label: "Torque Uncertainty Budget",
            unit: "in-oz",
            components: [
              {
                id: "taylor-summary",
                name: "Taylor Series Approximation",
                value_native: 0.00204,
                isPropagationSummary: true,
                distribution: "Standard uncertainty (k=1)",
              },
              {
                id: "uut-resolution",
                name: "UUT Resolution",
                contribution: 0.0001,
                distribution: "Rectangular (resolution)",
              },
            ],
            results: {},
          },
        ],
      },
    });

    await waitFor(() =>
      expect(view.container.querySelector(".contribution-plot-native")).toBeInTheDocument(),
    );
    const shares = contributionShares(view.container);
    expect(Object.keys(shares)).toEqual(
      expect.arrayContaining(["Length (l)", "Weight (w)", "UUT Resolution"]),
    );
    expect(shares).not.toHaveProperty("Taylor Series Approximation");
    const rawEquationVariance = 0.002 ** 2 + 0.0004 ** 2;
    const displayedEquationVariance = 0.00204 ** 2;
    const resolutionVariance = 0.0001 ** 2;
    const totalVariance = displayedEquationVariance + resolutionVariance;
    expect(shares["Length (l)"]).toBeCloseTo(
      ((0.002 ** 2 / rawEquationVariance) * displayedEquationVariance /
        totalVariance) *
        100,
      8,
    );
    expect(shares["Weight (w)"]).toBeCloseTo(
      ((0.0004 ** 2 / rawEquationVariance) * displayedEquationVariance /
        totalVariance) *
        100,
      8,
    );
    expect(shares["UUT Resolution"]).toBeCloseTo(
      (resolutionVariance / totalVariance) * 100,
      8,
    );
    expect(
      screen.getByRole("region", {
        name: "Taylor series uncertainty contribution",
      }),
    ).toBeInTheDocument();
  });

  it("charts Monte Carlo variable influence percentages", async () => {
    const view = renderDirectBudget({
      measurementType: "derived",
      budgetPropagationMethod: "montecarlo",
      showContribution: true,
      setShowContribution: vi.fn(),
      referencePoint: { name: "Torque", unit: "in-oz" },
      calcResults: {
        calculatedBudgetGroups: [
          {
            id: "measurement_equation",
            kind: "equation",
            label: "Monte Carlo Approximation",
            method: "montecarlo",
            unit: "in-oz",
            rows: [
              {
                id: "length",
                name: "Length (l)",
                standardUncertainty: 0.001,
                unit: "in",
                sensitivityCoefficient: 2,
                contribution: 0.002,
                influence: 0.25,
              },
              {
                id: "weight",
                name: "Weight (w)",
                standardUncertainty: 0.0004,
                unit: "ozf",
                sensitivityCoefficient: 1,
                contribution: 0.0004,
                influence: 0.75,
              },
            ],
            results: {},
          },
          {
            id: "final_budget",
            kind: "final",
            label: "Torque Uncertainty Budget",
            unit: "in-oz",
            components: [
              {
                id: "mc-summary",
                name: "Monte Carlo Approximation",
                value_native: 0.002,
                isPropagationSummary: true,
                distribution: "Standard uncertainty (k=1)",
              },
              {
                id: "uut-resolution",
                name: "UUT Resolution",
                contribution: 0.001,
                distribution: "Rectangular (resolution)",
              },
            ],
            results: {},
          },
        ],
      },
    });

    await waitFor(() =>
      expect(view.container.querySelector(".contribution-plot-native")).toBeInTheDocument(),
    );
    const shares = contributionShares(view.container);
    expect(shares["Length (l)"]).toBeCloseTo(20, 10);
    expect(shares["UUT Resolution"]).toBeCloseTo(20, 10);
    expect(shares["Weight (w)"]).toBeCloseTo(60, 10);
    expect(shares).not.toHaveProperty("Monte Carlo Approximation");
    expect(
      screen.getByRole("region", {
        name: "Monte Carlo uncertainty contribution",
      }),
    ).toBeInTheDocument();
  });

  it("uses a compact chart control beside Add for contribution display", () => {
    const setShowContribution = vi.fn();
    renderDirectBudget({ setShowContribution });

    expect(document.querySelector(".budget-stack-final-display")).not.toBeInTheDocument();
    expect(screen.queryByText("Expanded Uncertainty (U)")).not.toBeInTheDocument();
    const chartButton = screen.getByRole("button", {
      name: "Show contribution chart",
    });
    expect(chartButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chartButton);
    expect(setShowContribution).toHaveBeenCalledWith(true);
  });

  it("keeps risk cards out of the budget table and labels final results in the point unit", () => {
    renderDirectBudget({
      referencePoint: { name: "Voltage", unit: "V" },
      riskResults: { pfa: 1, pfr: 2, tur: 3 },
      calcResults: {
        calculatedBudgetGroups: [
          {
            id: "final_budget",
            kind: "final",
            label: "Voltage Uncertainty Budget",
            unit: "ppm",
            components: [],
            results: { combined: 0.001, effective_dof: Infinity, k_value: 2, expanded: 0.002 },
          },
        ],
      },
    });

    expect(document.querySelector(".budget-risk-strip")).not.toBeInTheDocument();
    expect(screen.getByText("0.001 V")).toBeInTheDocument();
    expect(screen.queryByText("0.001000 ppm")).not.toBeInTheDocument();
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

  it("keeps TMDE accuracy distribution read-only in the budget table", () => {
    renderDirectBudget({
      components: [
        {
          id: "tmde-accuracy",
          name: "F-Class Weight - Accuracy",
          sourceTmdeId: "tmde-weight",
          sourcePointLabel: "10 ozf",
          type: "B",
          value: NaN,
          value_native: NaN,
          unit_native: "ozf",
          distribution: "Not Set",
          distributionDivisor: "not_set",
          isCore: true,
        },
      ],
    });

    expect(screen.getByText("Not Set")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("authors a new manual component directly in an expanded budget row", async () => {
    const onComponentUpdate = vi.fn();
    const ToleranceEditorComponent = ({ onCommit, openRequested }) => (
      <button
        type="button"
        aria-label="Author IV tolerance"
        data-open={String(openRequested)}
        onClick={() =>
          onCommit("reading", {
            high: "0.5",
            low: "-0.5",
            unit: "%",
            distribution: "1.732",
            symmetric: true,
          })
        }
      >
        Tolerance editor
      </button>
    );
    renderDirectBudget({
      onComponentUpdate,
      ToleranceEditorComponent,
      applyToleranceChange: (tolerance, key, term) => ({
        ...tolerance,
        [key]: term,
      }),
      formatToleranceSummary: () => ["Not Set"],
      components: [
        {
          id: "manual-inline",
          name: "",
          type: "B",
          value: 0,
          value_native: 0,
          unit_native: "V",
          distribution: "Rectangular",
          distributionDivisor: "1.732",
          isManual: true,
          isInlineManual: true,
          inlineDraft: true,
          originalInput: {
            inputMode: "tolerance",
            toleranceLimit: "",
            standardUncertainty: "",
            errorDistributionDivisor: "1.732",
            unit: "V",
          },
        },
      ],
      referencePoint: { name: "Voltage", value: 10, unit: "V" },
    });

    expect(screen.queryByText("Manual Component", { selector: "h3" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Error source name")).not.toHaveAttribute(
      "placeholder",
    );
    fireEvent.change(screen.getByLabelText("Error source name"), {
      target: { value: "Thermal drift" },
    });
    expect(screen.getByLabelText("Author IV tolerance")).toHaveAttribute(
      "data-open",
      "true",
    );
    fireEvent.click(screen.getByLabelText("Author IV tolerance"));
    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(onComponentUpdate).toHaveBeenCalledOnce());
    expect(onComponentUpdate.mock.calls[0][0]).toBe("manual-inline");
    expect(onComponentUpdate.mock.calls[0][1]).toMatchObject({
      inlineManualDraft: {
        name: "Thermal drift",
        type: "B",
        inputMode: "tolerance",
        toleranceLimit: "",
        tolerance: {
          reading: {
            high: "0.5",
            low: "-0.5",
            unit: "%",
            distribution: "1.732",
            symmetric: true,
          },
        },
        unit: "V",
      },
      referencePoint: { value: 10, unit: "V" },
    });
  });

  it("edits a derived final-budget manual tolerance against the measurement point", async () => {
    const onComponentUpdate = vi.fn();
    const ToleranceEditorComponent = ({ onCommit }) => (
      <button
        type="button"
        aria-label="Set final IV tolerance"
        onClick={() =>
          onCommit("reading", {
            high: "1",
            low: "-1",
            value: "1",
            unit: "%",
            symmetric: true,
          })
        }
      >
        Tolerance editor
      </button>
    );
    const manual = {
      id: "derived-final-manual",
      name: "Fixture effect",
      type: "B",
      value: 0,
      value_native: 0,
      unit_native: "V",
      distribution: "Rectangular",
      distributionDivisor: "1.732",
      isManual: true,
      isInlineManual: true,
      inlineDraft: true,
      originalInput: {
        inputMode: "tolerance",
        toleranceLimit: "",
        tolerance: { bandDistribution: "1.732" },
        standardUncertainty: "",
        errorDistributionDivisor: "1.732",
        unit: "V",
      },
    };

    renderDirectBudget({
      measurementType: "derived",
      onComponentUpdate,
      ToleranceEditorComponent,
      applyToleranceChange: (tolerance, key, term) => ({
        ...tolerance,
        [key]: term,
      }),
      formatToleranceSummary: () => ["Not Set"],
      referencePoint: { name: "Voltage", value: 20, unit: "V" },
      calcResults: {
        calculatedBudgetGroups: [
          {
            id: "final_budget",
            kind: "final",
            label: "Voltage Uncertainty Budget",
            unit: "V",
            // This summary nominal must never replace the actual point nominal.
            nominalPoint: { value: 999, unit: "A" },
            components: [manual],
            results: {},
          },
        ],
      },
    });

    fireEvent.change(screen.getByLabelText("Error limit distribution"), {
      target: { value: "1.960" },
    });
    fireEvent.click(screen.getByLabelText("Set final IV tolerance"));
    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(onComponentUpdate).toHaveBeenCalledOnce());
    expect(onComponentUpdate.mock.calls[0][1]).toMatchObject({
      inlineManualDraft: {
        tolerance: {
          bandDistribution: "1.960",
          reading: {
            high: "1",
            low: "-1",
            unit: "%",
            distribution: "1.960",
          },
        },
      },
      referencePoint: { name: "Voltage", value: 20, unit: "V" },
    });
  });

  it("persists a tolerance committed by blur before an outside click closes the row", async () => {
    const onComponentUpdate = vi.fn();
    const ToleranceEditorComponent = ({ onCommit }) => {
      const [value, setValue] = useState("");
      return (
        <input
          aria-label="Manual IV term"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() =>
            onCommit("reading", {
              high: value,
              low: `-${value}`,
              value,
              unit: "%",
              symmetric: true,
            })
          }
        />
      );
    };

    renderDirectBudget({
      onComponentUpdate,
      ToleranceEditorComponent,
      applyToleranceChange: (tolerance, key, term) => ({
        ...tolerance,
        [key]: term,
      }),
      formatToleranceSummary: () => ["Not Set"],
      components: [
        {
          id: "manual-blur-order",
          name: "Thermal drift",
          type: "B",
          value: 0,
          value_native: 0,
          unit_native: "V",
          distribution: "Rectangular",
          distributionDivisor: "1.732",
          isManual: true,
          isInlineManual: true,
          inlineDraft: true,
          originalInput: {
            inputMode: "tolerance",
            toleranceLimit: "",
            standardUncertainty: "",
            errorDistributionDivisor: "1.732",
            unit: "V",
          },
        },
      ],
      referencePoint: { name: "Voltage", value: 10, unit: "V" },
    });

    const input = screen.getByLabelText("Manual IV term");
    fireEvent.change(input, { target: { value: "0.5" } });
    // Browsers dispatch pointerdown outside before the focused input blurs.
    fireEvent.pointerDown(document.body);
    fireEvent.blur(input);

    await waitFor(() => expect(onComponentUpdate).toHaveBeenCalledOnce());
    expect(onComponentUpdate.mock.calls[0][1]).toMatchObject({
      inlineManualDraft: {
        tolerance: {
          reading: {
            high: "0.5",
            low: "-0.5",
            value: "0.5",
            unit: "%",
          },
        },
      },
    });
  });

  it("switches a manual row to direct standard-uncertainty entry inline", async () => {
    const onComponentUpdate = vi.fn();
    renderDirectBudget({
      onComponentUpdate,
      components: [
        {
          id: "manual-standard",
          name: "Environmental effect",
          type: "B",
          value: 0,
          value_native: 0,
          unit_native: "V",
          distribution: "Rectangular",
          isManual: true,
          isInlineManual: true,
          inlineDraft: true,
          originalInput: {
            inputMode: "tolerance",
            toleranceLimit: "0.6",
            standardUncertainty: "",
            errorDistributionDivisor: "2",
            unit: "V",
          },
        },
      ],
      referencePoint: { name: "Voltage", value: 10, unit: "V" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Not Set" }));
    const standardInput = screen.getByLabelText("Standard uncertainty");
    expect(standardInput).toHaveValue(0.3);
    fireEvent.change(standardInput, { target: { value: "0.2" } });
    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(onComponentUpdate).toHaveBeenCalledOnce());
    expect(onComponentUpdate.mock.calls[0][1].inlineManualDraft).toMatchObject({
      inputMode: "standard",
      standardUncertainty: "0.2",
    });
  });

  it("keeps a saved manual row clean until the user clicks it", () => {
    renderDirectBudget({
      onComponentUpdate: vi.fn(),
      components: [
        {
          id: "manual-saved",
          name: "Operator influence",
          type: "B",
          value: 25000,
          value_native: 0.25,
          unit_native: "V",
          distribution: "Standard uncertainty (k=1)",
          isManual: true,
          isInlineManual: true,
          inlineDraft: false,
          originalInput: {
            inputMode: "standard",
            toleranceLimit: "",
            standardUncertainty: "0.25",
            errorDistributionDivisor: "1",
            unit: "V",
          },
        },
      ],
      referencePoint: { name: "Voltage", value: 10, unit: "V" },
    });

    expect(screen.getByText("Operator influence")).toBeInTheDocument();
    expect(screen.queryByLabelText("Error source name")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Operator influence"));
    expect(screen.getByLabelText("Error source name")).toHaveValue(
      "Operator influence",
    );
  });

  it("uses the instrument tolerance formatter in a collapsed manual row", () => {
    renderDirectBudget({
      onComponentUpdate: vi.fn(),
      formatToleranceSummary: (tolerance) =>
        tolerance.reading ? ["± 0.5% IV"] : ["Not Set"],
      components: [
        {
          id: "manual-shaped-saved",
          name: "Display effect",
          type: "B",
          value: 2500,
          value_native: 0.025,
          unit_native: "V",
          distribution: "Normal (95.45%)",
          isManual: true,
          isInlineManual: true,
          inlineDraft: false,
          originalInput: {
            inputMode: "tolerance",
            tolerance: {
              reading: {
                high: "0.5",
                low: "-0.5",
                unit: "%",
                distribution: "2.000",
                symmetric: true,
              },
            },
            toleranceLimit: "",
            standardUncertainty: "",
            errorDistributionDivisor: "2.000",
            unit: "V",
          },
        },
      ],
      referencePoint: { name: "Voltage", value: 10, unit: "V" },
    });

    expect(screen.getByText("± 0.5% IV")).toBeInTheDocument();
    expect(screen.queryByLabelText("Error source name")).not.toBeInTheDocument();
  });
});
