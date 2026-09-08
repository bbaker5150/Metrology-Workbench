import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ZoomToast from "./ZoomToast";

afterEach(() => {
  cleanup();
  delete window.require;
});

describe("app zoom shortcuts", () => {
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
    expect(document.documentElement.style.zoom || "").toBe("");
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
