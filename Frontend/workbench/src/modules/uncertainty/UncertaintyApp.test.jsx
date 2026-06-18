import { describe, test, expect, vi, beforeAll } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The analysis tree transitively imports the full Plotly bundle; stub it so the
// jsdom smoke test doesn't load it. (Charts only render once a point is
// selected, which this no-backend test never reaches.)
vi.mock("plotly.js-dist", () => ({ default: {} }));

// No Django backend in unit tests: make the session store resolve into an
// empty state instead of hitting the network.
vi.mock("axios", () => {
  const ok = (data) => () => Promise.resolve({ data });
  return {
    default: {
      get: vi.fn(ok([])),
      post: vi.fn(ok({})),
      put: vi.fn(ok({})),
      delete: vi.fn(ok({})),
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
