import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import useCycleAnalytics from "./useCycleAnalytics";
import { API_BASE_URL } from "../constants/constants";

vi.mock("axios", () => ({
  default: { patch: vi.fn().mockResolvedValue({ data: {} }) },
}));

// A focused test point carries the backend's pair_analytics blob, mirrored
// across the Fwd/Rev rows so a partially-collected pair still renders.
const analytics = (overrides = {}) => ({
  use_abba_pairing: true,
  outlier_filter_mode: "none",
  manual_excluded_pairs: [],
  auto_excluded_pairs: [],
  flagged_pairs: [],
  pair_rows: [],
  pair_delta_uut_ppm: null,
  pair_type_a_uncertainty_ppm: null,
  n_pairs_used: 0,
  ...overrides,
});

const point = ({ forward, reverse } = {}) => ({
  ...(forward ? { forward: { id: forward.id ?? 11, results: { pair_analytics: forward.blob } } } : {}),
  ...(reverse ? { reverse: { id: reverse.id ?? 22, results: { pair_analytics: reverse.blob } } } : {}),
});

const setup = (props = {}) =>
  renderHook(() =>
    useCycleAnalytics({
      focusedTestPoint: point({ forward: { blob: analytics() } }),
      sessionId: 7,
      ...props,
    }),
  );

