// Targets are real controls; topics can be entered independently from Help.
export const createWalkthroughSteps = (sessionCount) => {
  const step = (workflow, id, title, description, target, extra = {}) => ({
    workflow,
    id,
    title,
    description,
    target,
    ...extra,
  });
  const overview = {
    workspace: "overview",
    prerequisite: "Create or select a session, then open Instrument Overview.",
  };
  const budget = {
    workspace: "budget",
    prerequisite:
      "Create and select a measurement point in the sidebar, then open Uncertainty Budget.",
  };
  const derived = {
    ...budget,
    prerequisite:
      "Choose Derived in Measurement Area Settings, create a new point with +, and select it in Uncertainty Budget.",
  };
  return [
    step(
      "Session setup",
      "new-session",
      "Start an analysis session",
      "Select the highlighted add button to create an analysis session. A session keeps your instruments, measurement points, budgets, requirements, and notes together.",
      '[data-tour="add-session"]',
      {
        advanceOnTargetClick: true,
        canAdvance: sessionCount > 0,
        hint: sessionCount
          ? "Continue with this session or create another. Use Workflow below to jump to any topic."
          : "Click + to begin. You can explore another workflow from the menu below.",
      },
    ),
    step(
      "Session setup",
      "session-information",
      "Complete the session information",
      "Name the session and enter the analyst, organization, document, and date. Expand Risk Inputs and Mitigation Inputs to set confidence, assumed REOP, TUR needed, PFA required, required REOP, and calibration interval. These settings are shared by the session's points.",
      '[data-tour="session-information"]',
      {
        hint: "Fields save as you edit. Hover an input label for its definition.",
      },
    ),
    step(
      "Instruments & Measurement Areas",
      "overview-tab",
      "Open Instrument Overview",
      "The UUT table defines units under test. The TMDE table defines measuring equipment and other uncertainty sources. Instruments remain available across this session.",
      '[data-tour="tab-overview"]',
      overview,
    ),
    step(
      "Instruments & Measurement Areas",
      "uut-function",
      "Create a Measurement Area",
      "Use the UUT table's add button to create your own area, such as Torque. Reuse an existing name or enter a new one. Areas organize instruments and sidebar points with the same color; an instrument's Function remains library search metadata.",
      '[data-tour="uut-add-function"]',
      {
        ...overview,
        revealedTarget: '[data-tour="uut-function-menu"]',
        hint: "A Torque area can contain both Length and Weight instruments. The area does not restrict instrument choice.",
      },
    ),
    step(
      "Instruments & Measurement Areas",
      "uut-instrument",
      "Add the unit under test",
      "Use + on an area header to add an instrument row. Click Description and search by manufacturer, model, name, or Function. Typing Length lists instruments with that function. Choose an entry explicitly, or type a new definition.",
      '[data-tour="uut-add-instrument"]',
      {
        ...overview,
        hint: "Suggestions never automatically choose an instrument for you. A tag or nickname distinguishes similar instruments.",
      },
    ),
    step(
      "Instruments & Measurement Areas",
      "uut-columns",
      "Define ranges and specifications",
      "Click Range, Tolerance, Distribution, or Resolution to edit a specification. Use Add range for another interval or single value. A tolerance can be symmetric, asymmetric, or single-sided. Distribution determines how its error limit becomes standard uncertainty.",
      '[data-tour="uut-table"]',
      {
        ...overview,
        hint: "Use the + beside a column header for a custom column. Rename its heading and fill the cells. Drag header dividers to resize; double-click a divider to reset.",
      },
    ),
    step(
      "Instruments & Measurement Areas",
      "area-tools",
      "Organize and maintain instruments",
      "Use the color dot to change an area's color and click its name to rename it. Drag instrument rows to add them to another area. Right-click a row or range for its available actions. The Sync indicator shows the instrument's relationship to the shared library.",
      '[data-tour="uut-table"]',
      {
        ...overview,
        hint: "Select rows with Ctrl/Cmd-click. Inspect context-menu actions before deleting or changing shared definitions.",
      },
    ),
    step(
      "Instruments & Measurement Areas",
      "tmde-function",
      "Add measuring equipment",
      "Create or reuse a Measurement Area in the TMDE table, then use its + to add an instrument. Search Description or enter the definition, and complete the ranges, tolerances, distributions, and resolution just as for a UUT.",
      '[data-tour="tmde-add-function"]',
      {
        ...overview,
        revealedTarget: '[data-tour="tmde-function-menu"]',
        hint: "Adding a TMDE to the table makes its sources available. You still choose which sources belong in each point's budget.",
      },
    ),
    step(
      "Direct measurement",
      "function-settings",
      "Choose the direct workflow",
      "Hover the sidebar area header and open the settings gear beside the Measurement Area name and select Direct. If you enable Reuse the first point's budget, subsequent points start with that area's first budget.",
      '[data-tour="function-settings"]',
      {
        ...overview,
        revealedTarget: '[data-tour="function-settings-menu"]',
        prerequisite:
          "Add a UUT to a Measurement Area first; its header and settings will appear in the sidebar.",
      },
    ),
    step(
      "Direct measurement",
      "measurement-point",
      "Create a direct measurement point",
      "Use + beside the sidebar Measurement Area. Choose a unit if prompted, assign the UUT in the new row's UUT cell, then enter its nominal in Value. For a simple voltage check, enter 5 V and use a UUT range that includes it.",
      '[data-tour="add-measurement-point"]',
      {
        revealedTarget: '[data-tour="measurement-point-menu"]',
        hint: "Click a UUT cell to change its assignment. Section and Qualifier can organize related points; enable them in the column filter.",
      },
    ),
    step(
      "Direct measurement",
      "budget-tab",
      "Open the Uncertainty Budget",
      "Select the 5 V point and open Uncertainty Budget. Confirm the UUT nominal and tolerance. Instrument tables show the session definitions; the budget below contains only the error sources selected for this point.",
      '[data-tour="tab-budget"]',
      budget,
    ),
    step(
      "Direct measurement",
      "budget-component",
      "Build the direct budget",
      "Use + in the budget header. Choose a TMDE tolerance or resolution, a repeatability source, or a manual component. Set the source's value and distribution. For a 5 V point, select a voltage range containing 5 V.",
      '[data-tour="budget-add-component"]',
      {
        ...budget,
        revealedTarget: '[data-tour="budget-component-menu"]',
        hint: "Hover yellow warnings for the exact nominal, selected range, and corrective action. The sidebar also flags points that need attention.",
      },
    ),
    step(
      "Derived measurement",
      "derived-settings",
      "Choose the derived workflow",
      "Hover the sidebar area header, open Measurement Area Settings, and choose Derived before creating a new point. Reuse the first point's equation copies its equation and variable definitions; Reuse the first point's budget copies its error sources.",
      '[data-tour="function-settings"]',
      {
        revealedTarget: '[data-tour="function-settings-menu"]',
        prerequisite:
          "Create a UUT Measurement Area first. These settings apply to newly created points.",
      },
    ),
    step(
      "Derived measurement",
      "derived-point",
      "Create the derived target",
      "Use the area's + to create a new derived point, assign its UUT using the sidebar UUT cell, and enter the desired output value and unit. Select the point and open Uncertainty Budget. A derived point calculates its output from input nominals and their budgets.",
      '[data-tour="add-measurement-point"]',
      {
        revealedTarget: '[data-tour="measurement-point-menu"]',
        hint: "Example: a 10 W power point from 5 V × 2 A. The UUT measures the output; TMDE sources contribute to the inputs.",
      },
    ),
    step(
      "Derived measurement",
      "derived-equation",
      "Enter the measurement equation",
      "Click the equation preview and enter x * y for the power example. Use f(x) to insert a function or symbol, or Library to choose a common metrology equation. Press Enter to finish editing.",
      ".measurement-equation-card",
      {
        ...derived,
        hint: "Use physically compatible units. A unit mismatch is explained beside the equation and on the sidebar point.",
      },
    ),
    step(
      "Derived measurement",
      "derived-nominals",
      "Set every input nominal",
      "Name each input first (for example, Voltage and Current), then enter its value and unit: x = 5 V and y = 2 A produce 10 W. These nominals are independent of the instruments you later add. Check that the calculated result agrees with the target measurement point.",
      ".measurement-inputs-table-wrap",
      {
        ...derived,
        hint: "A missing nominal prevents evaluation. A different equation result is flagged so you can review the inputs or target.",
      },
    ),
    step(
      "Derived measurement",
      "derived-sources",
      "Build each input budget",
      "Use + on each input budget to add the relevant source: voltage uncertainty to x and current uncertainty to y. You may choose any instrument in the session. The selected range must cover that input nominal in compatible units.",
      '[data-tour="budget-add-component"]',
      {
        ...derived,
        revealedTarget: '[data-tour="budget-component-menu"]',
        hint: "The equation's sensitivity coefficients propagate each input uncertainty to the output. Add output-level contributors in the final budget when applicable.",
      },
    ),
    step(
      "Budget controls & results",
      "budget-edit",
      "Review error sources",
      "Edit source names, limits, distributions, and uncertainty type in the budget. Use the row arrows to reorder sources and the remove control to remove one from this budget. Linked instrument sources track their underlying specifications.",
      ".budget-stack",
      budget,
    ),
    step(
      "Budget controls & results",
      "budget-results",
      "Read the budget results",
      "Each budget shows combined standard uncertainty, effective degrees of freedom, coverage factor k, and expanded uncertainty. The degrees-of-freedom checkbox controls Welch–Satterthwaite handling. Hover result values for more precision.",
      ".budget-results-card",
      budget,
    ),
    step(
      "Budget controls & results",
      "budget-charts",
      "Inspect contributions and calculations",
      "Toggle the contribution chart to see which sources dominate. Open Calculation breakdown for the computation details. For derived inputs, Input correlation matrix lets you enter known correlations between contributors.",
      '[aria-label="Calculation breakdown"]',
      budget,
    ),
    step(
      "Budget controls & results",
      "budget-method",
      "Choose uncertainty propagation",
      "Taylor Series propagates uncertainty using local sensitivities. For derived equations, the Monte Carlo toggle evaluates sampled inputs; edit its trial count as needed. Review stationary-point or nonlinearity warnings before relying on results.",
      '[aria-label="Use Monte Carlo approximation"]',
      {
        ...derived,
        hint: "Recalculate when the app marks Monte Carlo results out of date. A method change can change the result.",
      },
    ),
    step(
      "Budget controls & results",
      "risk-columns",
      "Compare risk and mitigation",
      "Open the column filter and choose Measurement, Risk, or either Mitigation group. Group checkboxes toggle a whole section; each column is also independent. Click a risk metric for its breakdown, and hover a warning beside Value to see what needs attention.",
      '[data-tour="sidebar-columns"]',
      {
        revealedTarget: ".sidebar-filter-dropdown",
        hint: "Single-sided tolerances with an unknown measurement use PFA-only results; other metrics may intentionally be unavailable.",
      },
    ),
    step(
      "Editing & shortcuts",
      "point-selection",
      "Select and edit points",
      "Click a value to edit it; Enter commits and moves to the next point; Ctrl/Cmd+Enter inserts a new point directly below. Escape cancels. Ctrl/Cmd-click adds or removes a point from the selection, and Shift-click selects a contiguous span. Right-click for point, budget, and paste actions.",
      ".measurement-point-list",
      {
        hint: "Clipboard shortcuts operate on selected rows when you are outside a text field. Within a text field they edit text normally.",
      },
    ),
    step(
      "Editing & shortcuts",
      "clipboard",
      "Copy points and budgets",
      "Ctrl/Cmd+C copies selected points; Ctrl/Cmd+X cuts them; Ctrl/Cmd+V pastes into the selected destination. Ctrl/Cmd+B copies the single selected point's budget. Right-click a destination to paste a budget. Ctrl/Cmd+Z undoes the last session change.",
      ".measurement-point-list",
      {
        hint: "Review UUT ranges and derived nominals after pasting into a different area. Delete removes the selected item; confirm any deletion prompt.",
      },
    ),
    step(
      "Editing & shortcuts",
      "layout",
      "Make the workspace fit",
      "Drag the sidebar divider to resize it. Drag table-column dividers to change widths and double-click them to reset. Ctrl/Cmd+0 resets layout sizes and zoom. Tab moves through inline editors; Escape closes or cancels the active editor.",
      '[data-tour="analysis-tabs"]',
      {
        hint: "Use Ctrl/Cmd+mouse wheel over a table to zoom that section. Collapse sections you do not need.",
      },
    ),
    step(
      "Notes & session files",
      "notes",
      "Document and share the analysis",
      "Open Notes to record the method, assumptions, images, and conclusions. Use the session file controls to export a session PDF or import a previously exported session PDF. Check point warnings before sharing results.",
      '[data-tour="analysis-tabs"]',
      {
        hint: "Open Help whenever you need a refresher; choose a workflow or an individual step without replaying the entire tutorial.",
      },
    ),
  ];
};
