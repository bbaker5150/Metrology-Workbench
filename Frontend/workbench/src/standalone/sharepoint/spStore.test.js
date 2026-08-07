import { beforeEach, describe, expect, it, vi } from "vitest";
import { SharePointStore, listTitle, CONTAINERS, FIELD_TYPE } from "./spStore";
import { resetWebUrlCache } from "./spContext";

const WEB = "https://t.example/sites/ISEA";
const FOLDER = "/sites/ISEA/UncertaintySessions";

/**
 * Fetch double. Handlers are matched newest-first against "METHOD url" so a
 * test can override a default set up by the helper.
 */
function fakeFetch() {
  const handlers = [];
  const calls = [];

  const impl = vi.fn(async (url, init = {}) => {
    const method = init.method || "GET";
    const spMethod = init.headers?.["X-HTTP-Method"];
    calls.push({ url, method, spMethod, body: init.body, headers: init.headers || {} });

    for (const [pattern, respond] of handlers) {
      if (pattern.test(url)) {
        const r = typeof respond === "function" ? respond({ url, method, spMethod, init }) : respond;
        const status = r.status ?? 200;
        const text = r.text ?? (r.json !== undefined ? JSON.stringify(r.json) : "");
        return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text || "{}") };
      }
    }
    return { ok: true, status: 200, text: async () => '{"value":[]}', json: async () => ({ value: [] }) };
  });

  impl.on = (pattern, respond) => {
    handlers.unshift([pattern, respond]);
    return impl;
  };
  impl.calls = calls;
  impl.find = (re) => calls.filter((c) => re.test(c.url));
  return impl;
}

let http;
let store;

beforeEach(() => {
  resetWebUrlCache();
  http = fakeFetch();
  http.on(/contextinfo/, { json: { FormDigestValue: "D", FormDigestTimeoutSeconds: 1800 } });
  http.on(/RootFolder/, { json: { ServerRelativeUrl: FOLDER } });
  store = new SharePointStore({ webUrl: WEB, fetchImpl: http });
});

describe("listTitle", () => {
  it("composes the title from the prefix", () => {
    expect(listTitle("Uncertainty", "sessions")).toBe("UncertaintySessions");
    expect(listTitle("LabB", "instruments")).toBe("LabBInstruments");
  });

  it("strips characters SharePoint rejects in a title", () => {
    expect(listTitle("Lab B/2!", "sessions")).toBe("LabB2Sessions");
  });

  it("falls back to a default for an empty or all-punctuation prefix", () => {
    expect(listTitle("", "sessions")).toBe("UncertaintySessions");
    expect(listTitle("///", "sessions")).toBe("UncertaintySessions");
  });

  it("rejects an unknown container rather than composing a bad title", () => {
    expect(() => listTitle("X", "nope")).toThrow(/Unknown container/);
  });

  it("trims the web URL's trailing slash so paths concatenate cleanly", () => {
    const s = new SharePointStore({ webUrl: `${WEB}/`, fetchImpl: http });
    expect(s.webUrl).toBe(WEB);
  });
});

