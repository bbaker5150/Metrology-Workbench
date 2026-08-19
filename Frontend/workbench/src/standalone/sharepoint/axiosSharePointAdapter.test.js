import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSharePointAdapter } from "./axiosSharePointAdapter";
import { SharePointError } from "./spContext";

const API = "http://localhost:8000/api/uncertainty";

/** Stand-in for SharePointStore; the store itself has its own suite. */
function fakeStore(overrides = {}) {
  return {
    listSessions: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue({}),
    saveSession: vi.fn(async (doc) => doc),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    listRecords: vi.fn().mockResolvedValue([]),
    saveRecord: vi.fn(async (_k, r) => r),
    deleteRecord: vi.fn().mockResolvedValue(undefined),
    libraryFolder: vi.fn().mockResolvedValue("/sites/X/UncertaintySessions"),
    currentUser: vi.fn().mockResolvedValue({ id: 41, title: "Analyst One" }),
    listOwnedLibraryFileNames: vi.fn().mockResolvedValue([]),
    scopedImageFileName: vi.fn(async (sessionId, imageId) =>
      `image-41-${sessionId}-${imageId}.json`),
    rememberImageFile: vi.fn(),
    get: vi.fn().mockResolvedValue({ value: [] }),
    post: vi.fn().mockResolvedValue({}),
    webUrl: "https://t.example/sites/X",
    fetchImpl: vi.fn(),
    ...overrides,
  };
}

let store;
let fallback;
let adapter;

const call = (method, path, data) =>
  adapter({ method, url: `${API}${path}`, data: data === undefined ? undefined : JSON.stringify(data) });

beforeEach(() => {
  store = fakeStore();
  fallback = vi.fn().mockResolvedValue({ data: "from-network", status: 200 });
  adapter = createSharePointAdapter({ store, apiRoot: API, fallback });
});

describe("routing", () => {
  it("passes non-uncertainty requests to the real network adapter", async () => {
    const config = { method: "get", url: "https://example.com/other" };
    await adapter(config);
    expect(fallback).toHaveBeenCalledWith(config);
    expect(store.listSessions).not.toHaveBeenCalled();
  });

  it("does not reach the network for an uncertainty route", async () => {
    await call("get", "/sessions/");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("returns an axios-shaped response", async () => {
    const response = await call("get", "/instruments/");
    expect(response).toMatchObject({ status: 200, statusText: "OK", data: [] });
    expect(response.config).toBeTruthy();
  });

  it("rejects an unimplemented uncertainty route loudly instead of returning empty", async () => {
    await expect(call("get", "/something_new/")).rejects.toThrow(/No SharePoint handler for GET/);
  });

  it("marks the unimplemented-route failure as 501, not a network error", async () => {
    await expect(call("get", "/something_new/")).rejects.toMatchObject({
      isAxiosError: true,
      response: { status: 501 },
    });
  });
});

describe("session list hydration", () => {
  it("returns whole session documents, which is what the module expects", async () => {
    // loadData does replaceSessions(res.data) and then works from memory, so
    // summaries alone would leave the app with no test points.
    store.listSessions.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    store.getSession.mockImplementation(async (id) => ({ id, testPoints: [{ id: `tp-${id}` }] }));

    const { data } = await call("get", "/sessions/");
    expect(data).toEqual([
      { id: 1, testPoints: [{ id: "tp-1" }] },
      { id: 2, testPoints: [{ id: "tp-2" }] },
    ]);
  });

  it("preserves the newest-first order of the listing", async () => {
    store.listSessions.mockResolvedValue([{ id: 30 }, { id: 10 }, { id: 20 }]);
    store.getSession.mockImplementation(async (id) => ({ id }));
    const { data } = await call("get", "/sessions/");
    expect(data.map((s) => s.id)).toEqual([30, 10, 20]);
  });

  it("skips a session that cannot be read rather than failing the whole load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    store.listSessions.mockResolvedValue([{ id: 1, name: "good" }, { id: 2, name: "broken" }]);
    store.getSession.mockImplementation(async (id) => {
      if (id === 2) throw new SharePointError("corrupt", 200);
      return { id };
    });

    const { data } = await call("get", "/sessions/");
    expect(data).toEqual([{ id: 1 }]);
    expect(warn.mock.calls[0][0]).toContain("broken");
    warn.mockRestore();
  });

  it("bounds concurrency so a large site does not open one request per session", async () => {
    store.listSessions.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ id: i })));
    let active = 0;
    let peak = 0;
    store.getSession.mockImplementation(async (id) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active -= 1;
      return { id };
    });

    await call("get", "/sessions/");
    expect(peak).toBeLessThanOrEqual(6);
    expect(store.getSession).toHaveBeenCalledTimes(20);
  });

  it("returns an empty list for a site with no sessions", async () => {
    const { data } = await call("get", "/sessions/");
    expect(data).toEqual([]);
  });
});

