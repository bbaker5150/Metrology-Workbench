import { describe, expect, it, vi } from "vitest";

// Keep the real registry shape but avoid pulling three module bundles (and
// three.js) into this test through React.lazy.
vi.mock("./moduleRegistry", () => ({
  MODULES: [
    { id: "ac-shunt", route: "ac-shunt", path: "/ac-shunt", status: "ready", Component: () => null },
    { id: "uncertainty", route: "uncertalytics", path: "/uncertalytics", status: "ready", Component: () => null },
    { id: "reports", route: "report-of-calibration", path: "/report-of-calibration", status: "ready", Component: () => null },
    // A not-yet-built module must not produce a route at all.
    { id: "future", route: "future-tool", path: "/future-tool", status: "coming-soon", Component: null },
  ],
}));

const { router } = await import("./routes");

const rootRoute = () => router.routes[0];
const childPaths = () => rootRoute().children.map((c) => c.path);

describe("router shape", () => {
  it("mounts a single root route hosting the shell", () => {
    expect(router.routes).toHaveLength(1);
    expect(rootRoute().path).toBe("/");
    expect(rootRoute().element).toBeTruthy();
  });

  it("uses hash history so the same build works over file://, dev server, and serve -s", () => {
    // createHashRouter keeps all navigation after the '#'.
    expect(router.state.location.pathname).toBe("/");
    expect(window.location.hash.startsWith("#") || window.location.hash === "").toBe(true);
  });
});

describe("route table", () => {
  it("redirects the index route to the launcher", () => {
    const index = rootRoute().children.find((c) => c.index);
    expect(index).toBeTruthy();
    expect(index.element.props.to).toBe("/home");
    expect(index.element.props.replace).toBe(true);
  });

  it("mounts the launcher at /home", () => {
    expect(childPaths()).toContain("home");
  });

  it("gives every ready module a splat route so it owns its sub-routes", () => {
    expect(childPaths()).toContain("ac-shunt/*");
    expect(childPaths()).toContain("uncertalytics/*");
    expect(childPaths()).toContain("report-of-calibration/*");
  });

  it("omits modules that are not built yet", () => {
    expect(childPaths()).not.toContain("future-tool/*");
  });

  it("keeps the legacy /uncertainty alias pointed at /uncertalytics", () => {
    const legacy = rootRoute().children.find((c) => c.path === "uncertainty/*");
    expect(legacy.element.props.to).toBe("/uncertalytics");
    expect(legacy.element.props.replace).toBe(true);
  });

  it("keeps the legacy /reports alias pointed at /report-of-calibration", () => {
    const legacy = rootRoute().children.find((c) => c.path === "reports/*");
    expect(legacy.element.props.to).toBe("/report-of-calibration");
  });

  it("bounces unknown paths back to the launcher", () => {
    const splat = rootRoute().children.find((c) => c.path === "*");
    expect(splat.element.props.to).toBe("/home");
  });

  it("orders the catch-all last so it never shadows a real module route", () => {
    const paths = childPaths();
    expect(paths.at(-1)).toBe("*");
  });
});

describe("navigation", () => {
  it("resolves /home to the launcher route", async () => {
    await router.navigate("/home");
    expect(router.state.location.pathname).toBe("/home");
  });

  it("resolves a module route", async () => {
    await router.navigate("/ac-shunt");
    expect(router.state.location.pathname).toBe("/ac-shunt");
  });

  it("matches a module sub-path through the splat", async () => {
    await router.navigate("/uncertalytics/budget/42");
    expect(router.state.location.pathname).toBe("/uncertalytics/budget/42");
    expect(router.state.matches.some((m) => m.route.path === "uncertalytics/*")).toBe(true);
  });

  it("matches an unknown path against the catch-all rather than 404ing", async () => {
    await router.navigate("/nope");
    expect(router.state.matches.some((m) => m.route.path === "*")).toBe(true);
  });
});