describe("provision", () => {
  const allMissing = () => http.on(/getbytitle\('[^']+'\)\?\$select=Id/, { status: 404 });
  const allPresent = () => http.on(/getbytitle\('[^']+'\)\?\$select=Id/, { json: { Id: "1" } });

  it("creates every container when the site is empty", async () => {
    allMissing();
    const result = await store.provision();
    const created = result.steps.filter((s) => s.action === "created").map((s) => s.container);
    expect(created).toEqual([
      "UncertaintySessions",
      "UncertaintyInstruments",
      "UncertaintyEquations",
      "UncertaintyBugReports",
    ]);
  });

  it("creates the sessions container as a document library", async () => {
    allMissing();
    await store.provision();
    const create = http.find(/\/_api\/web\/lists$/)[0];
    expect(JSON.parse(create.body)).toMatchObject({ Title: "UncertaintySessions", BaseTemplate: 101 });
  });

  it("creates the record containers as generic lists", async () => {
    allMissing();
    await store.provision();
    const bodies = http.find(/\/_api\/web\/lists$/).map((c) => JSON.parse(c.body));
    expect(bodies.find((b) => b.Title === "UncertaintyInstruments").BaseTemplate).toBe(100);
  });

  it("adds the schema's columns to a newly created container", async () => {
    allMissing();
    await store.provision();
    const fieldNames = http
      .find(/\/fields$/)
      .map((c) => JSON.parse(c.body).Title);
    expect(fieldNames).toContain("SessionId");
    expect(fieldNames).toContain("PayloadJson");
  });

  it("indexes the columns the picker sorts and filters on", async () => {
    allMissing();
    await store.provision();
    const sessionId = http.find(/\/fields$/).map((c) => JSON.parse(c.body)).find((b) => b.Title === "SessionId");
    expect(sessionId.Indexed).toBe(true);
    expect(sessionId.FieldTypeKind).toBe(FIELD_TYPE.NUMBER);
  });

  it("creates Note columns as plain text, not rich text", async () => {
    allMissing();
    await store.provision();
    const payload = http.find(/\/fields$/).map((c) => JSON.parse(c.body)).find((b) => b.Title === "PayloadJson");
    expect(payload).toMatchObject({ FieldTypeKind: FIELD_TYPE.NOTE, RichText: false });
  });

  it("leaves an existing container completely alone", async () => {
    allPresent();
    http.on(/\/fields\?\$select=InternalName/, {
      json: { value: CONTAINERS.flatMap((c) => c.fields).map((f) => ({ InternalName: f.name })) },
    });
    const result = await store.provision();
    expect(result.alreadyProvisioned).toBe(true);
    expect(http.find(/\/_api\/web\/lists$/)).toHaveLength(0);
  });

  it("adds only the missing column when a container is partially set up", async () => {
    allPresent();
    http.on(/\/fields\?\$select=InternalName/, { json: { value: [{ InternalName: "SessionId" }] } });
    const result = await store.provision();
    const added = result.steps.filter((s) => s.action === "field-added").map((s) => s.field);
    expect(added).toContain("SessionName");
    expect(added).not.toContain("SessionId");
  });

  it("renames a column to its display name after creation", async () => {
    allMissing();
    await store.provision();
    const rename = http.find(/getbyinternalnameortitle\('SessionId'\)/)[0];
    expect(rename.spMethod).toBe("MERGE");
    expect(JSON.parse(rename.body)).toEqual({ Title: "Session Id" });
  });

  it("does not abort when a column cannot be added to the default view", async () => {
    allMissing();
    http.on(/addviewfield/, { status: 500 });
    await expect(store.provision()).resolves.toBeTruthy();
  });

  it("propagates a permission failure rather than reporting success", async () => {
    allMissing();
    http.on(/\/_api\/web\/lists$/, { status: 403 });
    await expect(store.provision()).rejects.toThrow(/Edit permission/);
  });
});

describe("sessions", () => {
  it("lists sessions newest-first without reading payloads", async () => {
    http.on(/UncertaintySessions'\)\/items\?/, {
      json: { value: [{ SessionId: 7, SessionName: "Shunt", Analyst: "BB", Modified: "2026-05-01" }] },
    });
    const sessions = await store.listSessions();
    expect(sessions).toEqual([
      expect.objectContaining({ id: 7, name: "Shunt", analyst: "BB", updated_at: "2026-05-01" }),
    ]);
    expect(http.find(/items\?/)[0].url).toContain("$orderby=Modified desc");
  });

  it("skips rows with no session id rather than emitting NaN", async () => {
    http.on(/UncertaintySessions'\)\/items\?/, { json: { value: [{ SessionId: 1 }, { Title: "orphan" }] } });
    expect(await store.listSessions()).toHaveLength(1);
  });

  it("names an untitled session readably", async () => {
    http.on(/UncertaintySessions'\)\/items\?/, { json: { value: [{ SessionId: 1 }] } });
    expect((await store.listSessions())[0].name).toBe("Untitled session");
  });

  it("reads a session from its deterministic file name", async () => {
    http.on(/\$value/, { text: JSON.stringify({ id: 42, name: "B" }) });
    expect(await store.getSession(42)).toEqual({ id: 42, name: "B" });
    expect(http.find(/\$value/)[0].url).toContain("session-42.json");
  });

  it("reports a corrupt session rather than throwing a raw JSON error", async () => {
    http.on(/\$value/, { text: "{oops" });
    await expect(store.getSession(42)).rejects.toThrow(/not valid JSON and may be corrupt/);
  });

  it("resolves the library folder only once", async () => {
    http.on(/\$value/, { text: "{}" });
    await store.getSession(1);
    await store.getSession(2);
    expect(http.find(/RootFolder/)).toHaveLength(1);
  });

  it("overwrites the session file with the document itself", async () => {
    await store.saveSession({ id: 9, name: "Cal" });
    const upload = http.find(/files\/add/)[0];
    expect(upload.url).toContain("overwrite=true");
    expect(JSON.parse(upload.body)).toEqual({ id: 9, name: "Cal" });
  });

  it("promotes the picker's columns onto the file's list item", async () => {
    await store.saveSession({ id: 9, name: "Cal", analyst: "BB", organization: "NPSL" });
    const merge = http.find(/ListItemAllFields/)[0];
    expect(merge.spMethod).toBe("MERGE");
    expect(JSON.parse(merge.body)).toMatchObject({ SessionId: 9, SessionName: "Cal", Analyst: "BB" });
  });

  it("recycles rather than hard-deleting so a mistake is recoverable", async () => {
    await store.deleteSession(5);
    expect(http.find(/recycle/)[0].url).toContain("session-5.json");
  });
});

describe("record lists", () => {
  it("returns the parsed payloads", async () => {
    http.on(/UncertaintyInstruments'\)\/items\?\$select/, {
      json: { value: [{ Id: 1, RecordId: "i-1", PayloadJson: '{"id":"i-1","name":"5790A"}' }] },
    });
    expect(await store.listRecords("instruments")).toEqual([{ id: "i-1", name: "5790A" }]);
  });

  it("drops one unreadable row instead of failing the whole list", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    http.on(/UncertaintyInstruments'\)\/items\?\$select/, {
      json: { value: [{ RecordId: "ok", PayloadJson: '{"id":"ok"}' }, { RecordId: "bad", PayloadJson: "{" }] },
    });
    expect(await store.listRecords("instruments")).toEqual([{ id: "ok" }]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("creates a row when the record id is new", async () => {
    http.on(/\$filter=RecordId/, { json: { value: [] } });
    await store.saveRecord("instruments", { id: "i-9", name: "8508A" });
    const write = http.calls.filter((c) => /items$/.test(c.url)).pop();
    expect(write.spMethod).toBeUndefined();
    expect(JSON.parse(JSON.parse(write.body).PayloadJson)).toEqual({ id: "i-9", name: "8508A" });
  });

  it("merges into the existing row when the record id is already present", async () => {
    http.on(/\$filter=RecordId/, { json: { value: [{ Id: 12 }] } });
    await store.saveRecord("instruments", { id: "i-9", name: "8508A" });
    const write = http.calls.filter((c) => /items\(12\)/.test(c.url)).pop();
    expect(write.spMethod).toBe("MERGE");
  });

  it("escapes quotes in an id so the OData filter cannot be broken", async () => {
    http.on(/\$filter=RecordId/, { json: { value: [] } });
    await store.deleteRecord("instruments", "o'brien");
    expect(http.find(/\$filter/)[0].url).toContain("o''brien");
  });

  it("treats deleting an absent record as a no-op", async () => {
    http.on(/\$filter=RecordId/, { json: { value: [] } });
    await store.deleteRecord("instruments", "ghost");
    expect(http.calls.filter((c) => c.spMethod === "DELETE")).toHaveLength(0);
  });

  it("refuses to save a record with no id rather than creating an orphan", async () => {
    await expect(store.saveRecord("instruments", { name: "no id" })).rejects.toThrow(/no id/);
  });

  it("accepts the alternate id fields the module uses for reports and equations", async () => {
    http.on(/\$filter=RecordId/, { json: { value: [] } });
    await store.saveRecord("bugReports", { report_id: "r-1", title: "Broken" });
    expect(http.find(/\$filter/)[0].url).toContain("r-1");
  });
});
