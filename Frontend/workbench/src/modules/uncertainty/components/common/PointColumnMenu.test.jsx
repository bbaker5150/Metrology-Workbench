import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PointColumnMenu from "./PointColumnMenu";

it("cancels pointer sorting without changing column order or leaking the grabbing cursor", () => {
  const move = vi.fn();
  const previousHitTest = document.elementFromPoint;
  const { unmount } = render(<PointColumnMenu sections={[]} columns={{}} setColumns={()=>{}}
    selectedGroups={[{ key: "value", keys: ["value"], label: "Value" }, { key: "pfa", keys: ["pfa"], label: "PFA" }]} moveGroup={move} />);
  const source = screen.getByLabelText("Move Value"), target = screen.getByLabelText("Move PFA");
  document.elementFromPoint = () => target;
  try {
    // MouseEvent supplies pointer coordinates in jsdom as it does in browsers.
    fireEvent(source, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientY: 1 }));
    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientY: 20 }));
    expect(source).toHaveClass("is-dragging");
    expect(document.body).toHaveClass("point-columns-dragging");
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));
    expect(move).not.toHaveBeenCalled();
    expect(source).not.toHaveClass("is-dragging");
    expect(document.body).not.toHaveClass("point-columns-dragging");
  } finally {
    unmount();
    if (previousHitTest) document.elementFromPoint = previousHitTest;
    else delete document.elementFromPoint;
  }
});

it("toggles a limit pair together and removes it with the displayed-column control", () => {
  function Harness() {
    const [columns,setColumns]=useState({lowLimit:false,highLimit:false});
    return <PointColumnMenu sections={[{group:"Measurement",cols:[{key:"lowLimit",keys:["lowLimit","highLimit"],label:"Tolerance (Limits)"}]}]}
      columns={columns} setColumns={setColumns} selectedGroups={columns.lowLimit ? [{key:"lowLimit",keys:["lowLimit","highLimit"],label:"Tolerance (Limits)"}] : []}
      moveGroup={()=>{}} onReset={()=>{}} onClose={()=>{}} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button",{name:"Add Tolerance (Limits) column"}));
  expect(screen.queryByRole("button",{name:"Add Tolerance (Limits) column"})).not.toBeInTheDocument();
  expect(screen.getByLabelText("Add Columns").querySelectorAll("button")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button",{name:"Hide Tolerance (Limits)"}));
  expect(screen.getByRole("button",{name:"Add Tolerance (Limits) column"})).toBeInTheDocument();
});

it("supports moving a paired group with the keyboard", () => {
  const move=vi.fn();
  render(<PointColumnMenu sections={[]} columns={{}} setColumns={()=>{}} selectedGroups={[{key:"value",keys:["value"],label:"Value"},{key:"lowLimit",keys:["lowLimit","highLimit"],label:"Tolerance (Limits)"}]} moveGroup={move} />);
  fireEvent.keyDown(screen.getByLabelText("Move Tolerance (Limits)"),{key:"ArrowUp"});
  expect(move).toHaveBeenCalledWith("lowLimit","value");
});

it("keeps the dragged column identity through protected drag data and clears its highlight", () => {
  const move = vi.fn();
  render(<PointColumnMenu sections={[]} columns={{}} setColumns={()=>{}} selectedGroups={[{key:"value",keys:["value"],label:"Value"},{key:"pfa",keys:["pfa"],label:"PFA"}]} moveGroup={move} />);
  const source = screen.getByLabelText("Move Value"), target = screen.getByLabelText("Move PFA");
  const dataTransfer = { setData: vi.fn(), getData: () => "" };
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  expect(target).toHaveClass("is-drop-target");
  fireEvent.drop(target, { dataTransfer });
  expect(move).toHaveBeenCalledWith("value", "pfa");
  expect(source).not.toHaveClass("is-dragging");
  expect(target).not.toHaveClass("is-drop-target");
});

it("adds an available limit pair at the dropped position", () => {
  const setColumns = vi.fn(), move = vi.fn();
  render(<PointColumnMenu sections={[{ group: "Measurement", cols: [{ key: "lowLimit", keys: ["lowLimit", "highLimit"], label: "Tolerance" }] }]}
    columns={{ value: true }} setColumns={setColumns} selectedGroups={[{ key: "value", keys: ["value"], label: "Value" }]} moveGroup={move} />);
  const dataTransfer = { setData: vi.fn(), getData: () => "" };
  fireEvent.dragStart(screen.getByRole("button", { name: "Add Tolerance column" }), { dataTransfer });
  fireEvent.drop(screen.getByLabelText("Move Value"), { dataTransfer });
  expect(setColumns.mock.calls[0][0]({ value: true })).toEqual({ value: true, lowLimit: true, highLimit: true });
  expect(move).toHaveBeenCalledWith("lowLimit", "value", ["lowLimit", "highLimit"]);
});
