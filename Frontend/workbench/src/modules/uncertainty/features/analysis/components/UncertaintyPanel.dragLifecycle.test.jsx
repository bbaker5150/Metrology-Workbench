import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import UncertaintyPanel from "./UncertaintyPanel";

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it.each(["session", "point"])("releases instrument column dragging when %s view loses focus", (viewMode) => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId; }
  });
  const frames = new Map(); let id = 0;
  vi.stubGlobal("requestAnimationFrame", callback => { frames.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", key => frames.delete(key));
  const paint = () => { const pending = [...frames.values()]; frames.clear(); act(() => pending.forEach(callback => callback())); };
  const uut = { id: "uut", name: "Test UUT", instrument: { functions: [{ name: "Voltage", unit: "V", ranges: [{ id: "range", min: 0, max: 10, unit: "V" }] }] } };
  const { container, unmount } = render(<UncertaintyPanel
    testPointData={{ id: "point", viewMode, testPointInfo: { parameter: { value: 5, name: "Voltage", unit: "V" } }, associatedUutIds: ["uut"], components: [], tmdeTolerances: [] }}
    sessionData={{ id: "test", uuts: [uut], tmdes: [], testPoints: [], measurementAreas: [], uncReq: {} }}
    currentUutSelection={[]} setCurrentUutSelection={() => {}} onSessionSave={() => {}}
    tmdeTolerancesData={[]} uutNominal={{ value: 5, unit: "V" }} setNotification={() => {}}
  />);
  const handle = screen.getAllByRole("button", { name: "Resize Description column" })[0];
  const col = container.querySelector(".instrument-equipment-table col");
  const before = col.style.width;
  fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 100 });
  fireEvent.pointerMove(document, { pointerId: 7, clientX: 160 }); paint();
  const resized = col.style.width;
  expect(resized).not.toBe(before);
  fireEvent.blur(window);
  fireEvent.pointerMove(document, { pointerId: 7, clientX: 700 }); paint();
  expect(col.style.width).toBe(resized);
  expect(document.body.style.cursor).not.toBe("col-resize");
  unmount();
});
