import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PointColumnMenu from "./PointColumnMenu";

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
