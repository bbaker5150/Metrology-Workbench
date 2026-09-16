import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import UiSettings, { UI_SCALE_LOCK_KEY, UI_FIT_WINDOW_EVENT } from "./UiSettings";
import ZoomToast from "./ZoomToast";

afterEach(() => {
  cleanup();
  localStorage.removeItem(UI_SCALE_LOCK_KEY);
  delete window.require;
});

describe("app zoom shortcuts", () => {
  it("compensates layout height at every CSS zoom and on window resize", () => {
    render(<ZoomToast />);
    fireEvent.keyDown(window, { key: '-', ctrlKey: true });
    const root = document.documentElement;
    expect(parseFloat(root.style.getPropertyValue('--app-viewport-height')) * .9).toBeCloseTo(window.innerHeight);
    fireEvent(window, new Event('resize'));
    expect(parseFloat(root.style.getPropertyValue('--app-viewport-height')) * .9).toBeCloseTo(window.innerHeight);
  });
  it("fits usable window space without multiplying OS display density", () => {
    render(<ZoomToast />);
    fireEvent(window, new Event(UI_FIT_WINDOW_EVENT));
    const expected = Math.max(.6, Math.floor(Math.min(1, window.innerWidth / 1440, window.innerHeight / 900) * 100) / 100);
    expect(Number(document.documentElement.style.zoom)).toBe(expected);
    // A later resize preserves the user's chosen scale; Fit is explicit.
    fireEvent(window, new Event('resize'));
    expect(Number(document.documentElement.style.zoom)).toBe(expected);
  });
  it("zooms the entire browser app in 10% steps, including from inputs, and resets", () => {
    render(<><input aria-label="Editing" /><ZoomToast /></>);
    const input = screen.getByLabelText("Editing");
    input.focus();
    fireEvent.keyDown(input, { key: "+", ctrlKey: true, shiftKey: true });
    expect(document.documentElement.style.zoom).toBe("1.1");
    fireEvent.keyDown(input, { key: "=", ctrlKey: true });
    expect(document.documentElement.style.zoom).toBe("1.2");
    fireEvent.keyDown(input, { key: "-", ctrlKey: true });
    expect(document.documentElement.style.zoom).toBe("1.1");
    fireEvent.keyDown(input, { key: "0", ctrlKey: true });
    expect(document.documentElement.style.zoom).toBe("1");
    expect(screen.getByText("App zoom 100%")).toBeInTheDocument();
  });

  it("uses Electron page zoom without multiplying CSS zoom", () => {
    let zoom = 0.75;
    const webFrame = { getZoomFactor: () => zoom, setZoomFactor: vi.fn(next => { zoom = next; }) };
    window.require = () => ({ webFrame });
    render(<ZoomToast />);
    fireEvent.keyDown(window, { key: "+", ctrlKey: true });
    expect(zoom).toBe(0.85);
    fireEvent.keyDown(window, { key: "-", metaKey: true });
    expect(zoom).toBe(0.75);
    expect(document.documentElement.style.zoom || "").toBe("");
    fireEvent.keyDown(window, { key: "+", ctrlKey: true, altKey: true });
    expect(zoom).toBe(0.75);
  });
});

it("locks Ctrl+wheel to page zoom by default, unlocks it, and resets all zoom to 100%", () => {
  render(<><UiSettings /><table><tbody><tr><td>Table surface</td></tr></tbody></table><ZoomToast /></>);
  const cell = screen.getByText("Table surface");
  fireEvent.wheel(cell, { ctrlKey: true, deltaY: -100 });
  expect(document.documentElement.style.zoom).toBe("1.1");
  fireEvent.click(screen.getByRole("radio", { name: "Individual sections", hidden: true }));
  fireEvent.wheel(cell, { ctrlKey: true, deltaY: -100 });
  expect(document.documentElement.style.zoom).toBe("1.1");
  fireEvent.click(screen.getByText("Reset to 100%"));
  expect(document.documentElement.style.zoom).toBe("1");
  expect(localStorage.getItem(UI_SCALE_LOCK_KEY)).toBe("false");
});
