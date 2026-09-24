import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UncertaintyPanel from "./UncertaintyPanel";

const instrument = (id, name) => ({
  id, name, description: name,
  instrument: { functions: [{ name: "Voltage", unit: "V", ranges: [{ id: `${id}-range`, min: 0, max: 10, unit: "V" }] }] },
});

const Harness = ({ viewMode, onDeleteUut, onDeleteTmdeDefinition, multiRange = false, showToast }) => {
  const [session, setSession] = useState({
    id: "selection-test", name: "Selection test", measurementAreas: [],
    uuts: [instrument("u1", "First UUT"), instrument("u2", "Second UUT")].map(item => multiRange ? { ...item, instrument: { functions: [{ ...item.instrument.functions[0], ranges: [...item.instrument.functions[0].ranges, { id: item.id + "-second", min: 20, max: 30, unit: "V" }] }] } } : item),
    tmdes: [instrument("t1", "First TMDE"), instrument("t2", "Second TMDE")],
    testPoints: [], uncReq: {},
  });
  const [selected, setSelected] = useState([]);
  return <><UncertaintyPanel
    testPointData={{ id: "selection-test", viewMode, testPointInfo: { parameter: { name: "Voltage", unit: "V" } }, nominal: { value: 5, unit: "V" }, associatedUutIds: ["u1"], components: [], tmdeTolerances: [], specifications: {} }}
    showToast={showToast} sessionData={session} onSessionSave={setSession} currentUutSelection={selected} setCurrentUutSelection={setSelected}
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

  it.each(["uut", "tmde"])("selects a single %s range without selecting its description", kind => {
    render(<Harness viewMode={viewMode} />);
    const row = document.querySelector(`tr[data-range-group="${kind}:${kind === 'uut' ? 'u1' : 't1'}"]`);
    fireEvent.mouseDown(row.querySelector('[data-range-cell]'));
    expect(row.closest('table')).toHaveAttribute('data-selection-mode', 'range');
    expect(row).toHaveAttribute('data-range-selected', 'true');
    expect(row.querySelector('.cell-description')).not.toHaveAttribute('data-cell-selected');
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
    const session = JSON.parse(screen.getByTestId('session-state').textContent);
    expect(session[kind === 'uut' ? 'uuts' : 'tmdes']).toHaveLength(2);
    expect(session[kind === 'uut' ? 'uuts' : 'tmdes'][0].instrument.functions[0].ranges).toHaveLength(2);
  });

  it("cuts a mixed selection immediately and pastes the whole batch into either table", () => {
    render(<Harness viewMode={viewMode} />);
    fireEvent.mouseDown(screen.getByText("First UUT").closest("td"));
    fireEvent.mouseDown(screen.getByText("Second UUT").closest("td"), { ctrlKey: true });
    fireEvent.mouseDown(screen.getByText("First TMDE").closest("td"), { ctrlKey: true });
    fireEvent.keyDown(window, { key: "x", ctrlKey: true });
    let session = JSON.parse(screen.getByTestId("session-state").textContent);
    expect(session.uuts).toHaveLength(0);
    expect(session.tmdes.map(item => item.id)).toEqual(["t2"]);
    fireEvent.mouseDown(screen.getByText("Second TMDE").closest("td"));
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    session = JSON.parse(screen.getByTestId("session-state").textContent);
    expect(session.uuts).toHaveLength(0);
    expect(session.tmdes.map(item => item.id)).toEqual(["t2", "u1", "u2", "t1"]);
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    session = JSON.parse(screen.getByTestId("session-state").textContent);
    expect(session.tmdes).toHaveLength(7);
    expect(new Set(session.tmdes.map(item => item.id)).size).toBe(7);

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
    fireEvent.mouseDown(uut.querySelector(".cell-description"));
    fireEvent.mouseDown(tmde.querySelector(".cell-description"), { ctrlKey: true });
    expect(uut).toHaveClass("instrument-selected");
    expect(tmde).toHaveClass("instrument-selected");
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onDeleteUut).not.toHaveBeenCalled();
    expect(onDeleteTmdeDefinition).toHaveBeenCalledWith(["t1"]);
    fireEvent.mouseDown(uut.querySelector(".cell-description"));
    expect(tmde).not.toHaveClass("instrument-selected");
    expect(uut).toHaveClass("instrument-selected");
    fireEvent.mouseDown(uut.querySelector(".cell-description"));
    expect(uut).toHaveClass("instrument-selected");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(uut).not.toHaveClass("instrument-selected");
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onDeleteUut).not.toHaveBeenCalled();
  });

  it("copies and pastes TMDE after switching from a selected UUT", () => {
    render(<Harness viewMode={viewMode} />);
    fireEvent.mouseDown(screen.getByText("First UUT").closest("td"));
    fireEvent.mouseDown(screen.getByText("First TMDE").closest("td"));
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    expect(screen.getAllByText("First TMDE")).toHaveLength(2);
    expect(screen.getAllByText("First UUT")).toHaveLength(1);
  });
});


describe.each(["session", "point"])("clipboard feedback in %s view", viewMode => {
  it("reports copy/cut entity and selection count for keyboard and context menu actions", () => {
    const showToast = vi.fn();
    render(<Harness viewMode={viewMode} multiRange showToast={showToast} />);
    const rangeCell = () => document.querySelector('tr[data-range-group="uut:u1"] [data-range-cell]');
    fireEvent.contextMenu(rangeCell());
    fireEvent.click(screen.getByText("Copy Range"));
    expect(showToast).toHaveBeenLastCalledWith("1 Range copied to clipboard");
    fireEvent.mouseDown(rangeCell());
    fireEvent.keyDown(window, { key: "x", ctrlKey: true });
    expect(showToast).toHaveBeenLastCalledWith("1 Range cut to clipboard");
    fireEvent.contextMenu(screen.getByText("First TMDE").closest("tr"));
    fireEvent.click(screen.getByText("Copy Instrument"));
    expect(showToast).toHaveBeenLastCalledWith("1 Instrument copied to clipboard");
    fireEvent.mouseDown(screen.getByText("First UUT").closest("td"));
    fireEvent.mouseDown(screen.getByText("Second UUT").closest("td"), { ctrlKey: true });
    fireEvent.keyDown(window, { key: "x", ctrlKey: true });
    expect(showToast).toHaveBeenLastCalledWith("2 Instruments cut to clipboard");
    expect(showToast).toHaveBeenCalledTimes(4);
  });
});
