import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useObserverTab } from "./useObserverTab";
import { saveObservation } from "../utils/observationState";

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("restores both observer tabs from storage after all component state is lost", () => {
  const useView = () => ({
    main: useObserverTab(89, true, "mainTab", "sessionSetup"),
    sub: useObserverTab(89, true, "calibrationTab", "settings"),
  });
  let view = renderHook(useView);
  expect(view.result.current.main[0]).toBe("runCalibration");
  expect(view.result.current.sub[0]).toBe("readings");
  act(() => view.result.current.sub[1]("settings"));
  act(() => view.result.current.sub[1]("readings"));
  act(() => view.result.current.main[1]("calibrationResults"));
  view.unmount();
  view = renderHook(useView);
  expect(view.result.current.main[0]).toBe("calibrationResults");
  act(() => view.result.current.main[1]("runCalibration"));
  expect(view.result.current.sub[0]).toBe("readings");
  view.unmount();
  expect(renderHook(useView).result.current.main[0]).toBe("runCalibration");
});

it("scopes choices to the observed session and clears them on explicit leave", () => {
  saveObservation(89);
  const view = renderHook(({ id, remote }) => useObserverTab(id, remote, "calibrationTab", "settings"),
    { initialProps: { id: 89, remote: true } });
  act(() => view.result.current[1]("calculate"));
  view.rerender({ id: 90, remote: true });
  expect(view.result.current[0]).toBe("readings");
  view.rerender({ id: 89, remote: true });
  expect(view.result.current[0]).toBe("calculate");
  saveObservation(null);
  view.rerender({ id: null, remote: false });
  expect(view.result.current[0]).toBe("settings");
  view.rerender({ id: 89, remote: true });
  expect(view.result.current[0]).toBe("readings");
});

it("keeps in-memory navigation functional when browser storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  const view = renderHook(() => useObserverTab(89, true, "calibrationTab", "settings"));
  expect(view.result.current[0]).toBe("readings");
  act(() => view.result.current[1]("calculate"));
  expect(view.result.current[0]).toBe("calculate");
});
