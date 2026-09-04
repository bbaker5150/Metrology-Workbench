import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config.js derives its URLs once at module-evaluation time, so every case
// resets the module registry and re-imports after stubbing the environment.
const loadConfig = async ({ hostname = "localhost", protocol = "http:", host, ...env } = {}) => {
  vi.resetModules();
  vi.stubGlobal("location", {
    hostname,
    protocol,
    host: host ?? `${hostname}:3000`,
  });
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  return import("./config");
};

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("baseIp derivation", () => {
  it("follows the page origin so a remote observer reaches the same host", async () => {
    const { baseIp, API_BASE_URL, WS_BASE_URL } = await loadConfig({ hostname: "10.20.30.40" });
    expect(baseIp).toBe("10.20.30.40");
    expect(API_BASE_URL).toBe("http://10.20.30.40:8000/api");
    expect(WS_BASE_URL).toBe("ws://10.20.30.40:8000/ws");
  });

  it("falls back to localhost for an explicit localhost origin", async () => {
    const { baseIp } = await loadConfig({ hostname: "localhost" });
    expect(baseIp).toBe("localhost");
  });

  it("falls back to localhost for a 127.0.0.1 origin", async () => {
    const { baseIp } = await loadConfig({ hostname: "127.0.0.1" });
    expect(baseIp).toBe("localhost");
  });

  it("falls back to localhost for Electron's empty file:// hostname", async () => {
    const { baseIp } = await loadConfig({ hostname: "", protocol: "file:", host: "" });
    expect(baseIp).toBe("localhost");
  });
});

describe("backend port", () => {
  it("defaults to 8000", async () => {
    const { BACKEND_PORT, API_BASE_URL } = await loadConfig({ hostname: "localhost" });
    expect(BACKEND_PORT).toBe("8000");
    expect(API_BASE_URL).toBe("http://localhost:8000/api");
  });

  it("honors VITE_BACKEND_PORT for the remote/tunnel profiles", async () => {
    const { BACKEND_PORT, API_BASE_URL, WS_BASE_URL } = await loadConfig({
      hostname: "localhost",
      VITE_BACKEND_PORT: "8100",
    });
    expect(BACKEND_PORT).toBe("8100");
    expect(API_BASE_URL).toBe("http://localhost:8100/api");
    expect(WS_BASE_URL).toBe("ws://localhost:8100/ws");
  });
});

describe("same-origin API mode", () => {
  it("is off unless VITE_API_SAME_ORIGIN is exactly \"1\"", async () => {
    const { USE_SAME_ORIGIN_API } = await loadConfig({
      hostname: "localhost",
      VITE_API_SAME_ORIGIN: "true",
    });
    expect(USE_SAME_ORIGIN_API).toBe(false);
  });

  it("collapses the API to a relative /api root when enabled", async () => {
    const { USE_SAME_ORIGIN_API, API_BASE_URL } = await loadConfig({
      hostname: "tunnel.trycloudflare.com",
      VITE_API_SAME_ORIGIN: "1",
    });
    expect(USE_SAME_ORIGIN_API).toBe(true);
    expect(API_BASE_URL).toBe("/api");
  });

  it("uses ws:// against the page host over plain http", async () => {
    const { WS_BASE_URL } = await loadConfig({
      hostname: "tunnel.example.com",
      protocol: "http:",
      host: "tunnel.example.com",
      VITE_API_SAME_ORIGIN: "1",
    });
    expect(WS_BASE_URL).toBe("ws://tunnel.example.com/ws");
  });

  it("upgrades to wss:// when the page itself is served over https", async () => {
    const { WS_BASE_URL } = await loadConfig({
      hostname: "tunnel.trycloudflare.com",
      protocol: "https:",
      host: "tunnel.trycloudflare.com",
      VITE_API_SAME_ORIGIN: "1",
    });
    expect(WS_BASE_URL).toBe("wss://tunnel.trycloudflare.com/ws");
  });

  it("keeps the port in the ws host when the page is served on a non-default port", async () => {
    const { WS_BASE_URL } = await loadConfig({
      hostname: "10.0.0.5",
      protocol: "http:",
      host: "10.0.0.5:3100",
      VITE_API_SAME_ORIGIN: "1",
    });
    expect(WS_BASE_URL).toBe("ws://10.0.0.5:3100/ws");
  });
});