beforeEach(() => {
  axios.patch.mockClear();
  axios.patch.mockResolvedValue({ data: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reading the analytics payload", () => {
  it("reports no analytics when the point has none", () => {
    const { result } = setup({ focusedTestPoint: null });
    expect(result.current.hasAnalytics).toBe(false);
    expect(result.current.stats).toEqual({ mean: null, uA: null, n: 0 });
    expect(result.current.pairRows).toEqual([]);
  });

  it("reads the blob from the forward row", () => {
    const { result } = setup({
      focusedTestPoint: point({ forward: { blob: analytics({ n_pairs_used: 3 }) } }),
    });
    expect(result.current.hasAnalytics).toBe(true);
    expect(result.current.stats.n).toBe(3);
  });

  it("falls back to the reverse row so a reverse-only pair still renders", () => {
    const { result } = setup({
      focusedTestPoint: point({ reverse: { blob: analytics({ n_pairs_used: 2 }) } }),
    });
    expect(result.current.hasAnalytics).toBe(true);
    expect(result.current.stats.n).toBe(2);
  });

  it("maps the headline mean and Type A uncertainty from the backend", () => {
    const { result } = setup({
      focusedTestPoint: point({
        forward: {
          blob: analytics({
            pair_delta_uut_ppm: -12.5,
            pair_type_a_uncertainty_ppm: 0.8,
            n_pairs_used: 5,
          }),
        },
      }),
    });
    expect(result.current.stats).toEqual({ mean: -12.5, uA: 0.8, n: 5 });
  });

  it("defaults n to 0 when the backend omits it", () => {
    const { result } = setup({
      focusedTestPoint: point({ forward: { blob: analytics({ n_pairs_used: undefined }) } }),
    });
    expect(result.current.stats.n).toBe(0);
  });

  it("converts snake_case pair rows to the camelCase shape the tables render", () => {
    const { result } = setup({
      focusedTestPoint: point({
        forward: {
          blob: analytics({
            pair_rows: [
              {
                pair_num: 1,
                fwd_cycle_num: 1,
                rev_cycle_num: 2,
                fwd_delta: 10.1,
                rev_delta: 9.9,
                paired_avg: 10.0,
              },
            ],
          }),
        },
      }),
    });
    expect(result.current.pairRows).toEqual([
      { pairNum: 1, fwdCycleNum: 1, revCycleNum: 2, fwdDelta: 10.1, revDelta: 9.9, pairedAvg: 10.0 },
    ]);
  });

  it("exposes the exclusion and flag sets for row highlighting", () => {
    const { result } = setup({
      focusedTestPoint: point({
        forward: {
          blob: analytics({
            manual_excluded_pairs: [2],
            auto_excluded_pairs: [3],
            flagged_pairs: [3, 4],
          }),
        },
      }),
    });
    expect(result.current.manualExcluded).toEqual(new Set([2]));
    expect(result.current.autoExcluded).toEqual(new Set([3]));
    expect(result.current.flagged).toEqual(new Set([3, 4]));
  });

  it("defaults the outlier filter to none", () => {
    const { result } = setup();
    expect(result.current.filterMode).toBe("none");
  });

  it("reflects the backend's ABBA pairing flag over the caller default", () => {
    const { result } = setup({
      focusedTestPoint: point({ forward: { blob: analytics({ use_abba_pairing: false }) } }),
      defaultUseAbba: true,
    });
    expect(result.current.useAbba).toBe(false);
  });

  it("uses the caller default when the backend has not recorded a preference", () => {
    const { result } = setup({
      focusedTestPoint: point({ forward: { blob: analytics({ use_abba_pairing: null }) } }),
      defaultUseAbba: false,
    });
    expect(result.current.useAbba).toBe(false);
  });

  it("defaults ABBA pairing on when neither backend nor caller specify", () => {
    const { result } = renderHook(() => useCycleAnalytics({ focusedTestPoint: null, sessionId: 1 }));
    expect(result.current.useAbba).toBe(true);
  });
});

describe("PATCHing toggles", () => {
  const url = (tpId = 11, sessionId = 7) =>
    `${API_BASE_URL}/calibration_sessions/${sessionId}/test_points/${tpId}/analytics/`;

  it("writes the ABBA toggle against the forward row as canonical target", async () => {
    const { result } = setup();
    await act(() => result.current.setUseAbba(false));
    expect(axios.patch).toHaveBeenCalledWith(url(), { use_abba_pairing: false });
  });

  it("writes against the reverse row when there is no forward row", async () => {
    const { result } = setup({
      focusedTestPoint: point({ reverse: { id: 22, blob: analytics() } }),
    });
    await act(() => result.current.setUseAbba(true));
    expect(axios.patch).toHaveBeenCalledWith(url(22), { use_abba_pairing: true });
  });

  it("normalizes the filter mode to exactly auto or none", async () => {
    const { result } = setup();
    await act(() => result.current.setFilterMode("auto"));
    expect(axios.patch).toHaveBeenLastCalledWith(url(), { outlier_filter_mode: "auto" });

    await act(() => result.current.setFilterMode("something-else"));
    expect(axios.patch).toHaveBeenLastCalledWith(url(), { outlier_filter_mode: "none" });
  });

  it("adds a pair to the manual exclusion set", async () => {
    const { result } = setup({
      focusedTestPoint: point({ forward: { blob: analytics({ manual_excluded_pairs: [1] }) } }),
    });
    await act(() => result.current.toggleExclusion(2));
    expect(axios.patch).toHaveBeenCalledWith(url(), { manual_excluded_pairs: [1, 2] });
  });

  it("removes a pair that was already excluded", async () => {
    const { result } = setup({
      focusedTestPoint: point({ forward: { blob: analytics({ manual_excluded_pairs: [1, 2] }) } }),
    });
    await act(() => result.current.toggleExclusion(1));
    expect(axios.patch).toHaveBeenCalledWith(url(), { manual_excluded_pairs: [2] });
  });

  it("refreshes shared state after a successful write so every view agrees", async () => {
    const onDataUpdate = vi.fn().mockResolvedValue(undefined);
    const { result } = setup({ onDataUpdate });
    await act(() => result.current.setUseAbba(false));
    expect(onDataUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not write without a session id", async () => {
    const { result } = setup({ sessionId: null });
    await act(() => result.current.setUseAbba(false));
    expect(axios.patch).not.toHaveBeenCalled();
  });

  it("does not write when no test point is focused", async () => {
    const { result } = setup({ focusedTestPoint: null });
    await act(() => result.current.setUseAbba(false));
    expect(axios.patch).not.toHaveBeenCalled();
  });

  it("coalesces concurrent writes down to one in-flight PATCH", async () => {
    let release;
    axios.patch.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const { result } = setup();
    let first;
    act(() => { first = result.current.setUseAbba(false); });
    // Second toggle arrives while the first is still in flight.
    await act(() => result.current.setUseAbba(true));
    expect(axios.patch).toHaveBeenCalledTimes(1);

    await act(async () => { release({ data: {} }); await first; });
  });

  it("allows a new write once the previous one settles", async () => {
    const { result } = setup();
    await act(() => result.current.setUseAbba(false));
    await act(() => result.current.setUseAbba(true));
    expect(axios.patch).toHaveBeenCalledTimes(2);
  });

  it("swallows a failed PATCH and keeps the previous payload on screen", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    axios.patch.mockRejectedValue(new Error("network down"));

    const { result } = setup({
      focusedTestPoint: point({ forward: { blob: analytics({ n_pairs_used: 4 }) } }),
    });
    await act(() => result.current.setUseAbba(false));

    expect(warn).toHaveBeenCalledWith("useCycleAnalytics PATCH failed:", expect.any(Error));
    expect(result.current.stats.n).toBe(4);
  });

  it("clears the in-flight guard after a failure so the next toggle still writes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    axios.patch.mockRejectedValueOnce(new Error("network down"));

    const { result } = setup();
    await act(() => result.current.setUseAbba(false));
    await waitFor(() => expect(axios.patch).toHaveBeenCalledTimes(1));

    axios.patch.mockResolvedValue({ data: {} });
    await act(() => result.current.setUseAbba(true));
    expect(axios.patch).toHaveBeenCalledTimes(2);
  });
});
