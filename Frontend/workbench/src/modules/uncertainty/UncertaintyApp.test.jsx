import { describe, test, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

// The analysis tree transitively imports the full Plotly bundle; stub it so the
// jsdom smoke test doesn't load it. (Charts only render once a point is
// selected, which this no-backend test never reaches.)
vi.mock("plotly.js-dist", () => ({ default: {} }));

const apiMock = vi.hoisted(() => {
  const state = {
    sessions: [],
    instruments: [],
    equations: [],
    bugReports: [],
  };
  const ok = (data) => Promise.resolve({ data });
  return {
    state,
    get: vi.fn((url) => {
      const path = String(url || "");
      if (path.includes("/sessions/") && !path.includes("/images/")) {
        return ok(state.sessions);
      }
      if (path.includes("/instruments/")) return ok(state.instruments);
      if (path.includes("/equations/")) return ok(state.equations);
      if (path.includes("/bug_reports/")) return ok(state.bugReports);
      return ok([]);
    }),
    post: vi.fn(() => ok({})),
    put: vi.fn(() => ok({})),
    patch: vi.fn(() => ok({})),
    delete: vi.fn(() => ok({})),
  };
});

// No Django backend in unit tests: make the session store resolve from the
// per-test fixture instead of hitting the network.
vi.mock("axios", () => {
  return {
    default: {
      get: apiMock.get,
      post: apiMock.post,
      put: apiMock.put,
      patch: apiMock.patch,
      delete: apiMock.delete,
    },
  };
});

import UncertaintyApp from "./UncertaintyApp";
import { ThemeProvider } from "../../shared/ThemeContext";
import { NotificationProvider } from "../../shared/NotificationContext";

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  apiMock.state.sessions = [];
  apiMock.state.instruments = [];
  apiMock.state.equations = [];
  apiMock.state.bugReports = [];
  apiMock.get.mockClear();
  apiMock.post.mockClear();
  apiMock.put.mockClear();
  apiMock.patch.mockClear();
  apiMock.delete.mockClear();
  window.localStorage.clear();
});

