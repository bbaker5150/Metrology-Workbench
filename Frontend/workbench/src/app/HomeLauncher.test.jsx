import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}));

// The medallion pulls in three.js/WebGL, which jsdom cannot execute.
vi.mock("./LauncherEmblem", () => ({
  default: ({ onReady }) => {
    React.useEffect(() => onReady?.(), [onReady]);
    return <div data-testid="launcher-emblem" />;
  },
}));

const preloads = {
  "ac-shunt": vi.fn().mockResolvedValue({}),
  uncertainty: vi.fn().mockResolvedValue({}),
  reports: vi.fn().mockResolvedValue({}),
};

vi.mock("./moduleRegistry", () => ({
  MODULES: [
    {
      id: "ac-shunt",
      route: "ac-shunt",
      title: "Run Calibration",
      subtitle: "AC Shunt calibration & data collection",
      path: "/ac-shunt",
      status: "ready",
      Component: () => null,
      get preload() { return preloads["ac-shunt"]; },
    },
    {
      id: "uncertainty",
      route: "uncertalytics",
      title: "Uncertainty Budget",
      subtitle: "Assemble an uncertainty budget",
      path: "/uncertalytics",
      status: "ready",
      Component: () => null,
      get preload() { return preloads.uncertainty; },
    },
    {
      id: "reports",
      route: "report-of-calibration",
      title: "Report of Calibration",
      subtitle: "Generate a calibration report",
      path: "/report-of-calibration",
      status: "coming-soon",
      Component: null,
      get preload() { return preloads.reports; },
    },
  ],
}));

const HomeLauncher = (await import("./HomeLauncher")).default;

const renderLauncher = () =>
  render(
    <MemoryRouter initialEntries={["/home"]}>
      <Routes>
        <Route path="/home" element={<HomeLauncher />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  navigate.mockClear();
  Object.values(preloads).forEach((fn) => {
    fn.mockClear();
    fn.mockResolvedValue({});
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("layout", () => {
  it("renders the lab heading", () => {
    renderLauncher();
    expect(screen.getByText("Navy Primary Standard Lab")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Metrology Workbench" }),
    ).toBeInTheDocument();
  });

  it("renders one card per registered module with its title and subtitle", () => {
    renderLauncher();
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByText("Run Calibration")).toBeInTheDocument();
    expect(screen.getByText("AC Shunt calibration & data collection")).toBeInTheDocument();
  });

  it("marks the emblem ready once the lazy 3D module resolves", async () => {
    const { container } = renderLauncher();
    await waitFor(() =>
      expect(container.querySelector(".workbench-home-emblem-canvas.is-ready")).toBeTruthy(),
    );
  });
});

describe("ready modules", () => {
  it("labels a ready card as openable", () => {
    renderLauncher();
    expect(screen.getByLabelText("Open Run Calibration")).toBeEnabled();
  });

  it("navigates to the module path on click", async () => {
    renderLauncher();
    await userEvent.click(screen.getByLabelText("Open Run Calibration"));
    expect(navigate).toHaveBeenCalledWith("/ac-shunt");
  });

  it("warms the module chunk on hover before any click", async () => {
    renderLauncher();
    await userEvent.hover(screen.getByLabelText("Open Run Calibration"));
    expect(preloads["ac-shunt"]).toHaveBeenCalled();
  });

  it("warms the module chunk on keyboard focus", async () => {
    renderLauncher();
    await userEvent.tab();
    expect(
      preloads["ac-shunt"].mock.calls.length + preloads.uncertainty.mock.calls.length,
    ).toBeGreaterThan(0);
  });
});

describe("coming-soon modules", () => {
  it("disables the card and labels it as coming soon", () => {
    renderLauncher();
    const card = screen.getByLabelText("Report of Calibration — coming soon");
    expect(card).toBeDisabled();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
  });

  it("does not navigate when a disabled card is clicked", async () => {
    renderLauncher();
    await userEvent.click(
      screen.getByLabelText("Report of Calibration — coming soon"),
      { pointerEventsCheck: 0 },
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("speculative preloading", () => {
  it("warms the uncertainty workspace right after the launcher paints", async () => {
    renderLauncher();
    await waitFor(() => expect(preloads.uncertainty).toHaveBeenCalled());
  });

  it("does not disturb the launcher when the speculative warm-up rejects", async () => {
    preloads.uncertainty.mockRejectedValue(new Error("chunk 404"));
    renderLauncher();
    await waitFor(() => expect(preloads.uncertainty).toHaveBeenCalled());
    expect(
      screen.getByRole("heading", { name: "Metrology Workbench" }),
    ).toBeInTheDocument();
  });

  it("does not throw when a hover warm-up rejects", async () => {
    preloads["ac-shunt"].mockRejectedValue(new Error("chunk 404"));
    renderLauncher();
    await userEvent.hover(screen.getByLabelText("Open Run Calibration"));
    expect(screen.getByLabelText("Open Run Calibration")).toBeInTheDocument();
  });
});
