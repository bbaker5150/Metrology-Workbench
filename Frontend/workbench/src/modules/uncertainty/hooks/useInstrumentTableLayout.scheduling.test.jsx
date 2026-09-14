import React, { useRef } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import useInstrumentTableLayout from "./useInstrumentTableLayout";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("coalesces drag style and resize notifications, yielding before measuring again", () => {
  let mutation, resize;
  let nextId = 0;
  const frames = new Map();
  const disconnected = vi.fn();
  vi.stubGlobal("MutationObserver", class { constructor(callback) { mutation = callback; } observe() {} disconnect() { disconnected(); } });
  vi.stubGlobal("ResizeObserver", class { constructor(callback) { resize = callback; } observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", callback => { frames.set(++nextId, callback); return nextId; });
  vi.stubGlobal("cancelAnimationFrame", id => frames.delete(id));
  // Count attempted layout reads. jsdom's empty rects deliberately skip the
  // browser geometry calculation; this tests the observer's event lifecycle.
  const measure = vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([]);
  function Fixture() { const ref = useRef(null); const attach = useInstrumentTableLayout(ref); return <div ref={attach}><table><tbody /></table></div>; }
  const { unmount } = render(<Fixture />);
  measure.mockClear();
  for (let i = 0; i < 100; i++) { mutation(); resize(); }
  expect(measure).not.toHaveBeenCalled();
  expect(frames.size).toBe(1);
  const pending = [...frames.values()]; frames.clear();
  act(() => pending.forEach(callback => callback()));
  expect(measure).toHaveBeenCalledOnce();
  mutation();
  expect(frames.size).toBe(1);
  unmount();
  expect(frames.size).toBe(0);
  expect(disconnected).toHaveBeenCalled();
});
