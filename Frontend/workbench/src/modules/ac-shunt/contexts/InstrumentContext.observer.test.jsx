import React from "react";
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InstrumentContextProvider, useInstruments } from "./InstrumentContext";

class Socket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 1; Socket.instances.push(this); }
  send() {}
  close() { this.readyState = 3; this.onclose?.({ code: 1006, reason: "simulated interruption" }); }
  message(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
function View() {
  const c = useInstruments();
  return <><output>{`${c.isRemoteViewer}:${c.selectedSessionId}`}</output><button onClick={() => c.observeSession(89)}>Observe</button><button onClick={c.leaveObserverMode}>Leave</button></>;
}
beforeEach(() => { vi.useFakeTimers(); sessionStorage.clear(); Socket.instances = []; vi.stubGlobal("WebSocket", Socket); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true })); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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
