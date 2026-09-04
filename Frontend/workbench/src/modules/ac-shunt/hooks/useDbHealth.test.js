import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useDbHealth from "./useDbHealth";

// Minimal WebSocket stand-in. jsdom has no WebSocket implementation, and the
// hook drives everything through the on* handlers, so a recording fake lets us
// assert the reconnect/backoff and command behavior deterministically.
class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.OPEN;
    this.sent = [];
    this.closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    FakeWebSocket.instances.push(this);
  }

  send(payload) {
    this.sent.push(payload);
  }

  close() {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
  }

  // -- test drivers ------------------------------------------------------
  open() {
    act(() => this.onopen?.());
  }

  message(data) {
    act(() => this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) }));
  }

  serverClose() {
    act(() => this.onclose?.());
  }
}

const latest = () => FakeWebSocket.instances.at(-1);

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDbHealth", () => {
  it("opens a socket against the /ws/db-health/ topic when enabled", () => {
    renderHook(() => useDbHealth());
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(latest().url).toMatch(/\/db-health\/$/);
  });

  it("starts disconnected with zeroed counters and an assumed-reachable DB", () => {
    const { result } = renderHook(() => useDbHealth());
    expect(result.current).toMatchObject({
      reachable: true,
      pendingCount: 0,
      failedCount: 0,
      pendingDetails: [],
      timestamp: 0,
      connected: false,
    });
  });

  it("opens no socket at all when disabled, so SQLite dev runs stay quiet", () => {
    const { result } = renderHook(() => useDbHealth({ enabled: false }));
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.connected).toBe(false);
  });

  it("marks itself connected once the handshake completes", () => {
    const { result } = renderHook(() => useDbHealth());
    latest().open();
    expect(result.current.connected).toBe(true);
  });

  it("projects a db_status frame onto the returned state", () => {
    const { result } = renderHook(() => useDbHealth());
    latest().open();
    latest().message({
      type: "db_status",
      reachable: false,
      pending_count: 4,
      failed_count: 2,
      pending_details: [{ id: 7 }],
      timestamp: 1700000000,
    });

    expect(result.current).toMatchObject({
      reachable: false,
      pendingCount: 4,
      failedCount: 2,
      pendingDetails: [{ id: 7 }],
      timestamp: 1700000000,
      connected: true,
    });
  });

  it("coerces missing or non-numeric counts to 0 rather than leaking NaN into the pill", () => {
    const { result } = renderHook(() => useDbHealth());
    latest().open();
    latest().message({ type: "db_status", reachable: true, pending_count: "nope" });
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.failedCount).toBe(0);
    expect(result.current.pendingDetails).toEqual([]);
  });

  it("falls back to the current time when the frame omits a timestamp", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { result } = renderHook(() => useDbHealth());
    latest().open();
    latest().message({ type: "db_status", reachable: true });
    expect(result.current.timestamp).toBeCloseTo(Date.now() / 1000, 3);
  });

  it("ignores malformed frames and frames of an unrelated type", () => {
    const { result } = renderHook(() => useDbHealth());
    latest().open();
    latest().message("{not json");
    latest().message({ type: "something_else", pending_count: 99 });
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.connected).toBe(true);
  });

  it("reconnects with exponential backoff after the server drops the socket", () => {
    renderHook(() => useDbHealth());
    latest().open();

    latest().serverClose();
    expect(FakeWebSocket.instances).toHaveLength(1);

    // First retry is scheduled at 2^0 * 1000ms.
    act(() => void vi.advanceTimersByTime(1000));
    expect(FakeWebSocket.instances).toHaveLength(2);

    // Second retry doubles to 2000ms.
    latest().serverClose();
    act(() => void vi.advanceTimersByTime(1999));
    expect(FakeWebSocket.instances).toHaveLength(2);
    act(() => void vi.advanceTimersByTime(1));
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("caps the backoff at 120s no matter how long the server stays down", () => {
    renderHook(() => useDbHealth());
    // Force the attempt counter past the 2^10 = 1024s point.
    for (let i = 0; i < 12; i += 1) {
      latest().serverClose();
      act(() => void vi.advanceTimersByTime(120_000));
    }
    const before = FakeWebSocket.instances.length;
    latest().serverClose();
    act(() => void vi.advanceTimersByTime(120_000));
    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });

  it("resets the backoff after a successful reconnect", () => {
    renderHook(() => useDbHealth());
    latest().serverClose();
    act(() => void vi.advanceTimersByTime(1000)); // attempt 2 created
    latest().serverClose();
    act(() => void vi.advanceTimersByTime(2000)); // attempt 3 created
    latest().open(); // success -> counter resets

    const count = FakeWebSocket.instances.length;
    latest().serverClose();
    act(() => void vi.advanceTimersByTime(1000)); // back to the 1s delay
    expect(FakeWebSocket.instances.length).toBe(count + 1);
  });

  it("reports disconnected while waiting to reconnect", () => {
    const { result } = renderHook(() => useDbHealth());
    latest().open();
    expect(result.current.connected).toBe(true);
    latest().serverClose();
    expect(result.current.connected).toBe(false);
  });

  it("sends a refresh command over an open socket", () => {
    const { result } = renderHook(() => useDbHealth());
    latest().open();
    act(() => result.current.refresh());
    expect(latest().sent).toEqual([JSON.stringify({ command: "refresh" })]);
  });

  it("sends a retry_failed command over an open socket", () => {
    const { result } = renderHook(() => useDbHealth());
    latest().open();
    act(() => result.current.retryFailed());
    expect(latest().sent).toEqual([JSON.stringify({ command: "retry_failed" })]);
  });

  it("drops commands when the socket is not open instead of throwing", () => {
    const { result } = renderHook(() => useDbHealth());
    const ws = latest();
    ws.open();
    ws.readyState = FakeWebSocket.CLOSED;
    expect(() => act(() => result.current.refresh())).not.toThrow();
    expect(() => act(() => result.current.retryFailed())).not.toThrow();
    expect(ws.sent).toEqual([]);
  });

  it("swallows a send() that throws mid-flight", () => {
    const { result } = renderHook(() => useDbHealth());
    const ws = latest();
    ws.open();
    ws.send = () => {
      throw new Error("socket died");
    };
    expect(() => act(() => result.current.refresh())).not.toThrow();
  });

  it("closes the socket and cancels pending reconnects on unmount", () => {
    const { unmount } = renderHook(() => useDbHealth());
    const ws = latest();
    ws.open();
    ws.serverClose();

    unmount();
    act(() => void vi.advanceTimersByTime(600_000));
    // The scheduled reconnect must not fire after unmount.
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("tears the socket down when enabled flips to false", () => {
    const { result, rerender } = renderHook(({ enabled }) => useDbHealth({ enabled }), {
      initialProps: { enabled: true },
    });
    const ws = latest();
    ws.open();
    expect(result.current.connected).toBe(true);

    rerender({ enabled: false });
    expect(ws.closed).toBe(true);
    expect(result.current.connected).toBe(false);
  });

  it("reconnects when enabled flips back to true", () => {
    const { rerender } = renderHook(({ enabled }) => useDbHealth({ enabled }), {
      initialProps: { enabled: false },
    });
    expect(FakeWebSocket.instances).toHaveLength(0);
    rerender({ enabled: true });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("retries in 5s when the WebSocket constructor itself throws", () => {
    vi.stubGlobal(
      "WebSocket",
      class Boom {
        constructor() {
          throw new Error("handshake refused");
        }
      },
    );
    expect(() => renderHook(() => useDbHealth())).not.toThrow();

    // Swap in the working fake and confirm the retry lands.
    vi.stubGlobal("WebSocket", FakeWebSocket);
    act(() => void vi.advanceTimersByTime(5000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
