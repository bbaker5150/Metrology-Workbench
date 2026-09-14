import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import usePointerResize from "./usePointerResize";

let frames;
let serial;
const pointer = (type, clientX = 0, pointerId = 7) => {
  const event = new Event(type);
  Object.assign(event, { pointerId, clientX });
  document.dispatchEvent(event);
};
const paint = () => {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach(callback => callback()));
};
const start = { button: 0, pointerId: 7, preventDefault: () => {}, stopPropagation: () => {} };

beforeEach(() => {
  frames = new Map(); serial = 0;
  vi.stubGlobal("requestAnimationFrame", callback => { frames.set(++serial, callback); return serial; });
  vi.stubGlobal("cancelAnimationFrame", id => frames.delete(id));
  document.body.style.cursor = "crosshair";
  document.body.style.userSelect = "text";
});
afterEach(() => { vi.unstubAllGlobals(); document.body.removeAttribute("style"); });

describe("resize gesture lifetime", () => {
  it("batches pointer movement and applies the last pending position on release", () => {
    const { result } = renderHook(usePointerResize);
    const onMove = vi.fn(), onFinish = vi.fn();
    act(() => result.current(start, { onMove, onFinish }));
    pointer("pointermove", 10); pointer("pointermove", 20); pointer("pointermove", 30);
    expect(frames.size).toBe(1); expect(onMove).not.toHaveBeenCalled();
    paint(); expect(onMove).toHaveBeenCalledOnce(); expect(onMove.mock.calls[0][0].clientX).toBe(30);
    pointer("pointermove", 40); pointer("pointerup");
    expect(onMove).toHaveBeenCalledTimes(2); expect(onMove.mock.calls[1][0].clientX).toBe(40);
    expect(onFinish).toHaveBeenCalledOnce(); expect(frames.size).toBe(0);
    expect(document.body.style.cursor).toBe("crosshair");
  });

  it.each(["pointercancel", "blur", "dragstart"])("stops resizing after %s even without pointerup", type => {
    const { result } = renderHook(usePointerResize);
    const onMove = vi.fn();
    act(() => result.current(start, { onMove }));
    pointer("pointermove", 10); paint();
    if (type === "blur") window.dispatchEvent(new Event("blur"));
    else pointer(type);
    pointer("pointermove", 900); paint();
    expect(onMove).toHaveBeenCalledOnce();
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");
  });

  it("discards pending work and listeners when its table unmounts", () => {
    const { result, unmount } = renderHook(usePointerResize);
    const onMove = vi.fn(), onFinish = vi.fn();
    act(() => result.current(start, { onMove, onFinish }));
    pointer("pointermove", 10);
    unmount(); paint(); pointer("pointermove", 90); pointer("pointerup");
    expect(onMove).not.toHaveBeenCalled(); expect(onFinish).not.toHaveBeenCalled();
    expect(document.body.style.userSelect).toBe("text");
  });

  it("ignores another pointer and replaces an unfinished gesture without stacking listeners", () => {
    const { result } = renderHook(usePointerResize);
    const first = vi.fn(), second = vi.fn();
    act(() => result.current(start, { onMove: first }));
    pointer("pointermove", 10);
    act(() => result.current(start, { onMove: second }));
    pointer("pointercancel", 0, 8); pointer("pointermove", 50, 8); paint();
    expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
    pointer("pointermove", 70); paint();
    expect(second).toHaveBeenCalledOnce();
    pointer("pointerup"); expect(document.body.style.cursor).toBe("crosshair");
  });
});
