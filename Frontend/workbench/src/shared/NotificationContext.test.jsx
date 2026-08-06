import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationProvider, useNotifications } from "./NotificationContext";

// gsap drives the enter/exit tweens. Exit removal is gated on the tween's
// onComplete, so a synchronous stand-in keeps the lifecycle assertions
// deterministic without waiting on real rAF timing.
vi.mock("gsap", () => {
  const to = vi.fn((_target, vars) => {
    vars?.onComplete?.();
    return { kill: vi.fn() };
  });
  const timeline = vi.fn(() => {
    const tl = { fromTo: vi.fn(() => tl), kill: vi.fn() };
    return tl;
  });
  return { gsap: { to, set: vi.fn(), fromTo: vi.fn(), timeline } };
});

let show;

function Harness() {
  show = useNotifications().showNotification;
  return null;
}

const renderProvider = () =>
  render(
    <NotificationProvider>
      <Harness />
    </NotificationProvider>,
  );

const raise = (...args) => act(() => show(...args));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  show = undefined;
});

describe("useNotifications", () => {
  it("throws a clear error when used outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Orphan() {
      useNotifications();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow(
      /useNotifications must be used within a NotificationProvider/,
    );
    spy.mockRestore();
  });
});

describe("raising toasts", () => {
  it("renders nothing until a toast is raised", () => {
    const { container } = renderProvider();
    expect(container.querySelector(".notification-toast-stack")).toBeNull();
  });

  it("shows the message and defaults to the info type", () => {
    renderProvider();
    raise("Calibration started");

    const toast = screen.getByRole("alert");
    expect(toast).toHaveTextContent("Calibration started");
    expect(toast).toHaveClass("toast-info");
  });

  it.each(["success", "warning", "error", "info"])("renders a %s toast", (type) => {
    renderProvider();
    raise("styled", type);
    expect(screen.getByRole("alert")).toHaveClass(`toast-${type}`);
  });

  it("falls back to the info icon for an unknown type", () => {
    renderProvider();
    raise("odd", "chartreuse");
    expect(screen.getByRole("alert")).toHaveClass("toast-chartreuse");
  });

  it("announces the stack politely for screen readers", () => {
    const { container } = renderProvider();
    raise("hello");
    const stack = container.querySelector(".notification-toast-stack");
    expect(stack).toHaveAttribute("aria-live", "polite");
  });

  it("stacks newest-first", () => {
    renderProvider();
    raise("first");
    raise("second");
    const toasts = screen.getAllByRole("alert");
    expect(toasts[0]).toHaveTextContent("second");
    expect(toasts[1]).toHaveTextContent("first");
  });

  it("caps the visible stack at four toasts, dropping the oldest", () => {
    renderProvider();
    ["a", "b", "c", "d", "e"].forEach((m) => raise(m));
    const toasts = screen.getAllByRole("alert");
    expect(toasts).toHaveLength(4);
    expect(screen.queryByText("a")).toBeNull();
    expect(screen.getByText("e")).toBeInTheDocument();
  });

  it("coalesces a duplicate message+type instead of stacking a second copy", () => {
    renderProvider();
    raise("Instrument offline", "error");
    raise("Instrument offline", "error");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("treats the same message with a different type as a distinct toast", () => {
    renderProvider();
    raise("Sync", "info");
    raise("Sync", "error");
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("moves a coalesced duplicate back to the top of the stack", () => {
    renderProvider();
    raise("older");
    raise("newer");
    raise("older");
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("older");
  });
});

describe("dismissal", () => {
  it("auto-dismisses after the default 4s duration", async () => {
    renderProvider();
    raise("temporary");
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(4000));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("honors an explicit duration", async () => {
    renderProvider();
    raise("quick", "info", 1000);

    act(() => void vi.advanceTimersByTime(999));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(1));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("keeps a toast on screen indefinitely when duration is 0", () => {
    renderProvider();
    raise("sticky", "warning", 0);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("dismisses when the close button is clicked", async () => {
    renderProvider();
    raise("closable", "info", 0);
    act(() => screen.getByLabelText("Dismiss").click());
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("restarts the timer when a duplicate re-raises a toast", async () => {
    renderProvider();
    raise("repeat", "info", 2000);
    act(() => void vi.advanceTimersByTime(1500));
    raise("repeat", "info", 2000); // resets the countdown

    act(() => void vi.advanceTimersByTime(1500));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(500));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("clears pending timers on unmount without firing them", () => {
    const { unmount } = renderProvider();
    raise("pending", "info", 5000);
    unmount();
    expect(() => act(() => void vi.advanceTimersByTime(10_000))).not.toThrow();
  });
});
