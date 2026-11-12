import React, { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SidebarPointItem, formatPointQualifier } from "./App";
import { buildSidebarCellGroups } from "./utils/sidebarCellGroups";

vi.mock("plotly.js-dist", () => ({ default: {} }));

const uut = { id: "meter", instrument: { qualifierColumnNames: ["Frequency", "Calibration interval"],
  functions: [{ id: "voltage", name: "Voltage", unit: "V", ranges: [10, 100, 1000].map((frequency, index) => ({
    id: `frequency-${frequency}`, min: 0, max: 100, unit: "V", qualifierGroupId: "voltage-range",
    qualifier: { id: `hz-${frequency}`, name: "Frequency", value: frequency, unit: "Hz",
      qualifier: { id: "annual", text: "1 year" } },
    tolerances: { reading: { high: index + 1, low: -(index + 1), unit: "%", symmetric: true } },
  })) }] } };
const makePoint = id => ({ id, associatedUutIds: ["meter"], testPointInfo: {
  parameter: { value: 50, unit: "V" }, qualifier: { value: 10, unit: "Hz", qualifier: { value: "1 year" } },
}, components: [{ id: "manual-source", value: 4 }], uutTolerance: { includeResolutionInBudget: true } });

test("opens instrument qualifier choices and changes only the selected member of a merged run", async () => {
  const saved = vi.fn();
  function Harness() {
    const [points, setPoints] = useState(["first", "second", "third"].map(makePoint));
    const [pending, setPending] = useState(null);
    const groups = buildSidebarCellGroups(points, pending, formatPointQualifier);
    return <div className="sidebar-points-scroll-wrapper">{points.map((point, index) => <div data-testid={point.id} key={point.id}>
      <SidebarPointItem point={point} currentUut={uut} cellGroups={groups[index]}
        preferredSharedEditPointId="second" onRequestSharedMemberEdit={(pointId, field) => setPending({ pointId, field })}
        autoEditField={pending?.pointId === point.id ? pending.field : null} onAutoEditFieldConsumed={() => setPending(null)}
        visibleColumns={{ qualifier: true, value: true, tolerance: true }} onSelect={vi.fn()}
        onSave={next => { saved(next); setPoints(old => old.map(candidate => candidate.id === next.id ? next : candidate)); }} />
    </div>)}</div>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByTestId("first").querySelector('.point-qualifier [data-point-editor-trigger]'));
  expect(within(screen.getByTestId("second")).getByRole("button", { name: "Choose measurement point qualifier" })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("tree"), { key: "Escape" });
  await waitFor(() => expect(screen.getByTestId("second").querySelector('.point-grid-item')).toHaveFocus());
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("first").querySelector('.point-qualifier [data-point-editor-trigger]'));
  const leaf = document.querySelector('[data-range-id="frequency-100"]');
  expect(leaf).not.toBeNull();
  expect(leaf).not.toHaveTextContent("Not Calculated");
  expect(leaf).toHaveTextContent("V");
  fireEvent.click(leaf);
  expect(saved).toHaveBeenCalledTimes(1);
  expect(saved.mock.calls[0][0]).toMatchObject({ id: "second", testPointInfo: { qualifier: {
    value: 100, unit: "Hz", qualifier: { value: "1 year" },
  } }, uutTolerance: { rangeId: "frequency-100", rangeSelection: "explicit", includeResolutionInBudget: true },
    components: [{ id: "manual-source", value: 4 }] });
  expect(screen.getByTestId("first").querySelector('.point-qualifier')).toHaveTextContent("10 Hz");
  expect(screen.getByTestId("second").querySelector('.point-qualifier')).toHaveTextContent("100 Hz");
  expect(screen.getByTestId("third").querySelector('.point-qualifier')).toHaveTextContent("10 Hz");
  expect(screen.queryByRole("tree")).toBeNull();
});

test("keeps different nested qualifier paths separate in the measurement list", () => {
  const points = [makePoint("a"), makePoint("b")];
  points[1].testPointInfo.qualifier.qualifier.value = "90 days";
  const groups = buildSidebarCellGroups(points, null, formatPointQualifier);
  expect(groups.map(group => group.qualifier.span)).toEqual([1, 1]);
  expect(formatPointQualifier(points[0].testPointInfo.qualifier)).toContain("1 year");
  expect(formatPointQualifier(points[1].testPointInfo.qualifier)).toContain("90 days");
});

test("preserves the free-text qualifier editor for instruments without qualifiers", () => {
  const save = vi.fn();
  const { container } = render(<SidebarPointItem point={makePoint("plain")} isSelected
    currentUut={{ id: "plain", instrument: { ranges: [{ id: "r", min: 0, max: 100, unit: "V" }] } }}
    visibleColumns={{ qualifier: true }} onSelect={vi.fn()} onSave={save} />);
  fireEvent.click(container.querySelector('.point-qualifier [data-point-editor-trigger]'));
  const input = container.querySelector('.qualifier-editor');
  fireEvent.change(input, { target: { value: "Custom condition" } });
  fireEvent.blur(input);
  expect(save.mock.calls[0][0].testPointInfo.qualifier.value).toBe("Custom condition");
  expect(screen.queryByRole("tree")).toBeNull();
});