describe("session writes", () => {
  it("saves the whole document on PUT", async () => {
    await call("put", "/sessions/42/", { id: 42, name: "Budget" });
    expect(store.saveSession).toHaveBeenCalledWith(expect.objectContaining({ id: 42, name: "Budget" }));
  });

  it("takes the id from the URL, so a mismatched body cannot write to the wrong file", async () => {
    await call("put", "/sessions/42/", { id: 999, name: "Budget" });
    expect(store.saveSession.mock.calls[0][0].id).toBe(42);
  });

  it("creates a session on POST", async () => {
    await call("post", "/sessions/", { id: 7, name: "New" });
    expect(store.saveSession).toHaveBeenCalledWith({ id: 7, name: "New" });
  });

  it("deletes a session", async () => {
    await call("delete", "/sessions/8/");
    expect(store.deleteSession).toHaveBeenCalledWith(8);
  });

  it("patches notes without the caller resending the whole document", async () => {
    store.getSession.mockResolvedValue({ id: 5, name: "S", notes: "old", testPoints: [1, 2] });
    await call("patch", "/sessions/5/notes/", { notes: "new text" });

    const saved = store.saveSession.mock.calls[0][0];
    expect(saved.notes).toBe("new text");
    // The rest of the document must survive a notes autosave.
    expect(saved.testPoints).toEqual([1, 2]);
  });

  it("treats missing notes as empty rather than writing undefined", async () => {
    store.getSession.mockResolvedValue({ id: 5 });
    await call("patch", "/sessions/5/notes/", {});
    expect(store.saveSession.mock.calls[0][0].notes).toBe("");
  });
});

describe("record routes", () => {
  it.each([
    ["instruments", "instruments"],
    ["equations", "equations"],
    ["bug_reports", "bugReports"],
  ])("lists %s from the matching container", async (route, key) => {
    await call("get", `/${route}/`);
    expect(store.listRecords).toHaveBeenCalledWith(key);
  });

  it.each([
    ["instruments", "instruments"],
    ["equations", "equations"],
    ["bug_reports", "bugReports"],
  ])("saves %s to the matching container", async (route, key) => {
    await call("post", `/${route}/`, { id: "x" });
    expect(store.saveRecord).toHaveBeenCalledWith(key, { id: "x" });
  });

  it.each([
    ["instruments", "instruments"],
    ["equations", "equations"],
    ["bug_reports", "bugReports"],
  ])("deletes %s from the matching container", async (route, key) => {
    await call("delete", `/${route}/abc/`);
    expect(store.deleteRecord).toHaveBeenCalledWith(key, "abc");
  });

  it("decodes an id that was percent-encoded into the path", async () => {
    await call("delete", "/instruments/a%2Fb/");
    expect(store.deleteRecord).toHaveBeenCalledWith("instruments", "a/b");
  });
});

describe("health probes", () => {
  it("answers the backend info probe instead of 404ing", async () => {
    const { data } = await call("get", "/info/");
    expect(data).toMatchObject({ backend: "sharepoint" });
  });

  it("reports SharePoint as the database", async () => {
    const { data } = await call("get", "/system_info/");
    expect(data.database).toBe("SharePoint lists");
  });
});

describe("error translation", () => {
  it("presents a storage failure the way axios would", async () => {
    store.listSessions.mockRejectedValue(new SharePointError("denied", 403));
    await expect(call("get", "/sessions/")).rejects.toMatchObject({
      isAxiosError: true,
      message: "denied",
      response: { status: 403 },
    });
  });

  it("defaults an unclassified failure to 500", async () => {
    store.listRecords.mockRejectedValue(new Error("boom"));
    await expect(call("get", "/instruments/")).rejects.toMatchObject({ response: { status: 500 } });
  });

  it("carries the message into response.data.detail where callers look", async () => {
    store.listRecords.mockRejectedValue(new SharePointError("no list", 404));
    await expect(call("get", "/equations/")).rejects.toMatchObject({
      response: { data: { detail: "no list" } },
    });
  });
});

describe("request bodies", () => {
  it("parses a JSON string body, which is how axios hands it over", async () => {
    await call("post", "/instruments/", { id: "i", nested: { a: 1 } });
    expect(store.saveRecord).toHaveBeenCalledWith("instruments", { id: "i", nested: { a: 1 } });
  });

  it("accepts an already-parsed object body", async () => {
    await adapter({ method: "post", url: `${API}/instruments/`, data: { id: "obj" } });
    expect(store.saveRecord).toHaveBeenCalledWith("instruments", { id: "obj" });
  });

  it("tolerates a request with no body", async () => {
    await expect(call("get", "/sessions/")).resolves.toBeTruthy();
  });

  it("defaults to GET when axios omits the method", async () => {
    await adapter({ url: `${API}/instruments/` });
    expect(store.listRecords).toHaveBeenCalledWith("instruments");
  });
});
