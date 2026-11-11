import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import axios from "axios";
import useInstrumentReviewAccess from "./useInstrumentReviewAccess";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));
beforeEach(() => axios.get.mockReset());

it.each([false, undefined, "true"])("does not allow a non-reviewer or malformed permission %s", async canValidate => {
  axios.get.mockResolvedValue({ data: { canValidate } });
  const { result } = renderHook(useInstrumentReviewAccess);
  await act(async () => {});
  expect(result.current).toBe(false);
  expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/instrument-review-access\/$/), expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it("rechecks access on focus and drops stale privilege after a failed check", async () => {
  axios.get.mockResolvedValueOnce({ data: { canValidate: true } });
  const { result } = renderHook(useInstrumentReviewAccess);
  await waitFor(() => expect(result.current).toBe(true));
  axios.get.mockRejectedValueOnce(new Error("Access denied"));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(result.current).toBe(false);
  expect(axios.get).toHaveBeenCalledTimes(2);
});

it("ignores an old permission result after a newer check and aborts on unmount", async () => {
  let resolveOld;
  axios.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const { result, unmount } = renderHook(useInstrumentReviewAccess);
  const firstSignal = axios.get.mock.calls[0][1].signal;
  axios.get.mockResolvedValueOnce({ data: { canValidate: false } });
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await act(async () => { resolveOld({ data: { canValidate: true } }); });
  expect(firstSignal.aborted).toBe(true);
  expect(result.current).toBe(false);
  const latestSignal = axios.get.mock.calls[1][1].signal;
  unmount();
  expect(latestSignal.aborted).toBe(true);
  window.dispatchEvent(new Event("focus"));
  expect(axios.get).toHaveBeenCalledTimes(2);
});
