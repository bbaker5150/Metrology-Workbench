import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveWebUrlFromPath,
  getCurrentUser,
  getFormDigest,
  resetWebUrlCache,
  resolveWebUrl,
  spGet,
  spPost,
  SharePointError,
  sharePointErrorMessage,
} from "./spContext";

const digestResponse = (value = "DIGEST-1", seconds = 1800) => ({
  ok: true,
  status: 200,
  text: async () =>
    JSON.stringify({ FormDigestValue: value, FormDigestTimeoutSeconds: seconds }),
  json: async () => ({ FormDigestValue: value, FormDigestTimeoutSeconds: seconds }),
});

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

beforeEach(() => {
  resetWebUrlCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("deriveWebUrlFromPath", () => {
  it("keeps the /sites/<name> managed path", () => {
    expect(deriveWebUrlFromPath("https://t.example", "/sites/ISEA/Assets/app.html")).toBe(
      "https://t.example/sites/ISEA",
    );
  });

  it("keeps the /teams/<name> managed path", () => {
    expect(deriveWebUrlFromPath("https://t.example", "/teams/Metrology/x/y.html")).toBe(
      "https://t.example/teams/Metrology",
    );
  });

  it("is case-insensitive about the managed path segment", () => {
    expect(deriveWebUrlFromPath("https://t.example", "/Sites/ISEA/a.html")).toBe(
      "https://t.example/Sites/ISEA",
    );
  });

  it("falls back to the tenant root for a root-site deployment", () => {
    expect(deriveWebUrlFromPath("https://t.example", "/Shared Documents/app.html")).toBe(
      "https://t.example",
    );
  });

  it("tolerates an empty path", () => {
    expect(deriveWebUrlFromPath("https://t.example", "")).toBe("https://t.example");
  });
});

describe("resolveWebUrl", () => {
  const win = (overrides = {}) => ({
    location: { origin: "https://t.example", pathname: "/sites/ISEA/a.html", search: "" },
    ...overrides,
  });

  it("prefers an explicit ?webUrl override", () => {
    expect(
      resolveWebUrl(
        win({
          location: {
            origin: "https://t.example",
            pathname: "/sites/ISEA/a.html",
            search: "?webUrl=https://t.example/sites/Other",
          },
        }),
      ),
    ).toBe("https://t.example/sites/Other");
  });

  it("uses _spPageContextInfo when injected into a SharePoint page", () => {
    expect(
      resolveWebUrl(win({ _spPageContextInfo: { webAbsoluteUrl: "https://t.example/sites/FromCtx" } })),
    ).toBe("https://t.example/sites/FromCtx");
  });

  it("reads the parent frame's context when iframed same-origin", () => {
    expect(
      resolveWebUrl(
        win({ parent: { _spPageContextInfo: { webAbsoluteUrl: "https://t.example/sites/Parent" } } }),
      ),
    ).toBe("https://t.example/sites/Parent");
  });

  it("does not blow up when the parent frame is cross-origin", () => {
    const hostile = win();
    Object.defineProperty(hostile, "parent", {
      get() {
        throw new Error("Blocked a frame with origin ...");
      },
    });
    expect(resolveWebUrl(hostile)).toBe("https://t.example/sites/ISEA");
  });

  it("falls back to deriving from its own path", () => {
    expect(resolveWebUrl(win())).toBe("https://t.example/sites/ISEA");
  });

  it("strips a trailing slash so paths concatenate cleanly", () => {
    expect(
      resolveWebUrl(win({ _spPageContextInfo: { webAbsoluteUrl: "https://t.example/sites/X/" } })),
    ).toBe("https://t.example/sites/X");
  });

  it("caches the result so discovery runs once", () => {
    const w = win();
    const first = resolveWebUrl(w);
    w.location.pathname = "/sites/Changed/a.html";
    expect(resolveWebUrl(w)).toBe(first);
  });
});

describe("getCurrentUser", () => {
  it("uses SharePoint's authenticated Microsoft 365 identity", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        Id: 41,
        LoginName: "i:0#.f|membership|analyst@example.com",
        Email: "analyst@example.com",
        Title: "Analyst One",
      }),
    );

    await expect(getCurrentUser("https://t.example/sites/X", fetchImpl)).resolves.toEqual({
      id: 41,
      loginName: "i:0#.f|membership|analyst@example.com",
      email: "analyst@example.com",
      title: "Analyst One",
    });
    expect(fetchImpl.mock.calls[0][0]).toContain("/_api/web/currentuser");
    expect(fetchImpl.mock.calls[0][1].credentials).toBe("include");
  });

  it("caches the identity for the page lifetime", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ Id: 9, Title: "A" }));
    await getCurrentUser("https://t.example/sites/X", fetchImpl);
    await getCurrentUser("https://t.example/sites/X", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails clearly instead of treating a sign-in page as an empty workspace", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    await expect(getCurrentUser("https://t.example/sites/X", fetchImpl)).rejects.toThrow(
      /signed-in user/,
    );
  });
});

