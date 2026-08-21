import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useFloatingWindow } from "./useFloatingWindow";

const setViewport = (width, height) => {
  window.innerWidth = width;
  window.innerHeight = height;
};

// Build a mousedown-ish event whose target participates in `closest()`.
const mouseEvent = (clientX, clientY, target = document.createElement("div")) => ({
  clientX,
  clientY,
  target,
});

const dispatchMove = (clientX, clientY) => {
  act(() => {
    document.dispatchEvent(new MouseEvent("mousemove", { clientX, clientY }));
  });
};

const dispatchUp = () => {
  act(() => {
    document.dispatchEvent(new MouseEvent("mouseup"));
  });
};

beforeEach(() => {
  setViewport(1200, 900);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("initial placement", () => {
  it("centers the window in the viewport when opened", () => {
    const { result } = renderHook(() =>
      useFloatingWindow({ isOpen: true, defaultWidth: 600, defaultHeight: 400 }),
    );
    expect(result.current.position).toEqual({ x: 300, y: 250 });
  });

  it("stays at the origin while closed", () => {
    const { result } = renderHook(() => useFloatingWindow({ isOpen: false }));
    expect(result.current.position).toEqual({ x: 0, y: 0 });
  });

  it("honors an explicit initialPosition over centering", () => {
    const { result } = renderHook(() =>
      useFloatingWindow({ isOpen: true, initialPosition: { x: 42, y: 99 } }),
    );
    expect(result.current.position).toEqual({ x: 42, y: 99 });
  });

  it("keeps a tall window centered and fully visible", () => {
    setViewport(1000, 500);
    const { result } = renderHook(() =>
      useFloatingWindow({ isOpen: true, defaultWidth: 400, defaultHeight: 460 }),
    );
    expect(result.current.position).toEqual({ x: 300, y: 20 });
  });

  it("never places the window off the left edge when it is wider than the viewport", () => {
    setViewport(400, 900);
    const { result } = renderHook(() =>
      useFloatingWindow({ isOpen: true, defaultWidth: 800, defaultHeight: 300 }),
    );
    expect(result.current.position.x).toBe(16);
  });

  it('treats "auto" dimensions as the 400px fallback', () => {
    const { result } = renderHook(() =>
      useFloatingWindow({ isOpen: true, defaultWidth: "auto", defaultHeight: "auto" }),
    );
    expect(result.current.position).toEqual({ x: 400, y: 250 });
  });

  it("defaults to a 600x600 window when no dimensions are given", () => {
    const { result } = renderHook(() => useFloatingWindow({ isOpen: true }));
    expect(result.current.position).toEqual({ x: 300, y: 150 });
  });

  it("tolerates being called with no config at all", () => {
    const { result } = renderHook(() => useFloatingWindow());
    expect(result.current.position).toEqual({ x: 0, y: 0 });
  });

  it("re-centers when the window is closed and reopened", () => {
    const { result, rerender } = renderHook(({ isOpen }) => useFloatingWindow({ isOpen }), {
      initialProps: { isOpen: true },
    });
    act(() => result.current.setPosition({ x: 5, y: 5 }));
    expect(result.current.position).toEqual({ x: 5, y: 5 });

    rerender({ isOpen: false });
    rerender({ isOpen: true });
    expect(result.current.position).toEqual({ x: 300, y: 150 });
  });
});

describe("style output", () => {
  it("exposes a fixed-position style bound to the current coordinates", () => {
    const { result } = renderHook(() =>
      useFloatingWindow({ isOpen: true, defaultWidth: 600, defaultHeight: 400 }),
    );
    expect(result.current.style).toEqual({
      position: "fixed",
      top: 250,
      left: 300,
      margin: 0,
    });
  });
});

describe("dragging", () => {
  const open = () =>
    renderHook(() =>
      useFloatingWindow({ isOpen: true, defaultWidth: 600, defaultHeight: 400 }),
    );

  it("moves the window by the pointer delta, preserving the grab offset", () => {
    const { result } = open();
    // Grab 20px right / 10px below the window's top-left corner.
    act(() => result.current.handleMouseDown(mouseEvent(320, 260)));
    dispatchMove(420, 360);
    expect(result.current.position).toEqual({ x: 400, y: 350 });
  });

  it("stops moving once the pointer is released", () => {
    const { result } = open();
    act(() => result.current.handleMouseDown(mouseEvent(300, 250)));
    dispatchMove(500, 500);
    dispatchUp();
    dispatchMove(900, 900);
    expect(result.current.position).toEqual({ x: 500, y: 500 });
  });

  it("ignores pointer movement that was never preceded by a grab", () => {
    const { result } = open();
    dispatchMove(900, 900);
    expect(result.current.position).toEqual({ x: 300, y: 250 });
  });

  it("clamps the window so it cannot be dragged up under the header", () => {
    const { result } = open();
    act(() => result.current.handleMouseDown(mouseEvent(300, 250)));
    dispatchMove(300, -500);
    expect(result.current.position.y).toBe(0);
  });

  it("keeps at least 50px visible when dragged toward the right edge", () => {
    const { result } = open();
    act(() => result.current.handleMouseDown(mouseEvent(300, 250)));
    dispatchMove(5000, 300);
    expect(result.current.position.x).toBe(window.innerWidth - 50);
  });

  it("snaps back when dragged far off the left edge", () => {
    const { result } = open();
    act(() => result.current.handleMouseDown(mouseEvent(300, 250)));
    dispatchMove(-5000, 300);
    expect(result.current.position.x).toBe(-100);
  });

  it("does not start a drag from a button, so window controls stay clickable", () => {
    const { result } = open();
    const button = document.createElement("button");
    document.body.appendChild(button);
    act(() => result.current.handleMouseDown(mouseEvent(320, 260, button)));
    dispatchMove(900, 900);
    expect(result.current.position).toEqual({ x: 300, y: 250 });
  });

  it("does not start a drag from an input, so text stays selectable", () => {
    const { result } = open();
    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => result.current.handleMouseDown(mouseEvent(320, 260, input)));
    dispatchMove(900, 900);
    expect(result.current.position).toEqual({ x: 300, y: 250 });
  });

  it("respects an explicit .no-drag opt-out region", () => {
    const { result } = open();
    const region = document.createElement("div");
    region.className = "no-drag";
    const child = document.createElement("span");
    region.appendChild(child);
    document.body.appendChild(region);

    act(() => result.current.handleMouseDown(mouseEvent(320, 260, child)));
    dispatchMove(900, 900);
    expect(result.current.position).toEqual({ x: 300, y: 250 });
  });

  it("detaches its document listeners on unmount", () => {
    const { result, unmount } = open();
    act(() => result.current.handleMouseDown(mouseEvent(300, 250)));
    const before = result.current.position;
    unmount();
    dispatchMove(800, 800);
    expect(result.current.position).toEqual(before);
  });
});
