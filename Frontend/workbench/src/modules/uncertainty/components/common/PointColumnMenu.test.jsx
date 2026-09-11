import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PointColumnMenu from "./PointColumnMenu";

it("toggles a limit pair together and removes it with the displayed-column control", () => {
  function Harness() {
    const [columns,setColumns]=useState({lowLimit:false,highLimit:false});
    return <PointColumnMenu sections={[{group:"Measurement",cols:[{key:"lowLimit",keys:["lowLimit","highLimit"],label:"UUT Limits"}]}]}
      columns={columns} setColumns={setColumns} selectedGroups={columns.lowLimit ? [{key:"lowLimit",keys:["lowLimit","highLimit"],label:"UUT Limits"}] : []}
      moveGroup={()=>{}} onReset={()=>{}} onClose={()=>{}} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("checkbox",{name:"UUT Limits"}));
  expect(screen.getByRole("checkbox",{name:"Toggle all Measurement columns"})).toBeChecked();
  fireEvent.click(screen.getByRole("button",{name:"Hide UUT Limits"}));
  expect(screen.getByRole("checkbox",{name:"UUT Limits"})).not.toBeChecked();
});

it("supports moving a paired group with the keyboard", () => {
  const move=vi.fn();
  render(<PointColumnMenu sections={[]} columns={{}} setColumns={()=>{}} selectedGroups={[{key:"value",keys:["value"],label:"Value"},{key:"lowLimit",keys:["lowLimit","highLimit"],label:"UUT Limits"}]} moveGroup={move} />);
  fireEvent.keyDown(screen.getByLabelText("Move UUT Limits"),{key:"ArrowUp"});
  expect(move).toHaveBeenCalledWith("lowLimit","value");
});
