import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResizableBudgetTable from "./ResizableBudgetTable";

const columns = [{ key: "source", label: "Source" }, { key: "limit", label: "Error Limit" }];
const fixture = (scope = "final:length") => (
  <ResizableBudgetTable scope={scope} columns={columns}>
    <tbody><tr><td>Full instrument description</td><td>0.002000 in.</td></tr></tbody>
  </ResizableBudgetTable>
);
const widths = () => [...document.querySelectorAll("col")].map(col => col.style.width);

describe("budget column resizing", () => {
  beforeEach(() => {
    localStorage.clear();
    // Simulate a table at 200% zoom: 400 + 120 layout pixels.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const width = this.tagName === "TABLE" ? 1040 : this.dataset.budgetColumn === "source" ? 800 : 240;
      return { width, height: 40, x: 0, y: 0, left: 0, top: 0, right: width, bottom: 40 };
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(520);
    vi.stubGlobal("PointerEvent", MouseEvent);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("uses layout pixels when dragging at zoom, preserves neighbors, and restores widths after remount", () => {
    const view = render(fixture());
    expect(widths()).toEqual([]);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Resize Source column" }), { button: 0, clientX: 800 });
    fireEvent.pointerMove(document, { clientX: 700 });
    fireEvent.pointerUp(document);
    expect(widths()).toEqual(["350px", "120px"]);
    expect(document.body.style.cursor).toBe("");
    view.unmount();
    render(fixture());
    expect(widths()).toEqual(["350px", "120px"]);
    fireEvent.doubleClick(screen.getByRole("button", { name: "Resize Source column" }));
    expect(widths()).toEqual([]);
  });

  it("restores naturally narrow columns without discarding the saved table layout", () => {
    localStorage.setItem('uncertalytics:budget-column-widths:v1:final:length', JSON.stringify({ source: 400, limit: 24 }));
    render(fixture());
    expect(widths()).toEqual(['400px', '24px']);
  });

  it("keeps budgets independent and resets saved widths for hidden groups", () => {
    const view = render(fixture());
    fireEvent.keyDown(screen.getByRole("button", { name: "Resize Error Limit column" }), { key: "ArrowRight" });
    expect(widths()).toEqual(["400px", "132px"]);
    view.rerender(fixture("input:voltage"));
    expect(widths()).toEqual([]);
    fireEvent.keyDown(screen.getByRole("button", { name: "Resize Source column" }), { key: "ArrowLeft" });
    expect(widths()).toEqual(["388px", "120px"]);
    fireEvent(window, new CustomEvent("uncert-reset-ui-sizes"));
    expect(widths()).toEqual([]);
    view.rerender(fixture());
    expect(widths()).toEqual([]);
  });

  it("temporarily fits an expanded editor without saving its width or counting nested table headers", async () => {
    localStorage.setItem('uncertalytics:budget-column-widths:v1:final:length', JSON.stringify({ source: 400, limit: 120 }));
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function () { return this.dataset.budgetEditor ? 320 : 520; });
    const view = render(<ResizableBudgetTable scope="final:length" columns={columns}><tbody><tr><td>Source</td><td>
      <div data-budget-editor="limit"><table><thead><tr><th>Nested measurement point</th><th>Nested uncertainty</th></tr></thead></table></div>
    </td></tr></tbody></ResizableBudgetTable>);
    await waitFor(() => expect(widths()).toEqual(['400px', '322px']));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const width = this.tagName === 'TABLE' ? 1040 : this.dataset.budgetColumn === 'source' ? 800 : 644;
      return { width, height: 40, x: 0, y: 0, left: 0, top: 0, right: width, bottom: 40 };
    });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize Source column' }), { key: 'ArrowRight' });
    const saved = JSON.parse(localStorage.getItem('uncertalytics:budget-column-widths:v1:final:length'));
    expect(Object.keys(saved)).toEqual(['source', 'limit']);
    expect(saved.limit).toBe(120);
    view.rerender(fixture());
    await waitFor(() => expect(widths()).toEqual(['412px', '120px']));
  });

  it("cleans up an interrupted drag when unmounted", () => {
    const view = render(fixture());
    fireEvent.pointerDown(screen.getByRole("button", { name: "Resize Source column" }), { button: 0, clientX: 800 });
    expect(document.body.style.cursor).toBe("col-resize");
    view.unmount();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    fireEvent.pointerMove(document, { clientX: 700 });
    expect(localStorage.length).toBe(0);
  });

  it("fits the manual tolerance editor and full range label even with saved narrow columns", async () => {
    localStorage.setItem('uncertalytics:budget-column-widths:v1:final:length', JSON.stringify({ source: 100, limit: 90 }));
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function () {
      return this.matches('.inline-tolerance-editor') ? 360 : this.matches('.budget-range-selector') ? 240 : 0;
    });
    render(<ResizableBudgetTable scope="final:length" columns={columns}><tbody><tr>
      <td><span className="budget-range-selector">Range: -454 to 753 °F</span></td>
      <td className="budget-inline-tolerance-cell"><div className="inline-tolerance-editor">± tolerance</div></td>
    </tr></tbody></ResizableBudgetTable>);
    await waitFor(() => expect(widths()).toEqual(['242px', '362px']));
    expect(JSON.parse(localStorage.getItem('uncertalytics:budget-column-widths:v1:final:length'))).toEqual({ source: 100, limit: 90 });
  });
});
