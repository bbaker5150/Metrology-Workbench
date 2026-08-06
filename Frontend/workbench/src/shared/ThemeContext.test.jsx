import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeContext";

// The reveal wipe is a gsap tween over a proxy object. A controllable
// stand-in lets us assert the overlay lifecycle (created, masked, torn down)
// without depending on real animation timing.
const tweens = [];
vi.mock("gsap", () => ({
  gsap: {
    to: vi.fn((target, vars) => {
      const tween = { target, vars };
      tweens.push(tween);
      return tween;
    }),
    killTweensOf: vi.fn(),
  },
}));

const { gsap } = await import("gsap");

let ctx;
function Harness() {
  ctx = useTheme();
  return <button onClick={ctx.toggleTheme}>toggle</button>;
}

const renderProvider = () =>
  render(
    <ThemeProvider>
      <Harness />
    </ThemeProvider>,
  );

const overlays = () =>
  Array.from(document.body.children).filter(
    (el) => el.getAttribute?.("aria-hidden") === "true",
  );

const setReducedMotion = (matches) => {
  window.matchMedia = vi.fn().mockReturnValue({ matches });
};

beforeEach(() => {
  tweens.length = 0;
  localStorage.clear();
  document.body.className = "";
  document.body.innerHTML = "";
  window.innerWidth = 1000;
  window.innerHeight = 800;
  setReducedMotion(false);
  delete window.require;
});

afterEach(() => {
  vi.clearAllMocks();
  delete window.require;
  ctx = undefined;
});

describe("initial theme", () => {
  it("defaults to light when nothing is persisted", () => {
    renderProvider();
    expect(ctx.theme).toBe("light");
    expect(document.body).toHaveClass("light-mode");
  });

  it("restores the persisted theme on mount", () => {
    localStorage.setItem("theme", "dark");
    renderProvider();
    expect(ctx.theme).toBe("dark");
    expect(document.body).toHaveClass("dark-mode");
  });

  it("persists the active theme to localStorage", () => {
    renderProvider();
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("keeps exactly one theme class on the body", () => {
    localStorage.setItem("theme", "dark");
    renderProvider();
    expect(document.body.classList.contains("light-mode")).toBe(false);
    expect(document.body.classList.contains("dark-mode")).toBe(true);
  });
});

describe("toggleTheme", () => {
  it("flips light to dark and back", () => {
    renderProvider();
    act(() => ctx.toggleTheme());
    expect(ctx.theme).toBe("dark");
    expect(document.body).toHaveClass("dark-mode");

    act(() => ctx.toggleTheme());
    expect(ctx.theme).toBe("light");
    expect(document.body).toHaveClass("light-mode");
  });

  it("persists each flip", () => {
    renderProvider();
    act(() => ctx.toggleTheme());
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("swaps instantly with no overlay when reduced motion is requested", () => {
    setReducedMotion(true);
    renderProvider();
    act(() => ctx.toggleTheme());

    expect(ctx.theme).toBe("dark");
    expect(gsap.to).not.toHaveBeenCalled();
    expect(overlays()).toHaveLength(0);
  });

  it("mounts a pointer-transparent overlay painted in the outgoing theme color", () => {
    renderProvider();
    act(() => ctx.toggleTheme());

    const [overlay] = overlays();
    expect(overlay).toBeTruthy();
    expect(overlay.style.position).toBe("fixed");
    expect(overlay.style.pointerEvents).toBe("none");
    // Leaving light mode: the overlay holds the light canvas color.
    expect(overlay.style.background).toBe("rgb(245, 247, 251)");
  });

  it("applies the new theme immediately so the wipe reveals real UI underneath", () => {
    renderProvider();
    act(() => ctx.toggleTheme());
    // Body is already dark while the overlay still shows the old light canvas.
    expect(document.body).toHaveClass("dark-mode");
    expect(overlays()).toHaveLength(1);
  });

  it("removes the overlay when the wipe completes", () => {
    renderProvider();
    act(() => ctx.toggleTheme());
    expect(overlays()).toHaveLength(1);

    act(() => tweens.at(-1).vars.onComplete());
    expect(overlays()).toHaveLength(0);
  });

  it("grows the mask outward as the tween advances", () => {
    renderProvider();
    act(() => ctx.toggleTheme());

    const overlay = overlays()[0];
    const tween = tweens.at(-1);
    tween.target.r = 200;
    act(() => tween.vars.onUpdate());

    expect(overlay.style.maskImage).toContain("radial-gradient");
    expect(overlay.style.maskImage).toMatch(/transparent [\d.]+px/);
  });

  it("cancels an in-flight wipe when toggled again, leaving no orphan overlay", () => {
    renderProvider();
    act(() => ctx.toggleTheme());
    act(() => ctx.toggleTheme());

    expect(gsap.killTweensOf).toHaveBeenCalled();
    // The first overlay is torn down; only the second wipe remains on screen.
    expect(overlays()).toHaveLength(1);
  });
});

describe("wipe origin", () => {
  const originOf = () => {
    const overlay = overlays()[0];
    const tween = tweens.at(-1);
    tween.target.r = 10;
    act(() => tween.vars.onUpdate());
    const m = overlay.style.maskImage.match(/circle at ([\d.]+)px ([\d.]+)px/);
    return { x: Number(m[1]), y: Number(m[2]) };
  };

  it("starts the wipe at the click coordinates", () => {
    renderProvider();
    act(() => ctx.toggleTheme({ clientX: 120, clientY: 240 }));
    expect(originOf()).toEqual({ x: 120, y: 240 });
  });

  it("falls back to the target's center for a keyboard-activated toggle", () => {
    renderProvider();
    act(() =>
      ctx.toggleTheme({
        clientX: 0,
        clientY: 0,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 100, top: 50, width: 40, height: 20 }),
        },
      }),
    );
    expect(originOf()).toEqual({ x: 120, y: 60 });
  });

  it("falls back to the top-right corner when there is no event at all", () => {
    renderProvider();
    act(() => ctx.toggleTheme());
    expect(originOf()).toEqual({ x: window.innerWidth - 32, y: 32 });
  });
});

describe("Electron integration", () => {
  it("notifies the main process when the theme changes", () => {
    const send = vi.fn();
    window.require = vi.fn(() => ({ ipcRenderer: { send } }));
    renderProvider();
    expect(send).toHaveBeenCalledWith("theme-changed", "light");

    act(() => ctx.toggleTheme());
    expect(send).toHaveBeenCalledWith("theme-changed", "dark");
  });

  it("logs but does not crash when the Electron bridge throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    window.require = vi.fn(() => {
      throw new Error("no ipc");
    });
    expect(() => renderProvider()).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      "Failed to sync theme with Electron:",
      expect.any(Error),
    );
    error.mockRestore();
  });

  it("survives localStorage being unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => renderProvider()).not.toThrow();
    expect(screen.getByText("toggle")).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