describe("UncertaintyApp", () => {
  test("mounts the ported Uncertalytics app under the workbench shell", async () => {
    render(
      <ThemeProvider>
        <NotificationProvider>
          <MemoryRouter>
            <UncertaintyApp />
          </MemoryRouter>
        </NotificationProvider>
      </ThemeProvider>
    );

    // The ac-shunt-style chrome brand subtitle renders immediately.
    expect(
      await screen.findByText(/Uncertainty & Risk/i)
    ).toBeInTheDocument();
    // With no backend sessions, the empty-state placeholder is shown.
    expect(screen.getByText(/No Session Available/i)).toBeInTheDocument();
  });

  test("uses concise labels for uncertainty columns in the filter menu", async () => {
    render(
      <ThemeProvider>
        <NotificationProvider>
          <MemoryRouter>
            <UncertaintyApp />
          </MemoryRouter>
        </NotificationProvider>
      </ThemeProvider>,
    );

    await screen.findByText(/No Session Available/i);
    fireEvent.click(screen.getByTitle("Filter visible columns"));

    expect(screen.getByText("Comb. Uncertainty")).toBeInTheDocument();
    expect(screen.getByText("Exp. Uncertainty")).toBeInTheDocument();
    expect(screen.getByText("Risk")).toBeInTheDocument();
    expect(screen.getByText("Mitigation (GB + Int)")).toBeInTheDocument();
    expect(screen.getByText("Mitigation (Int Only)")).toBeInTheDocument();
    expect(screen.getByText("REOP @ test pt TUR")).toBeInTheDocument();
    expect(screen.getByText("Targeted REOP w/ GB")).toBeInTheDocument();
    expect(screen.getByText("Targeted REOP w/o GB")).toBeInTheDocument();
    const riskGroupToggle = screen.getByRole("checkbox", {
      name: "Toggle all Risk columns",
    });
    const riskGroup = riskGroupToggle.closest(".filter-option-group");
    expect(riskGroupToggle.indeterminate).toBe(true);
    fireEvent.click(riskGroupToggle);
    within(riskGroup)
      .getAllByRole("checkbox")
      .forEach((checkbox) => expect(checkbox).toBeChecked());
    fireEvent.click(riskGroupToggle);
    within(riskGroup)
      .getAllByRole("checkbox")
      .forEach((checkbox) => expect(checkbox).not.toBeChecked());
    expect(
      screen.queryByText("Standard Uncertainty (combined)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Measurement Uncertainty (expanded)"),
    ).not.toBeInTheDocument();
  });

  test("nests expanded risk and mitigation inputs inside Session Info", async () => {
    apiMock.state.sessions = [
      {
        id: 101,
        name: "Workbook Input Parity",
        analyst: "",
        organization: "NPSL",
        document: "",
        documentDate: "2026-07-20",
        measurementAreas: [],
        uuts: [],
        tmdes: [],
        testPoints: [],
        uncReq: {
          uncertaintyConfidence: 95,
          measRelCalcAssumed: 85,
          neededTUR: 4,
          reqPFA: 2,
          reliability: 85,
          calInt: 12,
        },
      },
    ];

    render(
      <ThemeProvider>
        <NotificationProvider>
          <MemoryRouter>
            <UncertaintyApp />
          </MemoryRouter>
        </NotificationProvider>
      </ThemeProvider>,
    );

    const overviewTab = await screen.findByRole("button", {
      name: "Instrument Overview",
    });
    expect(overviewTab).toBeInTheDocument();
    const tabs = within(overviewTab.closest(".analysis-tabs")).getAllByRole("button");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Instrument Overview",
      "Uncertainty Budget",
      "Notes",
    ]);
    expect(
      within(document.querySelector(".results-sidebar")).queryByRole("button", {
        name: "Instrument Overview",
      }),
    ).not.toBeInTheDocument();
    const sessionInfoToggle = screen.getByRole("button", { name: /Session Info/i });
    expect(sessionInfoToggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Risk Inputs")).toBeInTheDocument();
    expect(screen.getByText("Mitigation Inputs")).toBeInTheDocument();
    expect(document.querySelector(".session-info-content")).toContainElement(
      screen.getByText("Risk Inputs"),
    );
    expect(document.querySelector(".session-info-content")).toContainElement(
      screen.getByText("Mitigation Inputs"),
    );
    expect(screen.getByRole("button", { name: /Risk Inputs/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Mitigation Inputs/i }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Document Date")).toBeInTheDocument();
    expect(screen.getByText("Confidence (%)")).toBeInTheDocument();
    expect(screen.getByText("Assumed REOP")).toBeInTheDocument();
    expect(screen.getByText("TUR Needed")).toBeInTheDocument();
    expect(screen.getByText("PFA Required")).toBeInTheDocument();
    expect(screen.getByText("REOP Required")).toBeInTheDocument();
    expect(screen.getByText("Cal Int for assumed REOP")).toBeInTheDocument();
    const assumedReliabilityHelp = screen
      .getByText("Assumed REOP")
      .closest(".session-header-label");
    expect(assumedReliabilityHelp.title).toMatch(/probability/i);
    expect(assumedReliabilityHelp.title).not.toMatch(/workbook/i);
    expect(screen.queryByText("Uncertainty Requirements")).not.toBeInTheDocument();
    expect(
      screen.getByText("Ready for your first measurement point"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Create a function in Instrument Overview/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Risk Inputs/i }));
    fireEvent.click(screen.getByRole("button", { name: /Mitigation Inputs/i }));
    fireEvent.click(sessionInfoToggle);
    expect(screen.queryByText("Risk Inputs")).not.toBeInTheDocument();
    expect(screen.queryByText("Mitigation Inputs")).not.toBeInTheDocument();

    fireEvent.click(sessionInfoToggle);
    expect(screen.getByRole("button", { name: /Risk Inputs/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Mitigation Inputs/i }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Confidence (%)")).toBeInTheDocument();
    expect(screen.getByText("PFA Required")).toBeInTheDocument();
  });

  test("keeps measurement-point actions visible without a redundant accordion", async () => {
    render(
      <ThemeProvider>
        <NotificationProvider>
          <MemoryRouter>
            <UncertaintyApp />
          </MemoryRouter>
        </NotificationProvider>
      </ThemeProvider>,
    );

    await screen.findByText(/No Session Available/i);
    expect(screen.getByTitle("Expand All")).toBeInTheDocument();
    expect(screen.getByTitle("Filter visible columns")).toBeInTheDocument();

    expect(screen.getByTitle("Expand All")).toBeInTheDocument();
    expect(screen.getByTitle("Filter visible columns")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Measurement Points/ }),
    ).not.toBeInTheDocument();
  });

  test("replaces floating notes, images, and help with the session Notes tab", async () => {
    apiMock.state.sessions = [
      {
        id: 102,
        name: "Notes Session",
        notes: "Legacy note",
        noteImages: [],
        measurementAreas: [],
        uuts: [],
        tmdes: [],
        testPoints: [],
        uncReq: {},
      },
    ];

    render(
      <ThemeProvider>
        <NotificationProvider>
          <MemoryRouter>
            <UncertaintyApp />
          </MemoryRouter>
        </NotificationProvider>
      </ThemeProvider>,
    );

    const notesTab = await screen.findByRole("button", { name: "Notes" });
    expect(screen.queryByLabelText("Session images")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Help and tutorial")).not.toBeInTheDocument();
    fireEvent.click(notesTab);
    expect(await screen.findByRole("region", { name: "Session notes" })).toBeInTheDocument();
    expect(screen.getByText("Legacy note")).toBeInTheDocument();
  });

  test("selects the first point for Uncertainty Budget and preserves every tab scroll position", async () => {
    apiMock.state.sessions = [
      {
        id: 103,
        name: "Tab State Session",
        measurementAreas: [],
        uuts: [
          {
            id: "uut-tabs",
            description: "Tab UUT",
            instrument: {
              functions: [
                {
                  id: "fn-tabs",
                  name: "Voltage",
                  unit: "V",
                  ranges: [{ id: "range-tabs", min: 0, max: 10, unit: "V" }],
                },
              ],
            },
          },
        ],
        tmdes: [],
        testPoints: [
          {
            id: "point-tabs",
            associatedUutIds: ["uut-tabs"],
            measurementType: "direct",
            testPointInfo: {
              parameter: { name: "Voltage", value: "5", unit: "V" },
            },
            uutTolerance: {
              functionName: "Voltage",
              rangeId: "range-tabs",
              min: 0,
              max: 10,
              unit: "V",
            },
            tmdeTolerances: [],
            components: [],
          },
        ],
        uncReq: {},
      },
    ];

    render(
      <ThemeProvider>
        <NotificationProvider>
          <MemoryRouter>
            <UncertaintyApp />
          </MemoryRouter>
        </NotificationProvider>
      </ThemeProvider>,
    );

    const overviewTab = await screen.findByRole("button", {
      name: "Instrument Overview",
    });
    const notesTab = screen.getByRole("button", { name: "Notes" });
    const budgetTab = screen.getByRole("button", { name: "Uncertainty Budget" });
    document.querySelector(".analysis-content").scrollTop = 111;

    fireEvent.click(notesTab);
    await screen.findByRole("region", { name: "Session notes" });
    document.querySelector(".analysis-content").scrollTop = 222;

    fireEvent.click(budgetTab);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Uncertainty Budget" }),
      ).toHaveClass("active");
      expect(
        document.querySelector(".detailed-view-section-layout"),
      ).toBeInTheDocument();
    });
    document.querySelector(".analysis-content").scrollTop = 333;

    fireEvent.click(screen.getByRole("button", { name: "Instrument Overview" }));
    await waitFor(() => {
      expect(document.querySelector(".analysis-content").scrollTop).toBe(111);
    });
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    await waitFor(() => {
      expect(document.querySelector(".analysis-content").scrollTop).toBe(222);
    });
    fireEvent.click(screen.getByRole("button", { name: "Uncertainty Budget" }));
    await waitFor(() => {
      expect(document.querySelector(".analysis-content").scrollTop).toBe(333);
    });
  }, 15000);

  test("renders named function headers in the sidebar", async () => {
    apiMock.state.sessions = [
      {
        id: 1,
        name: "Function Sidebar Session",
        analyst: "",
        organization: "NPSL",
        document: "",
        documentDate: "2026-06-25",
        measurementAreas: [
          { id: "area-1", name: "Electrical", color: "#3498db" },
        ],
        uuts: [
          {
            id: "uut-1",
            description: "Fluke DMM",
            measurementAreaId: "area-1",
            instrument: {
              id: "inst-1",
              manufacturer: "Fluke",
              model: "87V",
              functions: [
                {
                  id: "fn-r",
                  name: "Voltage",
                  unit: "V",
                  ranges: [
                    {
                      id: "range-r",
                      min: "0",
                      max: "100",
                      tolerances: { reading: { high: "1", low: "-1", unit: "%" } },
                    },
                  ],
                },
              ],
            },
          },
        ],
        tmdes: [],
        testPoints: [
          {
            id: "tp-1",
            section: "1.1",
            measurementAreaId: "area-1",
            associatedUutIds: ["uut-1"],
            testPointInfo: {
              parameter: { name: "Voltage", value: "10", unit: "V" },
            },
            uutTolerance: {
              functionId: "fn-r",
              functionName: "Voltage",
              rangeId: "range-r",
              min: "0",
              max: "100",
              unit: "V",
            },
            tmdeTolerances: [],
            specifications: {},
            components: [],
          },
        ],
        uncReq: {},
      },
    ];

    render(
      <ThemeProvider>
        <NotificationProvider>
          <MemoryRouter>
            <UncertaintyApp />
          </MemoryRouter>
        </NotificationProvider>
      </ThemeProvider>
    );

    // The sidebar is organized Function -> UUT -> Point. The point's own
    // parameter ("Voltage") is the top-level function node, replacing the old
    // measurement-area row.
    const functionRows = await screen.findAllByText("Voltage");
    expect(
      functionRows.some((row) => row.classList.contains("area-label")),
    ).toBe(true);
  });

  test("keeps UUT functions visible when they have no measurement points", async () => {
    apiMock.state.sessions = [
      {
        id: 2,
        name: "Empty Function Session",
        analyst: "",
        organization: "NPSL",
        document: "",
        documentDate: "2026-06-25",
        measurementAreas: [],
        uuts: [
          {
            id: "uut-empty",
            description: "Pressure Standard",
            instrument: {
              manufacturer: "Fluke",
              model: "700G",
              functions: [
                {
                  id: "fn-pressure",
                  name: "Pressure",
                  unit: "psig",
                  ranges: [],
                },
              ],
            },
          },
          {
            id: "uut-with-point",
            description: "Reference Pressure UUT",
            instrument: {
              manufacturer: "Fluke",
              model: "2700G",
              functions: [
                {
                  id: "fn-pressure-2",
                  name: "Pressure",
                  unit: "psig",
                  ranges: [],
                },
              ],
            },
          },
        ],
        tmdes: [],
        testPoints: [
          {
            id: "pressure-point",
            associatedUutIds: ["uut-with-point"],
            testPointInfo: {
              parameter: { name: "Pressure", value: "10", unit: "psig" },
            },
            tmdeTolerances: [],
            specifications: {},
            components: [],
          },
        ],
        uncReq: {},
      },
    ];
    render(
      <ThemeProvider>
        <NotificationProvider>
          <MemoryRouter>
            <UncertaintyApp />
          </MemoryRouter>
        </NotificationProvider>
      </ThemeProvider>,
    );

    const functionRows = await screen.findAllByText("Pressure");
    expect(
      functionRows.some((row) => row.classList.contains("area-label")),
    ).toBe(true);
    const functionHeader = functionRows
      .find((row) => row.classList.contains("area-label"))
      .closest(".area-header-sticky");
    fireEvent.click(
      within(functionHeader).getByRole("button", { name: "Expand function" }),
    );
    const emptyUutRow = await waitFor(() => {
      const row = document.querySelector(".sidebar-empty-uut-row");
      expect(row).toBeInTheDocument();
      return row;
    });
    expect(emptyUutRow).toHaveTextContent(/Pressure Standard/);
    expect(emptyUutRow).toHaveTextContent("No measurement points");
    expect(document.querySelector(".uut-row")).not.toBeInTheDocument();
    expect(
      within(functionHeader).getByRole("button", { name: "Add direct point" }),
    ).toBeInTheDocument();
  });

  test("applies persistent function settings when adding subsequent points", async () => {
    apiMock.state.sessions = [
      {
        id: 104,
        name: "Function Template Session",
        functionGroups: [],
        measurementAreas: [],
        uuts: [
          {
            id: "uut-template",
            description: "Template UUT",
            instrument: {
              functions: [
                {
                  id: "fn-template",
                  name: "Torque",
                  unit: "lb-ft",
                  ranges: [
                    { id: "range-template", min: 0, max: 100, unit: "lb-ft" },
                  ],
                },
              ],
            },
          },
        ],
        tmdes: [],
        testPoints: [
          {
            id: "point-template",
            associatedUutIds: ["uut-template"],
            measurementType: "derived",
            equationString: "T=L*W",
            equationName: "Torque",
            variableMappings: { L: "Length", W: "Force" },
            variableNominals: {
              L: { value: 2, unit: "ft" },
              W: { value: 10, unit: "lb" },
            },
            inputCorrelations: { "L:W": 0.2 },
            components: [{ id: "operator", name: "Operator", value: 0.1 }],
            tmdeTolerances: [{ id: "tmde-copy", name: "Standard" }],
            budgetPropagationMethod: "montecarlo",
            monteCarloTrials: 25000,
            testPointInfo: {
              parameter: { name: "Torque", value: 20, unit: "lb-ft" },
            },
            uutTolerance: {
              functionName: "Torque",
              rangeId: "range-template",
              min: 0,
              max: 100,
              unit: "lb-ft",
            },
          },
        ],
        uncReq: {},
      },
    ];

    render(
      <ThemeProvider>
        <NotificationProvider>
          <MemoryRouter>
            <UncertaintyApp />
          </MemoryRouter>
        </NotificationProvider>
      </ThemeProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "New Torque point settings" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Derived" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Reuse the first point's equation/i }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Reuse the first point's budget/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add derived point" }));

    await waitFor(() => {
      const savedSession = apiMock.put.mock.calls
        .map((call) => call[1])
        .find((session) => session?.id === 104 && session.testPoints?.length === 2);
      expect(savedSession).toBeTruthy();
      const created = savedSession.testPoints.find(
        (point) => point.id !== "point-template",
      );
      expect(created).toMatchObject({
        measurementType: "derived",
        equationString: "T=L*W",
        equationName: "Torque",
        variableMappings: { L: "Length", W: "Force" },
        inputCorrelations: { "L:W": 0.2 },
        components: [{ id: "operator", name: "Operator", value: 0.1 }],
        tmdeTolerances: [{ id: "tmde-copy", name: "Standard" }],
        budgetPropagationMethod: "montecarlo",
        monteCarloTrials: 25000,
      });
      expect(savedSession.functionGroups[0].pointCreationSettings).toEqual({
        mode: "derived",
        reuseEquation: true,
        reuseBudget: true,
      });
    });
  }, 15000);

  test("keeps Delete scoped to the open instrument builder", async () => {
    apiMock.state.sessions = [
      {
        id: 3,
        name: "Keyboard Ownership Session",
        analyst: "",
        organization: "NPSL",
        document: "",
        documentDate: "2026-07-16",
        measurementAreas: [],
        uuts: [
          {
            id: "uut-behind-modal",
            description: "Underlying Pressure UUT",
            instrument: {
              id: "uut-instrument",
              manufacturer: "Fluke",
              model: "700G",
              functions: [
                {
                  id: "pressure-function",
                  name: "Pressure",
                  unit: "psig",
                  ranges: [],
                },
              ],
            },
          },
        ],
        tmdes: [],
        testPoints: [],
        uncReq: {},
      },
    ];
    apiMock.state.instruments = [
      {
        id: "library-delete-target",
        manufacturer: "Acme",
        model: "LIB-DELETE",
        description: "Library Delete Target",
        scope: "local",
        functions: [
          {
            id: "voltage-function",
            name: "Voltage",
            unit: "V",
            ranges: [],
          },
        ],
      },
    ];

    render(
      <ThemeProvider>
        <NotificationProvider>
          <MemoryRouter>
            <UncertaintyApp />
          </MemoryRouter>
        </NotificationProvider>
      </ThemeProvider>,
    );

    const uutLabels = await screen.findAllByText(/Underlying Pressure UUT/);
    const uutRow = uutLabels
      .map((label) => label.closest("tr"))
      .find(Boolean);
    expect(uutRow).toBeTruthy();
    fireEvent.click(uutRow);
    expect(uutRow).toHaveClass("selected-row");

    fireEvent.click(
      screen.getByRole("button", { name: "Instrument builder" }),
    );
    const libraryRow = (await screen.findByText("LIB-DELETE")).closest("tr");
    fireEvent.click(libraryRow);
    fireEvent.keyDown(window, { key: "Delete" });

    expect(
      screen.getByRole("alertdialog", { name: "Delete Instrument" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("alertdialog", { name: "Delete UUT" }),
    ).not.toBeInTheDocument();
  });

  test("adds a manual budget component as an inline row instead of a modal", async () => {
    apiMock.state.sessions = [
      {
        id: 4,
        name: "Inline Manual Budget Session",
        analyst: "",
        organization: "NPSL",
        document: "",
        documentDate: "2026-07-16",
        measurementAreas: [],
        uuts: [
          {
            id: "uut-inline-manual",
            description: "Voltage UUT",
            instrument: {
              id: "inst-inline-manual",
              functions: [
                {
                  id: "fn-voltage-inline",
                  name: "Voltage",
                  unit: "V",
                  ranges: [
                    {
                      id: "range-voltage-inline",
                      min: "0",
                      max: "100",
                      unit: "V",
                      tolerances: {
                        reading: { high: "1", low: "-1", unit: "%" },
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
        tmdes: [],
        testPoints: [
          {
            id: "tp-inline-manual",
            associatedUutIds: ["uut-inline-manual"],
            activeUutId: "uut-inline-manual",
            measurementType: "direct",
            testPointInfo: {
              parameter: { name: "Voltage", value: "10", unit: "V" },
            },
            uutTolerance: {
              functionId: "fn-voltage-inline",
              functionName: "Voltage",
              rangeId: "range-voltage-inline",
              min: "0",
              max: "100",
              unit: "V",
              tolerances: {
                reading: { high: "1", low: "-1", unit: "%" },
              },
            },
            tmdeTolerances: [],
            specifications: {},
            components: [],
          },
        ],
        uncReq: {
          uncertaintyConfidence: 95,
          reliability: 85,
          guardBandMultiplier: 1,
        },
      },
    ];
    window.localStorage.setItem(
      "uncertalytics.uiPreferences.v1:4",
      JSON.stringify({
        expandedFunctions: ["voltage"],
        expandedUuts: ["voltage::uut-inline-manual"],
        sidebarColumns: {
          gbPfa: true,
          noGbPfa: true,
        },
      }),
    );

    render(
      <ThemeProvider>
        <NotificationProvider>
          <MemoryRouter>
            <UncertaintyApp />
          </MemoryRouter>
        </NotificationProvider>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(document.querySelectorAll(".point-grid-item")).toHaveLength(1);
    });
    const columnGroups = Array.from(
      document.querySelectorAll(".sidebar-column-group"),
    );
    expect(columnGroups.map((group) => group.textContent.trim())).toEqual([
      "Measurement",
      "Risk",
      "Mitigation (GB + Int)",
      "Mitigation (Int Only)",
    ]);
    expect(columnGroups.map((group) => group.style.gridColumn)).toEqual([
      "span 7",
      "span 2",
      "span 1",
      "span 1",
    ]);
    fireEvent.click(screen.getByTitle("Filter visible columns"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Section" }));
    expect(
      screen.getByRole("button", { name: "Sort by Section" }),
    ).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    fireEvent.click(
      screen.getByRole("button", { name: "New Voltage point settings" }),
    );
    const derivedOption = screen.getByRole("radio", { name: "Derived" });
    expect(derivedOption).toHaveAttribute("aria-checked", "false");
    fireEvent.click(derivedOption);
    expect(derivedOption).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("button", { name: "Add derived point" }),
    ).toBeInTheDocument();

    const pointRow = document.querySelector(".point-grid-item");
    const columnHeader = document.querySelector(".sidebar-column-headers");
    expect(pointRow.style.gridTemplateColumns).toBe(
      columnHeader.style.gridTemplateColumns,
    );
    expect(pointRow.style.gridTemplateColumns).toMatch(/^minmax\(120px, 1\.35fr\) /);
    expect(pointRow.style.gridTemplateColumns).not.toContain("ch");
    fireEvent.click(pointRow);
    expect(pointRow).toHaveClass("active-point");
    expect(
      await screen.findByRole("button", { name: "Uncertainty Budget" }),
    ).toBeInTheDocument();

    const addButton = await screen.findByRole("button", {
      name: "Add component to budget",
    });
    fireEvent.click(addButton);
    fireEvent.click(
      await screen.findByRole("button", { name: /Add manual component/i }),
    );

    expect(await screen.findByLabelText("Error source name")).toBeInTheDocument();
    expect(
      screen.queryByText("Manual Component", { selector: "h3" }),
    ).not.toBeInTheDocument();
  }, 15000);

  test("opens the relevant UUT function and collapses irrelevant functions in detail", async () => {
    apiMock.state.sessions = [
      {
        id: 3,
        name: "Accordion Session",
        analyst: "",
        organization: "NPSL",
        document: "",
        documentDate: "2026-07-16",
        measurementAreas: [],
        uuts: [
          {
            id: "uut-accordion",
            description: "Voltage UUT",
            instrument: {
              id: "inst-accordion",
              functions: [
                {
                  id: "fn-voltage",
                  name: "Voltage",
                  unit: "V",
                  ranges: [
                    {
                      id: "range-voltage",
                      min: "0",
                      max: "100",
                      unit: "V",
                      tolerances: {
                        reading: { high: "1", low: "-1", unit: "%" },
                      },
                    },
                  ],
                },
                {
                  id: "fn-pressure",
                  name: "Pressure",
                  unit: "psi",
                  ranges: [
                    {
                      id: "range-pressure",
                      min: "0",
                      max: "100",
                      unit: "psi",
                    },
                  ],
                },
              ],
            },
          },
        ],
        tmdes: [],
        testPoints: [
          {
            id: "tp-accordion-1",
            associatedUutIds: ["uut-accordion"],
            activeUutId: "uut-accordion",
            testPointInfo: {
              parameter: { name: "Voltage", value: "10", unit: "V" },
            },
            uutTolerance: {
              functionId: "fn-voltage",
              functionName: "Voltage",
              rangeId: "range-voltage",
              min: "0",
              max: "100",
              unit: "V",
              tolerances: {
                reading: { high: "1", low: "-1", unit: "%" },
              },
            },
            tmdeTolerances: [],
            specifications: {},
            components: [],
          },
          {
            id: "tp-accordion-2",
            associatedUutIds: ["uut-accordion"],
            activeUutId: "uut-accordion",
            testPointInfo: {
              parameter: { name: "Voltage", value: "20", unit: "V" },
            },
            uutTolerance: {
              functionId: "fn-voltage",
              functionName: "Voltage",
              rangeId: "range-voltage",
              min: "0",
              max: "100",
              unit: "V",
              tolerances: {
                reading: { high: "1", low: "-1", unit: "%" },
              },
            },
            tmdeTolerances: [],
            specifications: {},
            components: [],
          },
        ],
        uncReq: {},
      },
    ];
    window.localStorage.setItem(
      "uncertalytics.uiPreferences.v1:3",
      JSON.stringify({
        expandedFunctions: ["voltage"],
        expandedUuts: ["voltage::uut-accordion"],
      }),
    );

    render(
      <ThemeProvider>
        <NotificationProvider>
          <MemoryRouter>
            <UncertaintyApp />
          </MemoryRouter>
        </NotificationProvider>
      </ThemeProvider>,
    );

    const collapseButtons = await screen.findAllByRole("button", {
      name: "Collapse function instruments",
    });
    fireEvent.click(collapseButtons[0]);
    expect(
      screen.getByRole("button", { name: "Expand function instruments" }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(document.querySelectorAll(".point-grid-item")).toHaveLength(2);
    });
    fireEvent.click(document.querySelectorAll(".point-grid-item")[0]);
    const firstPointCollapsed = await screen.findByRole("button", {
      name: "Expand function instruments",
    });
    expect(firstPointCollapsed.closest("tr")).toHaveTextContent("Pressure");

    await waitFor(() => {
      expect(document.querySelectorAll(".point-grid-item")).toHaveLength(2);
    });
    fireEvent.click(document.querySelectorAll(".point-grid-item")[1]);
    const secondPointCollapsed = await screen.findByRole("button", {
      name: "Expand function instruments",
    });
    expect(secondPointCollapsed.closest("tr")).toHaveTextContent("Pressure");

    fireEvent.click(screen.getByRole("button", { name: "Instrument Overview" }));
    const overviewCollapsed = await screen.findByRole("button", {
      name: "Expand function instruments",
    });
    expect(overviewCollapsed.closest("tr")).toHaveTextContent("Pressure");
  }, 15000);

  test("zooms a table around the cursor without zooming the page", async () => {
    render(
      <ThemeProvider>
        <NotificationProvider>
          <MemoryRouter>
            <UncertaintyApp />
          </MemoryRouter>
        </NotificationProvider>
      </ThemeProvider>
    );
    await screen.findByText(/No Session Available/i);

    const surface = document.createElement("div");
    surface.className = "panel-table-container";
    surface.scrollLeft = 40;
    surface.scrollTop = 60;
    surface.getBoundingClientRect = () => ({
      left: 100,
      top: 200,
      right: 500,
      bottom: 500,
      width: 400,
      height: 300,
      x: 100,
      y: 200,
      toJSON: () => {},
    });

    const table = document.createElement("table");
    const cell = document.createElement("td");
    table.appendChild(cell);
    surface.appendChild(table);
    document.body.appendChild(surface);

    fireEvent.wheel(cell, {
      ctrlKey: true,
      deltaY: -100,
      clientX: 250,
      clientY: 300,
    });

    expect(surface.dataset.zoomLevel).toBe("1.1");
    expect(table.style.zoom).toBe("1.1");
    expect(surface.scrollLeft).toBeCloseTo(59);
    expect(surface.scrollTop).toBeCloseTo(76);
    expect(document.documentElement.style.zoom || "").toBe("");

    surface.remove();
  });

  test("zooms the measurement equation area around the cursor", async () => {
    render(
      <ThemeProvider>
        <NotificationProvider>
          <MemoryRouter>
            <UncertaintyApp />
          </MemoryRouter>
        </NotificationProvider>
      </ThemeProvider>
    );
    await screen.findByText(/No Session Available/i);

    const surface = document.createElement("div");
    surface.className = "measurement-equation-card measurement-equation-zoom-surface";
    surface.scrollLeft = 20;
    surface.scrollTop = 30;
    surface.getBoundingClientRect = () => ({
      left: 50,
      top: 100,
      right: 450,
      bottom: 300,
      width: 400,
      height: 200,
      x: 50,
      y: 100,
      toJSON: () => {},
    });

    const content = document.createElement("div");
    content.className = "scoped-zoom-content";
    const input = document.createElement("input");
    content.appendChild(input);
    surface.appendChild(content);
    document.body.appendChild(surface);

    fireEvent.wheel(input, {
      ctrlKey: true,
      deltaY: -100,
      clientX: 150,
      clientY: 160,
    });

    expect(surface.dataset.zoomLevel).toBe("1.1");
    expect(content.style.zoom).toBe("1.1");
    expect(surface.scrollLeft).toBeCloseTo(32);
    expect(surface.scrollTop).toBeCloseTo(39);

    surface.remove();
  });
});
