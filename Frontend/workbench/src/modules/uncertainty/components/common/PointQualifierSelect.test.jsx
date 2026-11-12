import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PointQualifierSelect from "./PointQualifierSelect";

const makeChoice = (id, frequency, mode, summary) => ({
  key: id, functionName: "Voltage", rangeLabel: "0 to 10 V", summary,
  path: [{ id: `frequency-${frequency}`, name: "Frequency", label: `${frequency} Hz` }, { id: mode, name: "Mode", label: mode }],
  range: { rangeId: id, functionId: "voltage", min: 0, max: 10, unit: "V",
    qualifier: { name: "Frequency", isSingleValue: true, value: frequency, unit: "Hz", qualifier: { name: "Mode", text: mode } } },
});
const choices = [makeChoice("100-ac", 100, "AC", "± 0.01 V"), makeChoice("100-dc", 100, "DC", "± 0.02 V"), makeChoice("1000-ac", 1000, "AC", "± 0.03 V")];
const point = { id: "point", testPointInfo: { parameter: { value: 5, unit: "V" }, notes: "Keep notes" }, uutTolerance: { includeResolutionInBudget: true }, tmde: [{ id: "keep" }] };
const leaf = id => document.querySelector(`[role="treeitem"][data-range-id="${id}"]`);
const bandChoice = { ...choices[0], key: "band", path: [{ id: "band", name: "Frequency", label: "10–100 Hz" }, { id: "ac", name: "Mode", label: "AC" }],
  range: { ...choices[0].range, rangeId: "band", qualifier: { name: "Frequency", min: 10, max: 100, unit: "Hz", qualifier: { name: "Mode", text: "AC" } } } };

