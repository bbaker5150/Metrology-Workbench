import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import InstrumentTableViewMenu, { useInstrumentTableView } from "./InstrumentTableViewMenu";

beforeEach(() => localStorage.clear());
function Harness({ session, kind = "uut" }) {
  const [view, change] = useInstrumentTableView(session, kind);
  return <InstrumentTableViewMenu kind={kind} value={view} onChange={change} />;
}
const checkbox = name => screen.getByRole("checkbox", { name });
it("defaults both choices off, changes them independently, and dismisses with Escape or an outside click", () => {
  render(<Harness session={{ id: "normal" }} />);
  const trigger = screen.getByRole("button", { name: "UUT table view" });
  fireEvent.click(trigger);
  expect(checkbox("Show all measurement areas")).not.toBeChecked();
  expect(checkbox("Show simplified view")).not.toBeChecked();
  fireEvent.click(checkbox("Show simplified view"));
  expect(checkbox("Show simplified view")).toBeChecked();
  expect(checkbox("Show all measurement areas")).not.toBeChecked();
  fireEvent.click(checkbox("Show all measurement areas"));
  expect(checkbox("Show all measurement areas")).toBeChecked();
  expect(checkbox("Show simplified view")).toBeChecked();
  fireEvent.keyDown(checkbox("Show simplified view"), { key: "Escape" });
  expect(screen.queryByRole("group")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("group")).not.toBeInTheDocument();
});
it("preserves per-session choices across point mounts without leaking into another session or table", () => {
  const imported = { id: "imported", simplifiedInstrumentTables: true };
  const { rerender, unmount } = render(<Harness session={imported} />);
  fireEvent.click(screen.getByRole("button"));
  expect(checkbox("Show simplified view")).toBeChecked();
  fireEvent.click(checkbox("Show simplified view"));
  rerender(<Harness session={{ id: "other", simplifiedInstrumentTables: true }} />);
  expect(checkbox("Show simplified view")).toBeChecked();
  rerender(<Harness session={imported} />);
  expect(checkbox("Show simplified view")).not.toBeChecked();
  rerender(<Harness session={imported} kind="tmde" />);
  expect(checkbox("Show simplified view")).toBeChecked();
  unmount();
  render(<Harness session={imported} />);
  fireEvent.click(screen.getByRole("button"));
  expect(checkbox("Show simplified view")).not.toBeChecked();
});
it("keeps only one table view dropdown open", () => {
  render(<><Harness session={{ id: "normal" }} /><Harness session={{ id: "normal" }} kind="tmde" /></>);
  fireEvent.click(screen.getByRole("button", { name: "UUT table view" }));
  fireEvent.click(screen.getByRole("button", { name: "TMDE table view" }));
  expect(screen.queryByRole("group", { name: "UUT table view options" })).not.toBeInTheDocument();
  expect(within(screen.getByRole("group", { name: "TMDE table view options" })).getAllByRole("checkbox")).toHaveLength(2);
});
