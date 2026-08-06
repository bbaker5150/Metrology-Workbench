import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CaptionControls from "./CaptionControls";

// The component talks to Electron through window.require("electron").ipcRenderer.
// In a plain browser that bridge is absent and it must render nothing.
const makeIpc = (overrides = {}) => ({
  invoke: vi.fn().mockResolvedValue(false),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  ...overrides,
});

const installElectron = (ipcRenderer) => {
  window.require = vi.fn((mod) => {
    if (mod === "electron") return { ipcRenderer };
    throw new Error(`unexpected require(${mod})`);
  });
};

beforeEach(() => {
  delete window.require;
});

afterEach(() => {
  delete window.require;
  vi.restoreAllMocks();
});

describe("outside Electron", () => {
  it("renders nothing when there is no window.require bridge", () => {
    const { container } = render(<CaptionControls />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when require('electron') throws", () => {
    window.require = vi.fn(() => {
      throw new Error("Cannot find module 'electron'");
    });
    const { container } = render(<CaptionControls />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("inside Electron", () => {
  it("renders the three window controls", () => {
    installElectron(makeIpc());
    render(<CaptionControls />);
    expect(screen.getByLabelText("Minimize")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximize")).toBeInTheDocument();
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });

  it("asks the main process for the current maximize state on mount", () => {
    const ipc = makeIpc();
    installElectron(ipc);
    render(<CaptionControls />);
    expect(ipc.invoke).toHaveBeenCalledWith("window-is-maximized");
  });

  it("shows Restore when the window starts maximized", async () => {
    installElectron(makeIpc({ invoke: vi.fn().mockResolvedValue(true) }));
    render(<CaptionControls />);
    expect(await screen.findByLabelText("Restore")).toBeInTheDocument();
  });

  it("survives the maximize-state query rejecting", async () => {
    const ipc = makeIpc({ invoke: vi.fn().mockRejectedValue(new Error("no handler")) });
    installElectron(ipc);
    render(<CaptionControls />);
    // Falls back to the un-maximized label rather than crashing the top bar.
    expect(await screen.findByLabelText("Maximize")).toBeInTheDocument();
  });

  it("flips the label when the main process pushes a new maximize state", async () => {
    const ipc = makeIpc();
    installElectron(ipc);
    render(<CaptionControls />);

    const [channel, handler] = ipc.on.mock.calls[0];
    expect(channel).toBe("window-maximize-state");

    act(() => handler({}, true));
    await waitFor(() => expect(screen.getByLabelText("Restore")).toBeInTheDocument());

    act(() => handler({}, false));
    await waitFor(() => expect(screen.getByLabelText("Maximize")).toBeInTheDocument());
  });

  it("sends window-minimize when Minimize is clicked", async () => {
    const ipc = makeIpc();
    installElectron(ipc);
    render(<CaptionControls />);
    await userEvent.click(screen.getByLabelText("Minimize"));
    expect(ipc.send).toHaveBeenCalledWith("window-minimize");
  });

  it("sends window-maximize-toggle when Maximize is clicked", async () => {
    const ipc = makeIpc();
    installElectron(ipc);
    render(<CaptionControls />);
    await userEvent.click(screen.getByLabelText("Maximize"));
    expect(ipc.send).toHaveBeenCalledWith("window-maximize-toggle");
  });

  it("sends window-close when Close is clicked", async () => {
    const ipc = makeIpc();
    installElectron(ipc);
    render(<CaptionControls />);
    await userEvent.click(screen.getByLabelText("Close"));
    expect(ipc.send).toHaveBeenCalledWith("window-close");
  });

  it("removes its maximize-state listener on unmount", () => {
    const ipc = makeIpc();
    installElectron(ipc);
    const { unmount } = render(<CaptionControls />);
    const handler = ipc.on.mock.calls[0][1];
    unmount();
    expect(ipc.removeListener).toHaveBeenCalledWith("window-maximize-state", handler);
  });
});
