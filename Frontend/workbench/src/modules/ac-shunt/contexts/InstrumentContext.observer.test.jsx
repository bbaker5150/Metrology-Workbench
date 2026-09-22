import React from "react";
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InstrumentContextProvider, useInstruments } from "./InstrumentContext";

class Socket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 1; Socket.instances.push(this); }
  send = vi.fn();
  close() { this.readyState = 3; this.onclose?.({ code: 1006, reason: "simulated interruption" }); }
  message(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
function View() {
  const c = useInstruments();
  return <><output>{`${c.isRemoteViewer}:${c.selectedSessionId}`}</output><span data-testid="live">{JSON.stringify({ collecting: c.isCollecting, readings: c.liveReadings, point: c.focusedTPKey, details: c.activeCollectionDetails })}</span><button onClick={() => c.observeSession(89)}>Observe</button><button onClick={c.leaveObserverMode}>Leave</button><button onClick={() => c.setSelectedSessionId(90)}>Host</button></>;
}
beforeEach(() => { vi.useFakeTimers(); sessionStorage.clear(); Socket.instances = []; vi.stubGlobal("WebSocket", Socket); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true })); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("keeps observation through hours of idle heartbeats, transport retries and remounts", () => {
  let view = render(<InstrumentContextProvider><View /></InstrumentContextProvider>);
  fireEvent.click(screen.getByText("Observe"));
  const reading = () => Socket.instances.filter(s => s.url.includes('collect-readings')).at(-1);
  for (let minute = 0; minute < 360; minute++) act(() => {
    reading().message({ type: 'heartbeat' });
    vi.advanceTimersByTime(60000);
  });
  expect(screen.getByRole('status')).toHaveTextContent('true:89');
  act(() => { reading().close(); vi.advanceTimersByTime(3000); });
  expect(reading().url).toContain('role=remote');
  expect(screen.getByRole('status')).toHaveTextContent('true:89');
  act(() => Socket.instances.filter(s => s.url.includes('host-sync')).at(-1).close());
  view.unmount();
  const count = Socket.instances.length;
  act(() => vi.advanceTimersByTime(80000));
  expect(Socket.instances).toHaveLength(count);
  view = render(<InstrumentContextProvider><View /></InstrumentContextProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('true:89');
  fireEvent.click(screen.getByText('Leave'));
  view.unmount();
  render(<InstrumentContextProvider><View /></InstrumentContextProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('false:null');
});

it("replaces a half-open observer socket on wake and hydrates the current readings and cycle", () => {
  let visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  const view = render(<InstrumentContextProvider><View /></InstrumentContextProvider>);
  fireEvent.click(screen.getByText("Observe"));
  const reading = () => Socket.instances.filter(s => s.url.includes("collect-readings")).at(-1);
  const oldSocket = reading();
  act(() => { visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange")); });
  expect(reading()).toBe(oldSocket);
  act(() => { visibility = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
  const resumed = reading();
  expect(resumed).not.toBe(oldSocket);
  expect(oldSocket.readyState).toBe(Socket.CLOSED);
  expect(resumed.url).toContain("89/?role=remote");
  act(() => resumed.onopen());
  expect(resumed.send).toHaveBeenCalledWith(JSON.stringify({ command: "request_live_sync" }));
  act(() => {
    document.dispatchEvent(new Event("resume"));
    window.dispatchEvent(new Event("pageshow"));
  });
  expect(reading()).toBe(resumed);
  const snapshot = { type: "live_state_sync", isCollecting: true,
    activeCollectionDetails: { cycle_index: 4, stage: "ac_open" }, focusedTPKey: "2_1000",
    liveReadings: { ac_open: [{ t: 1750000000000, v: 2.4, cycle: 4 }] } };
  act(() => resumed.message(snapshot));
  const live = JSON.parse(screen.getByTestId("live").textContent);
  expect(live).toMatchObject({ collecting: true, point: "2_1000", details: { cycle_index: 4 },
    readings: { ac_open: [{ v: 2.4, cycle: 4, t: new Date(1750000000000).toISOString() }] } });
  // Old socket callbacks and delayed retries cannot replace the new snapshot.
  act(() => oldSocket.message({ type: "live_state_sync", isCollecting: false }));
  expect(JSON.parse(screen.getByTestId("live").textContent).collecting).toBe(true);
  view.unmount();
  const count = Socket.instances.length;
  act(() => { window.dispatchEvent(new Event("online")); vi.advanceTimersByTime(80000); });
  expect(Socket.instances).toHaveLength(count);
});

it("does not replace the operator socket when its window becomes visible", () => {
  render(<InstrumentContextProvider><View /></InstrumentContextProvider>);
  fireEvent.click(screen.getByText("Host"));
  const socket = Socket.instances.filter(s => s.url.includes("collect-readings")).at(-1);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(Socket.instances.filter(s => s.url.includes("collect-readings")).at(-1)).toBe(socket);
  expect(socket.readyState).toBe(Socket.OPEN);
});
