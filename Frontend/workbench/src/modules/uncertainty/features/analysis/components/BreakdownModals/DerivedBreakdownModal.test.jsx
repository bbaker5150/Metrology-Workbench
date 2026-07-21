import { render, screen } from "@testing-library/react";
import DerivedBreakdownModal from "./DerivedBreakdownModal";

// y = x² at x = 1 V with a ±1 V rectangular floor (u = 1/√3): the classic
// nonlinear case where the ½f″u² Taylor term is ~29% of the first-order
// contribution. The budget components mirror what useUncertaintyCalculation
// builds from calculateDerivedUncertainty's breakdown.
const RECT = "1.7320508075688772";

const makeBreakdownData = (overrides = {}) => ({
  equationString: "y = x^2",
  derivedNominalPoint: { value: 1, unit: "V" },
  tmdeTolerances: [
    {
      name: "Source",
      variableType: "Length",
      quantity: 1,
      measurementPoint: { value: 1, unit: "V" },
      floor: {
        high: 1,
        low: -1,
        unit: "V",
        symmetric: true,
        distribution: RECT,
      },
    },
  ],
  results: {
    calculatedNominalValue: 1,
    calculatedBudgetComponents: [
      {
        id: "derived_x_0",
        name: "Input: Length (x)",
        sensitivityCoefficient: 2,
        derivativeString: "2 * x",
        contribution: 2 / Math.sqrt(3),
        sourcePointLabel: "1 V",
        nonlinearityWarning:
          "Input 'x' (Length): the second-order Taylor term is ~29% of its first-order contribution at this operating point.",
        secondDerivativeString: "2",
        secondDerivativeValue: 2,
        secondOrderContribution: 1 / 3,
        secondOrderShift: 1 / 3,
        ...overrides.component,
      },
    ],
  },
});

test("renders the per-input 2nd-order term and the Taylor-series summary", () => {
  render(
    <DerivedBreakdownModal
      isOpen
      onClose={() => {}}
      breakdownData={makeBreakdownData()}
    />,
  );

  // Per-input second-order block.
  expect(screen.getByText(/2nd-Order Taylor Term/)).toBeInTheDocument();
  // Aggregate summary section with corrected u and mean shift.
  expect(
    screen.getByText("2nd-Order Taylor Series (Nonlinearity Correction)"),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/shift the expected result away from/),
  ).toBeInTheDocument();
  // The Layer-1 warning still shows.
  expect(screen.getByText(/second-order Taylor term is ~29%/)).toBeInTheDocument();
});

test("omits the 2nd-order sections for a linear equation", () => {
  const data = makeBreakdownData({
    component: {
      derivativeString: "1",
      sensitivityCoefficient: 1,
      nonlinearityWarning: null,
      secondDerivativeString: null,
      secondDerivativeValue: null,
      secondOrderContribution: 0,
      secondOrderShift: 0,
    },
  });
  data.equationString = "y = x";

  render(<DerivedBreakdownModal isOpen onClose={() => {}} breakdownData={data} />);

  expect(screen.queryByText(/2nd-Order Taylor Term/)).not.toBeInTheDocument();
  expect(
    screen.queryByText("2nd-Order Taylor Series (Nonlinearity Correction)"),
  ).not.toBeInTheDocument();
});

test("uses the live derived budget result instead of rebuilding raw TMDE terms", () => {
  const data = makeBreakdownData();
  data.derivedNominalPoint.variableNominals = { x: { value: 1, unit: "V" } };
  data.results.combined_uncertainty_absolute_base = 3;
  data.results.calculatedBudgetComponents[0] = {
    ...data.results.calculatedBudgetComponents[0],
    value: 0.1,
    unit: "V",
    isBaseUnitValue: true,
    quantity: 8,
  };
  data.results.calculatedBudgetGroups = [
    {
      id: "measurement_equation",
      kind: "equation",
      correlationApplied: true,
      results: { combined: 1 },
    },
    { id: "final_budget", kind: "final", results: { combined: 3 } },
  ];

  render(<DerivedBreakdownModal isOpen onClose={() => {}} breakdownData={data} />);

  // The displayed final value comes from the authoritative base-unit result,
  // not from the deliberately different component RSS value or raw TMDE data.
  expect(document.body.textContent).toContain("3.0000 V");
  expect(document.body.textContent).toContain("correlations applied");
  expect(document.body.textContent).toContain("(aggregated input)");
});

test("shows the saved Monte Carlo matrices and sampling walkthrough instead of Taylor terms", () => {
  const data = makeBreakdownData();
  data.results.propagationMethod = "montecarlo";
  data.results.monteCarlo = {
    trials: 10000,
    meanBase: 1.02,
    nominalResultBase: 1,
    standardUncertaintyBase: 0.12,
    influenceFractions: [1],
    inputs: [{ symbol: "x", componentId: "input-x", meanBase: 1, standardUncertaintyBase: 0.1 }],
    correlationMatrix: [[1]],
    choleskyMatrix: [[1]],
  };
  data.results.combined_uncertainty_absolute_base = 0.13;

  render(<DerivedBreakdownModal isOpen onClose={() => {}} breakdownData={data} />);

  expect(screen.getByText("Monte Carlo Input Model (10,000 trials)")).toBeInTheDocument();
  expect(screen.getByText("Correlation matrix (R)")).toBeInTheDocument();
  expect(screen.getByText(/Lower Cholesky matrix/)).toBeInTheDocument();
  expect(screen.getByText("Monte Carlo Propagation Walkthrough")).toBeInTheDocument();
  expect(screen.queryByText(/Sensitivity Coefficient/)).not.toBeInTheDocument();
  expect(screen.queryByText(/2nd-Order Taylor Term/)).not.toBeInTheDocument();
});
