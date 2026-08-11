import { describe, expect, it } from "vitest";
import { MODULES } from "./moduleRegistry";

// The registry is the single source of truth shared by the router
// (app/routes.jsx) and the launcher (app/HomeLauncher.jsx). These guards exist
// so a malformed entry fails here rather than as a blank route at runtime.

describe("workbench module registry", () => {
  it("exposes the three shipped tools", () => {
    expect(MODULES.map((m) => m.id)).toEqual(["ac-shunt", "uncertainty", "reports"]);
  });

  it("gives every module the fields the launcher and router both read", () => {
    for (const mod of MODULES) {
      expect(typeof mod.id, `${mod.id}.id`).toBe("string");
      expect(typeof mod.route, `${mod.id}.route`).toBe("string");
      expect(typeof mod.title, `${mod.id}.title`).toBe("string");
      expect(typeof mod.subtitle, `${mod.id}.subtitle`).toBe("string");
      expect(mod.title.length, `${mod.id}.title non-empty`).toBeGreaterThan(0);
    }
  });

  it("uses kebab-case ids and route segments with no leading slash", () => {
    for (const mod of MODULES) {
      expect(mod.id, `${mod.id} is kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(mod.route, `${mod.id} route is a bare segment`).toMatch(
        /^[a-z0-9]+(-[a-z0-9]+)*$/,
      );
    }
  });

  it("keeps path in sync with route, since routes.jsx mounts route and the launcher navigates to path", () => {
    // A drift between these two is exactly the bug that renders a dead tile.
    for (const mod of MODULES) {
      expect(mod.path, `${mod.id}`).toBe(`/${mod.route}`);
    }
  });

  it("assigns unique ids, routes, and paths", () => {
    const unique = (key) => new Set(MODULES.map((m) => m[key])).size;
    expect(unique("id")).toBe(MODULES.length);
    expect(unique("route")).toBe(MODULES.length);
    expect(unique("path")).toBe(MODULES.length);
  });

  it("only uses statuses the launcher knows how to render", () => {
    for (const mod of MODULES) {
      expect(["ready", "coming-soon"]).toContain(mod.status);
    }
  });

  it("gives every ready module a lazy Component so the router can mount it", () => {
    for (const mod of MODULES.filter((m) => m.status === "ready")) {
      expect(mod.Component, `${mod.id}.Component`).toBeTruthy();
      expect(typeof mod.Component, `${mod.id}.Component`).toBe("object");
      expect(mod.Component.$$typeof, `${mod.id} is React.lazy`).toBe(Symbol.for("react.lazy"));
    }
  });

  it("exposes a stable preload function so the launcher can warm a module before navigation", () => {
    for (const mod of MODULES.filter((m) => m.status === "ready")) {
      expect(typeof mod.preload, `${mod.id}.preload`).toBe("function");
    }
  });

  it("routes the uncertainty module at /uncertalytics, which routes.jsx redirects /uncertainty to", () => {
    const uncertainty = MODULES.find((m) => m.id === "uncertainty");
    expect(uncertainty.route).toBe("uncertalytics");
  });

  it("routes the reports module at /report-of-calibration", () => {
    const reports = MODULES.find((m) => m.id === "reports");
    expect(reports.route).toBe("report-of-calibration");
  });
});