describe("getFormDigest", () => {
  it("POSTs to contextinfo with credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(digestResponse());
    await getFormDigest("https://t.example/sites/X", fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://t.example/sites/X/_api/contextinfo");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
  });

  it("returns the digest value", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(digestResponse("ABC"));
    expect(await getFormDigest("https://t.example", fetchImpl)).toBe("ABC");
  });

  it("reuses a cached digest rather than refetching on every write", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(digestResponse());
    await getFormDigest("https://t.example", fetchImpl);
    await getFormDigest("https://t.example", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refetches once the server-reported expiry passes", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue(digestResponse("D1", 1800));
    await getFormDigest("https://t.example", fetchImpl);

    // The tool sits open for hours; a digest cached for the page lifetime
    // would start failing every write after 30 minutes.
    vi.advanceTimersByTime(1800 * 1000);
    await getFormDigest("https://t.example", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refreshes early enough that a slow request cannot straddle expiry", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue(digestResponse("D1", 1800));
    await getFormDigest("https://t.example", fetchImpl);

    vi.advanceTimersByTime(1739 * 1000); // one second inside the safety margin
    await getFormDigest("https://t.example", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2 * 1000);
    await getFormDigest("https://t.example", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refetches when the web URL changes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(digestResponse());
    await getFormDigest("https://t.example/sites/A", fetchImpl);
    await getFormDigest("https://t.example/sites/B", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("explains a failure in terms of sign-in and hosting", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 403));
    await expect(getFormDigest("https://t.example", fetchImpl)).rejects.toThrow(
      /signed out, or this page may not be hosted inside the SharePoint site/,
    );
  });

  it("accepts the verbose OData envelope some tenants return", async () => {
    const body = {
      d: { GetContextWebInformation: { FormDigestValue: "V", FormDigestTimeoutSeconds: 900 } },
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    expect(await getFormDigest("https://t.example", fetchImpl)).toBe("V");
  });
});

describe("spGet", () => {
  it("sends credentials so SharePoint sees the signed-in user", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ value: [] }));
    await spGet("https://t.example", "/_api/web", fetchImpl);
    expect(fetchImpl.mock.calls[0][1].credentials).toBe("include");
  });

  it("parses the JSON body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ value: [1, 2] }));
    expect(await spGet("https://t.example", "/_api/x", fetchImpl)).toEqual({ value: [1, 2] });
  });

  it("turns 403 into a message naming the permission needed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 403));
    await expect(spGet("https://t.example", "/_api/x", fetchImpl)).rejects.toThrow(
      /need Edit permission on this site/,
    );
  });

  it("turns 404 into a message pointing at setup", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    await expect(spGet("https://t.example", "/_api/x", fetchImpl)).rejects.toThrow(
      /lists may not have been created yet/,
    );
  });

  it("turns 401 into a reload instruction", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    await expect(spGet("https://t.example", "/_api/x", fetchImpl)).rejects.toThrow(/Reload the page/);
  });

  it("carries the status on the error for callers that branch on it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    await expect(spGet("https://t.example", "/_api/x", fetchImpl)).rejects.toMatchObject({
      name: "SharePointError",
      status: 404,
    });
  });
});

