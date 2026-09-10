import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UncertaintyPanel from "./UncertaintyPanel";

const instrument = (id, name) => ({
  id, name, description: name,
  instrument: { functions: [{ name: "Voltage", unit: "V", ranges: [{ id: `${id}-range`, min: 0, max: 10, unit: "V" }] }] },
});

const Harness = ({ viewMode, onDeleteUut, onDeleteTmdeDefinition, multiRange = false }) => {
  const [session, setSession] = useState({
    id: "selection-test", name: "Selection test", measurementAreas: [],
    uuts: [instrument("u1", "First UUT"), instrument("u2", "Second UUT")].map(item => multiRange ? { ...item, instrument: { functions: [{ ...item.instrument.functions[0], ranges: [...item.instrument.functions[0].ranges, { id: item.id + "-second", min: 20, max: 30, unit: "V" }] }] } } : item),
    tmdes: [instrument("t1", "First TMDE"), instrument("t2", "Second TMDE")],
    testPoints: [], uncReq: {},
  });
  const [selected, setSelected] = useState([]);
  return <><UncertaintyPanel
    testPointData={{ id: "selection-test", viewMode, testPointInfo: { parameter: { name: "Voltage", unit: "V" } }, nominal: { value: 5, unit: "V" }, associatedUutIds: ["u1"], components: [], tmdeTolerances: [], specifications: {} }}
    sessionData={session} onSessionSave={setSession} currentUutSelection={selected} setCurrentUutSelection={setSelected}
    tmdeTolerancesData={[]} uutNominal={{ value: 5, unit: "V" }}
    onDeleteUut={onDeleteUut} onDeleteTmdeDefinition={onDeleteTmdeDefinition}
    setNotification={() => {}} onInstrumentSynced={() => {}}
  /><output data-testid="session-state">{JSON.stringify(session)}</output></>;
};

describe.each(["session", "point"])("instrument selection in %s view", viewMode => {
  it("selects compact ranges directly and shares keyboard/context clipboard actions", () => {
    render(<Harness viewMode={viewMode} multiRange />);
    const rows = document.querySelectorAll('tr[data-range-group="uut:u1"]');
    expect(rows).toHaveLength(2);
    fireEvent.mouseDown(rows[1].querySelector('[data-range-cell]'));
    expect(rows[1]).toHaveClass("is-selected-range");
    expect(rows[0]).not.toHaveClass("is-selected-range");
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.contextMenu(rows[0].querySelector('[data-range-cell]'));
    fireEvent.click(screen.getByText("Paste Range"));
    let session = JSON.parse(screen.getByTestId("session-state").textContent);
    expect(session.uuts[0].instrument.functions[0].ranges.map(r=>r.min)).toEqual([0, 20, 20]);
    fireEvent.contextMenu(screen.getByText("First TMDE").closest("tr"));
    fireEvent.click(screen.getByText("Copy Instrument"));
    fireEvent.mouseDown(document.querySelector('tr[data-range-group="uut:u1"] [data-range-cell]'));
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    session = JSON.parse(screen.getByTestId("session-state").textContent);
    expect(session.uuts).toHaveLength(3);
    expect(session.uuts[1].name).toBe("First TMDE");
  });

  it("cuts a mixed selection immediately and pastes the whole batch into either table", () => {
    render(<Harness viewMode={viewMode} />);
    fireEvent.click(screen.getByText("First UUT").closest("tr"));
    fireEvent.click(screen.getByText("Second UUT").closest("tr"), { ctrlKey: true });
    fireEvent.click(screen.getByText("First TMDE").closest("tr"), { ctrlKey: true });
    fireEvent.keyDown(window, { key: "x", ctrlKey: true });
    let session = JSON.parse(screen.getByTestId("session-state").textContent);
    expect(session.uuts).toHaveLength(0);
    expect(session.tmdes.map(item => item.id)).toEqual(["t2"]);
    fireEvent.click(screen.getByText("Second TMDE").closest("tr"));
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    session = JSON.parse(screen.getByTestId("session-state").textContent);
    expect(session.uuts).toHaveLength(0);
    expect(session.tmdes.map(item => item.id)).toEqual(["t2", "u1", "u2", "t1"]);
  });

  it("preserves Ctrl and Shift instrument selection on multi-range rows", () => {
    const onDeleteUut = vi.fn();
    render(<Harness viewMode={viewMode} multiRange onDeleteUut={onDeleteUut} />);
    const first = document.querySelector('tr[data-range-group="uut:u1"] .cell-description');
    const second = document.querySelector('tr[data-range-group="uut:u2"] .cell-description');
    fireEvent.mouseDown(first);
    fireEvent.mouseDown(second.querySelector(".inline-desc-combined"), { ctrlKey: true });
    fireEvent.click(second.querySelector(".inline-desc-combined"), { ctrlKey: true });
    expect(document.querySelector(".inline-desc-fields")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onDeleteUut).toHaveBeenLastCalledWith(["u1", "u2"]);
    fireEvent.mouseDown(first);
    fireEvent.mouseDown(second, { shiftKey: true });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onDeleteUut).toHaveBeenLastCalledWith(["u1", "u2"]);
  });

  it("keeps mixed selection while Delete targets the last table and Escape clears selection", () => {
    const onDeleteUut = vi.fn(), onDeleteTmdeDefinition = vi.fn();
    render(<Harness {...{ viewMode, onDeleteUut, onDeleteTmdeDefinition }} />);
    const uut = screen.getByText("First UUT").closest("tr");
    const tmde = screen.getByText("First TMDE").closest("tr");
    fireEvent.click(uut);
    fireEvent.click(tmde, { ctrlKey: true });
    expect(uut).toHaveClass("selected-row");
    expect(tmde).toHaveClass("selected-row");
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onDeleteUut).not.toHaveBeenCalled();
    expect(onDeleteTmdeDefinition).toHaveBeenCalledWith(["t1"]);
    fireEvent.click(uut);
    expect(tmde).not.toHaveClass("selected-row");
    expect(uut).not.toHaveClass("selected-row");
    fireEvent.click(uut);
    expect(uut).toHaveClass("selected-row");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(uut).not.toHaveClass("selected-row");
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onDeleteUut).not.toHaveBeenCalled();
  });

  it("copies and pastes TMDE after switching from a selected UUT", () => {
    render(<Harness viewMode={viewMode} />);
    fireEvent.click(screen.getByText("First UUT").closest("tr"));
    fireEvent.click(screen.getByText("First TMDE").closest("tr"));
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    expect(screen.getAllByText("First TMDE")).toHaveLength(2);
    expect(screen.getAllByText("First UUT")).toHaveLength(1);
  });
});
