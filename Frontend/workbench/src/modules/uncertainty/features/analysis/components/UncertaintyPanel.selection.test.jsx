import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UncertaintyPanel from "./UncertaintyPanel";

const instrument = (id, name) => ({
  id, name, description: name,
  instrument: { functions: [{ name: "Voltage", unit: "V", ranges: [{ id: `${id}-range`, min: 0, max: 10, unit: "V" }] }] },
});

const Harness = ({ viewMode, onDeleteUut, onDeleteTmdeDefinition }) => {
  const [session, setSession] = useState({
    id: "selection-test", name: "Selection test", measurementAreas: [],
    uuts: [instrument("u1", "First UUT"), instrument("u2", "Second UUT")],
    tmdes: [instrument("t1", "First TMDE"), instrument("t2", "Second TMDE")],
    testPoints: [], uncReq: {},
  });
  const [selected, setSelected] = useState([]);
  return <UncertaintyPanel
    testPointData={{ id: "selection-test", viewMode, testPointInfo: { parameter: { name: "Voltage", unit: "V" } }, nominal: { value: 5, unit: "V" }, associatedUutIds: ["u1"], components: [], tmdeTolerances: [], specifications: {} }}
    sessionData={session} onSessionSave={setSession} currentUutSelection={selected} setCurrentUutSelection={setSelected}
    tmdeTolerancesData={[]} uutNominal={{ value: 5, unit: "V" }}
    onDeleteUut={onDeleteUut} onDeleteTmdeDefinition={onDeleteTmdeDefinition}
    setNotification={() => {}} onInstrumentSynced={() => {}}
  />;
};

describe.each(["session", "point"])("exclusive instrument selection in %s view", viewMode => {
  it("targets only the last table for Delete and clears selection on Escape", () => {
    const onDeleteUut = vi.fn(), onDeleteTmdeDefinition = vi.fn();
    render(<Harness {...{ viewMode, onDeleteUut, onDeleteTmdeDefinition }} />);
    const uut = screen.getByText("First UUT").closest("tr");
    const tmde = screen.getByText("First TMDE").closest("tr");
    fireEvent.click(uut);
    fireEvent.click(tmde, { ctrlKey: true });
    expect(uut).not.toHaveClass("selected-row");
    expect(tmde).toHaveClass("selected-row");
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onDeleteUut).not.toHaveBeenCalled();
    expect(onDeleteTmdeDefinition).toHaveBeenCalledWith(["t1"]);
    fireEvent.click(uut);
    expect(tmde).not.toHaveClass("selected-row");
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
