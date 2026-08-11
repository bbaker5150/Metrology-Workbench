import { beforeEach, describe, expect, it, vi } from "vitest";

// axios-retry mutates the global axios singleton at import time. Capture the
// config it is handed so we can assert the cold-boot resilience contract.
const axiosRetry = vi.hoisted(() => {
  const fn = vi.fn();
  fn.isNetworkOrIdempotentRequestError = vi.fn(() => false);
  return fn;
});

vi.mock("axios-retry", () => ({ default: axiosRetry }));

let apiClient;
let axios;
let config;

beforeEach(async () => {
  vi.resetModules();
  axiosRetry.mockClear();
  axiosRetry.isNetworkOrIdempotentRequestError.mockClear();
  axiosRetry.isNetworkOrIdempotentRequestError.mockReturnValue(false);

  axios = (await import("axios")).default;
  apiClient = (await import("./apiClient")).default;
  config = axiosRetry.mock.calls[0][1];
});

describe("apiClient", () => {
  it("re-exports the shared axios singleton so every module gets the same client", () => {
    expect(apiClient).toBe(axios);
  });

  it("configures retries on the singleton exactly once", () => {
    expect(axiosRetry).toHaveBeenCalledTimes(1);
    expect(axiosRetry.mock.calls[0][0]).toBe(axios);
  });

  it("allows enough attempts to cover the bundled backend's cold boot", () => {
    // The packaged backend exe takes ~21s to come up; 15 x 2s covers it.
    expect(config.retries).toBe(15);
    expect(config.retryDelay()).toBe(2000);
    expect(config.retries * config.retryDelay()).toBeGreaterThanOrEqual(21000);
  });
});

describe("retryCondition", () => {
  it("retries the network and idempotent errors axios-retry recognizes", () => {
    axiosRetry.isNetworkOrIdempotentRequestError.mockReturnValue(true);
    expect(config.retryCondition({})).toBe(true);
  });

  it("retries ERR_NETWORK, which is what the browser reports before the backend binds", () => {
    expect(config.retryCondition({ code: "ERR_NETWORK" })).toBe(true);
  });

  it("retries ECONNREFUSED", () => {
    expect(config.retryCondition({ code: "ECONNREFUSED" })).toBe(true);
  });

  it("does not retry an ordinary application error", () => {
    expect(config.retryCondition({ code: "ERR_BAD_REQUEST" })).toBe(false);
  });

  it("does not retry an error with no code at all", () => {
    expect(config.retryCondition({})).toBe(false);
  });
});