describe("spPost", () => {
  const withDigest = (responses) => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(digestResponse());
    responses.forEach((r) => fetchImpl.mockResolvedValueOnce(r));
    return fetchImpl;
  };

  it("attaches the form digest, which SharePoint requires for writes", async () => {
    const fetchImpl = withDigest([jsonResponse({})]);
    await spPost("https://t.example", "/_api/web/lists", { body: { Title: "X" } }, fetchImpl);
    expect(fetchImpl.mock.calls[1][1].headers["X-RequestDigest"]).toBe("DIGEST-1");
  });

  it("serializes a JSON body", async () => {
    const fetchImpl = withDigest([jsonResponse({})]);
    await spPost("https://t.example", "/_api/x", { body: { a: 1 } }, fetchImpl);
    expect(fetchImpl.mock.calls[1][1].body).toBe('{"a":1}');
  });

  it("passes a raw body through untouched, for file uploads", async () => {
    const fetchImpl = withDigest([jsonResponse({})]);
    await spPost("https://t.example", "/_api/x", { raw: true, body: "already-a-string" }, fetchImpl);
    expect(fetchImpl.mock.calls[1][1].body).toBe("already-a-string");
  });

  it("tunnels MERGE through POST as SharePoint expects", async () => {
    const fetchImpl = withDigest([jsonResponse({}, 204)]);
    await spPost("https://t.example", "/_api/x", { method: "MERGE", body: {} }, fetchImpl);
    const headers = fetchImpl.mock.calls[1][1].headers;
    expect(fetchImpl.mock.calls[1][1].method).toBe("POST");
    expect(headers["X-HTTP-Method"]).toBe("MERGE");
    expect(headers["IF-MATCH"]).toBe("*");
  });

  it("tunnels DELETE the same way", async () => {
    const fetchImpl = withDigest([jsonResponse({}, 200)]);
    await spPost("https://t.example", "/_api/x", { method: "DELETE" }, fetchImpl);
    expect(fetchImpl.mock.calls[1][1].headers["X-HTTP-Method"]).toBe("DELETE");
  });

  it("treats 204 No Content as success", async () => {
    const fetchImpl = withDigest([{ ok: true, status: 204, text: async () => "", json: async () => ({}) }]);
    await expect(spPost("https://t.example", "/_api/x", { body: {} }, fetchImpl)).resolves.toEqual({});
  });

  it("surfaces the response body as error detail", async () => {
    const fetchImpl = withDigest([
      { ok: false, status: 400, text: async () => "Invalid column", json: async () => ({}) },
    ]);
    await expect(spPost("https://t.example", "/_api/x", { body: {} }, fetchImpl)).rejects.toMatchObject({
      detail: "Invalid column",
    });
  });

  it("puts SharePoint's own explanation in the message, not just the status", async () => {
    // A bare "failed (HTTP 400)" sends someone reading network traces for the
    // sentence that was already in the response body.
    const body = JSON.stringify({
      error: { code: "-1, System.ArgumentException", message: { lang: "en-US", value: "A duplicate field name was found." } },
    });
    const fetchImpl = withDigest([{ ok: false, status: 400, text: async () => body, json: async () => JSON.parse(body) }]);
    await expect(spPost("https://t.example", "/_api/x", { body: {} }, fetchImpl)).rejects.toThrow(
      /A duplicate field name was found\./,
    );
  });

  it("sends the verbose OData content type when asked", async () => {
    const fetchImpl = withDigest([jsonResponse({}, 200)]);
    await spPost("https://t.example", "/_api/x", { body: {}, verbose: true }, fetchImpl);
    const headers = fetchImpl.mock.calls[1][1].headers;
    expect(headers["Content-Type"]).toBe("application/json;odata=verbose");
    expect(headers.Accept).toBe("application/json;odata=verbose");
  });

  it("uses the lean content type otherwise", async () => {
    const fetchImpl = withDigest([jsonResponse({}, 200)]);
    await spPost("https://t.example", "/_api/x", { body: {} }, fetchImpl);
    expect(fetchImpl.mock.calls[1][1].headers["Content-Type"]).toBe("application/json;odata=nometadata");
  });
});

describe("sharePointErrorMessage", () => {
  it("reads the verbose error shape", () => {
    const body = JSON.stringify({ error: { message: { lang: "en-US", value: "Column limit exceeded." } } });
    expect(sharePointErrorMessage(body)).toBe("Column limit exceeded.");
  });

  it("reads the lean error shape, where the message is a plain string", () => {
    expect(sharePointErrorMessage(JSON.stringify({ error: { message: "List does not exist." } }))).toBe(
      "List does not exist.",
    );
  });

  it("reads the odata.error shape", () => {
    const body = JSON.stringify({ "odata.error": { code: "-1", message: { value: "Access denied." } } });
    expect(sharePointErrorMessage(body)).toBe("Access denied.");
  });

  it("returns nothing for an empty body", () => {
    expect(sharePointErrorMessage("")).toBe("");
    expect(sharePointErrorMessage(undefined)).toBe("");
  });

  it("returns nothing for an HTML page, which is a sign-in redirect rather than an explanation", () => {
    expect(sharePointErrorMessage("<!doctype html><html><body>Sign in</body></html>")).toBe("");
  });

  it("passes through a short plain-text body", () => {
    expect(sharePointErrorMessage("  Bad Request  ")).toBe("Bad Request");
  });

  it("truncates a long plain-text body rather than filling the panel", () => {
    expect(sharePointErrorMessage("x".repeat(1000))).toHaveLength(300);
  });

  it("returns nothing when the JSON has no error in it", () => {
    expect(sharePointErrorMessage(JSON.stringify({ value: [] }))).toBe("");
  });
});

describe("SharePointError", () => {
  it("keeps instanceof working after transpilation", () => {
    expect(new SharePointError("x", 404)).toBeInstanceOf(SharePointError);
    expect(new SharePointError("x", 404)).toBeInstanceOf(Error);
  });
});
