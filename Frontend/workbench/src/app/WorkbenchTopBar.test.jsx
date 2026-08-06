import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkbenchTopBar from "./WorkbenchTopBar";
import WorkbenchShell from "./WorkbenchShell";

const toggleTheme = vi.fn();
let currentTheme = "light";

vi.mock("../shared/ThemeContext", () => ({
  useTheme: () => ({ theme: currentTheme, toggleTheme }),
}));

// The caption controls are Electron-only and covered by their own suite.
vi.mock("../shared/CaptionControls", () => ({
  default: () => <div data-testid="caption-controls" />,
}));

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<WorkbenchTopBar />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  currentTheme = "light";
  toggleTheme.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("left side", () => {
  it.each(["/", "/home"])("shows the plain app title at %s", (path) => {
    renderAt(path);
    expect(screen.getByText("Metrology Workbench")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Return to the Workbench launcher"),
    ).not.toBeInTheDocument();
  });

  it("shows a back-to-launcher button inside a module route", () => {
    renderAt("/ac-shunt");
    expect(
      screen.getByLabelText("Return to the Workbench launcher"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Metrology Workbench")).not.toBeInTheDocument();
  });

  it("navigates back to the launcher when the back button is clicked", async () => {
    render(
      <MemoryRouter initialEntries={["/ac-shunt"]}>
        <Routes>
          <Route path="/" element={<WorkbenchShell />}>
            <Route path="home" element={<div>launcher</div>} />
            <Route path="ac-shunt" element={<div>module</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("module")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Return to the Workbench launcher"));
    expect(screen.getByText("launcher")).toBeInTheDocument();
  });
});

describe("theme toggle", () => {
  it("offers dark mode while light is active", () => {
    currentTheme = "light";
    renderAt("/home");
    expect(screen.getByLabelText("Switch to dark mode")).toBeInTheDocument();
  });

  it("offers light mode while dark is active", () => {
    currentTheme = "dark";
    renderAt("/home");
    expect(screen.getByLabelText("Switch to light mode")).toBeInTheDocument();
  });

  it("forwards the click event so the wipe can start at the pointer", async () => {
    renderAt("/home");
    await userEvent.click(screen.getByLabelText("Switch to dark mode"));
    expect(toggleTheme).toHaveBeenCalledTimes(1);
    expect(toggleTheme.mock.calls[0][0]).toBeTruthy();
  });
});

describe("window chrome", () => {
  it("always renders the caption controls slot", () => {
    renderAt("/ac-shunt");
    expect(screen.getByTestId("caption-controls")).toBeInTheDocument();
  });

  it("renders the bar as a header landmark on every route", () => {
    renderAt("/uncertalytics");
    expect(screen.getByRole("banner")).toHaveClass("workbench-topbar");
  });
});

describe("WorkbenchShell", () => {
  it("renders the top bar above the active route's outlet content", () => {
    render(
      <MemoryRouter initialEntries={["/ac-shunt"]}>
        <Routes>
          <Route path="/" element={<WorkbenchShell />}>
            <Route path="ac-shunt" element={<div>module body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByText("module body")).toBeInTheDocument();
  });
});