describe("measurement point qualifier picker", () => {
  it("shows hierarchy, individual leaf specs, current chain and selected tick, then saves the exact leaf", () => {
    const selectedPoint = { ...point, testPointInfo: { ...point.testPointInfo, qualifier: { value: 100, unit: "Hz", qualifier: { value: "AC", unit: "" } } }, uutTolerance: { ...choices[0].range, includeResolutionInBudget: true } };
    const onChange = vi.fn(), onClose = vi.fn();
    render(<PointQualifierSelect choices={choices} point={selectedPoint} autoOpen onChange={onChange} onClose={onClose} />);
    expect(screen.getByRole("button", { name: "Choose measurement point qualifier" })).toHaveTextContent("100 Hz › AC");
    expect(leaf("100-ac")).toHaveAttribute("aria-selected", "true");
    expect(leaf("100-ac")).toHaveFocus();
    expect(within(leaf("100-ac")).getByLabelText("Selected qualifier")).toBeInTheDocument();
    expect(leaf("100-dc")).toHaveTextContent("± 0.02 V");
    expect(leaf("1000-ac")).toHaveTextContent("± 0.03 V");
    fireEvent.click(leaf("100-dc"));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]).toMatchObject({ id: "point", tmde: [{ id: "keep" }], testPointInfo: { notes: "Keep notes", parameter: { value: 5, unit: "V", qualifier: { value: 100, unit: "Hz", qualifier: { value: "DC" } } }, qualifier: { value: 100, unit: "Hz", qualifier: { value: "DC" } } }, uutTolerance: { rangeId: "100-dc", rangeSelection: "explicit", includeResolutionInBudget: true } });
    expect(onClose).toHaveBeenCalledWith({ restoreFocus: true });
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });

  it("supports keyboard hierarchy navigation, collapsing and selecting", () => {
    const onChange = vi.fn();
    render(<PointQualifierSelect choices={choices} point={point} autoOpen onChange={onChange} />);
    const branch = screen.getByRole("treeitem", { name: "100 Hz" });
    expect(branch).toHaveFocus();
    fireEvent.keyDown(branch, { key: "ArrowLeft" });
    expect(branch).toHaveAttribute("aria-expanded", "false");
    expect(leaf("100-ac")).toBeNull();
    fireEvent.keyDown(branch, { key: "ArrowRight" });
    expect(branch).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(branch, { key: "ArrowRight" });
    expect(leaf("100-ac")).toHaveFocus();
    fireEvent.keyDown(leaf("100-ac"), { key: "ArrowDown" });
    expect(leaf("100-dc")).toHaveFocus();
    fireEvent.keyDown(leaf("100-dc"), { key: "ArrowUp" });
    expect(leaf("100-ac")).toHaveFocus();
    fireEvent.keyDown(leaf("100-ac"), { key: "ArrowLeft" });
    expect(branch).toHaveFocus();
    fireEvent.keyDown(branch, { key: "End" });
    expect(leaf("1000-ac")).toHaveFocus();
    fireEvent.keyDown(leaf("1000-ac"), { key: "Enter" });
    expect(onChange.mock.calls[0][0].uutTolerance.rangeId).toBe("1000-ac");
  });

  it("requires a measured value for a band, rejects invalid input, and saves only after valid entry", () => {
    const onChange = vi.fn();
    render(<PointQualifierSelect choices={[bandChoice]} point={point} autoOpen onChange={onChange} />);
    fireEvent.click(leaf("band"));
    const input = screen.getByRole("textbox", { name: "Frequency value" });
    expect(input).toHaveFocus(); expect(input).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply qualifier" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.submit(input.closest("form"));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]).toMatchObject({ testPointInfo: { qualifier: { value: "50", unit: "Hz", qualifier: { value: "AC" } } }, uutTolerance: { rangeId: "band", rangeSelection: "explicit" } });
  });

  it("preserves an existing fitting value and its equivalent unit without prompting", () => {
    const onChange = vi.fn();
    render(<PointQualifierSelect choices={[bandChoice]} point={{ ...point, testPointInfo: { ...point.testPointInfo, qualifier: { value: 0.05, unit: "kHz" } } }} autoOpen onChange={onChange} />);
    fireEvent.click(leaf("band"));
    expect(screen.queryByRole("textbox", { name: "Frequency value" })).not.toBeInTheDocument();
    expect(onChange.mock.calls[0][0].testPointInfo.qualifier).toMatchObject({ value: 0.05, unit: "kHz" });
  });

  it("uses the authored column name for a required qualifier value", () => {
    const renamed = { ...bandChoice, path: [{ ...bandChoice.path[0], name: "Test frequency" }, bandChoice.path[1]] };
    render(<PointQualifierSelect choices={[renamed]} point={point} autoOpen />);
    fireEvent.click(leaf("band"));
    expect(screen.getByRole("textbox", { name: "Test frequency value" })).toHaveFocus();
    expect(screen.queryByRole("textbox", { name: "Frequency value" })).toBeNull();
  });

  it("Escape from an uncommitted band input closes and restores focus without saving", () => {
    const onChange = vi.fn(), onClose = vi.fn();
    render(<PointQualifierSelect choices={[bandChoice]} point={point} autoOpen onChange={onChange} onClose={onClose} />);
    fireEvent.click(leaf("band"));
    fireEvent.change(screen.getByRole("textbox", { name: "Frequency value" }), { target: { value: "50" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Frequency value" }), { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith({ restoreFocus: true });
    expect(screen.getByRole("button", { name: "Choose measurement point qualifier" })).toHaveFocus();
    expect(screen.queryByRole("textbox", { name: "Frequency value" })).not.toBeInTheDocument();
  });

  it("closes on outside interaction or another menu opening without stealing focus", () => {
    const onChange = vi.fn(), onClose = vi.fn();
    render(<><button>Outside</button><PointQualifierSelect choices={choices} point={point} autoOpen onChange={onChange} onClose={onClose} /></>);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));
    expect(onClose).toHaveBeenLastCalledWith({ restoreFocus: false });
    const trigger = screen.getByRole("button", { name: "Choose measurement point qualifier" });
    fireEvent.click(trigger);
    fireEvent(window, new Event("uncertalytics:menu-open"));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });

  it("searches large lists by specs and shows a useful empty state", () => {
    const many = Array.from({ length: 10 }, (_, index) => makeChoice(`range-${index}`, 100, `Mode ${index}`, `± ${index + 1} V`));
    render(<PointQualifierSelect choices={many} point={point} autoOpen />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search qualifiers" }), { target: { value: "± 7 V" } });
    expect(leaf("range-6")).toHaveTextContent("± 7 V");
    expect(leaf("range-0")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search qualifiers" }), { target: { value: "unavailable" } });
    expect(screen.getByText("No matching qualifiers.")).toBeInTheDocument();
  });

  it("explains when no authored qualifier leaf matches the primary measurement", () => {
    render(<PointQualifierSelect choices={[]} point={point} autoOpen />);
    expect(screen.getByText(/No qualifier ranges match this measurement point/)).toBeInTheDocument();
    expect(screen.queryAllByRole("treeitem")).toHaveLength(0);
  });
});
