import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SharePointStore,
  listTitle,
  fieldSchemaXml,
  CONTAINERS,
  FIELD_TYPE,
  sharePointInstrumentOwnerKey,
} from "./spStore";

import { resetWebUrlCache } from "./spContext";

const WEB = "https://t.example/sites/ISEA";
const FOLDER = "/sites/ISEA/UncertaintySessions";

const formValueObject = (call) =>
  Object.fromEntries(
    JSON.parse(call.body).formValues.map(({ FieldName, FieldValue }) => [
      FieldName,
      FieldValue,
    ]),
  );

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
  http.on(/ListItemAllFields\?\$select=Id/, { json: { Id: 91 } });
  store = new SharePointStore({
    webUrl: WEB,
    fetchImpl: http,
    currentUser: { id: 41, title: "Analyst One" },
  });
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
    const s = new SharePointStore({
      webUrl: `${WEB}/`,
      fetchImpl: http,
      currentUser: { id: 41 },
    });
    expect(s.webUrl).toBe(WEB);
  });
});

describe("fieldSchemaXml", () => {
  it("names a text column identically in all three name attributes it addresses it by", () => {
    const xml = fieldSchemaXml({ name: "RecordId", title: "Record Id", type: FIELD_TYPE.TEXT });
    expect(xml).toBe('<Field Type="Text" DisplayName="Record Id" Name="RecordId" StaticName="RecordId" />');
  });

  it("marks an indexed column", () => {
    const xml = fieldSchemaXml({ name: "SessionId", type: FIELD_TYPE.NUMBER, indexed: true });
    expect(xml).toContain('Type="Number"');
    expect(xml).toContain('Indexed="TRUE"');
  });

  it("does not try to index a Note column, which SharePoint will not do", () => {
    const xml = fieldSchemaXml({ name: "PayloadJson", type: FIELD_TYPE.NOTE, indexed: true, lines: 12 });
    expect(xml).not.toContain("Indexed");
    expect(xml).toContain('NumLines="12"');
    expect(xml).toContain('AppendOnly="FALSE"');
  });

  it("falls back to the internal name when there is no display name", () => {
    expect(fieldSchemaXml({ name: "Analyst", type: FIELD_TYPE.TEXT })).toContain('DisplayName="Analyst"');
  });

  it("escapes a display name so it cannot break out of the attribute", () => {
    const xml = fieldSchemaXml({ name: "X", title: 'A & B "C" <d>', type: FIELD_TYPE.TEXT });
    expect(xml).toContain('DisplayName="A &amp; B &quot;C&quot; &lt;d&gt;"');
    // One well-formed element, not two.
    expect(xml.match(/<Field/g)).toHaveLength(1);
  });

  it("refuses a field type it has no schema for rather than emitting broken XML", () => {
    expect(() => fieldSchemaXml({ name: "X", type: 999 })).toThrow(/No schema XML/);
  });

  it("covers every field type the containers actually use", () => {
    for (const field of CONTAINERS.flatMap((c) => c.fields)) {
      expect(() => fieldSchemaXml(field)).not.toThrow();
    }
  });
});

describe("provision", () => {
  const allMissing = () => http.on(/getbytitle\('[^']+'\)\?\$select=Id/, { status: 404 });
  const allPresent = () => http.on(/getbytitle\('[^']+'\)\?\$select=Id/, { json: { Id: "1" } });
  const createdFields = () => http
    .find(/createfieldasxml/)
    .map((c) => JSON.parse(c.body).parameters.SchemaXml);

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
    expect(createdFields()).toEqual(
      expect.arrayContaining([expect.stringContaining('Name="SessionId"'), expect.stringContaining('Name="PayloadJson"')]),
    );
  });

  it("creates columns as schema XML, which is the only form the Fields collection accepts", async () => {
    // The collection is polymorphic, so a plain JSON body with no OData type
    // annotation is rejected with a bare 400.
    allMissing();
    await store.provision();
    expect(http.find(/\/fields$/)).toHaveLength(0);

    const call = http.find(/createfieldasxml/)[0];
    expect(call.headers["Content-Type"]).toMatch(/odata=verbose/);
    expect(JSON.parse(call.body).parameters.__metadata.type).toBe("SP.XmlSchemaFieldCreationInformation");
  });

  it("indexes the columns the picker sorts and filters on", async () => {
    allMissing();
    await store.provision();
    const sessionId = createdFields().find((xml) => xml.includes('Name="SessionId"'));
    expect(sessionId).toContain('Type="Number"');
    expect(sessionId).toContain('Indexed="TRUE"');
  });

  it("creates Note columns as plain text, not rich text", async () => {
    allMissing();
    await store.provision();
    const payload = createdFields().find((xml) => xml.includes('Name="PayloadJson"'));
    expect(payload).toContain('Type="Note"');
    expect(payload).toContain('RichText="FALSE"');
  });

  it("gives every column its exact internal name rather than one derived from the title", async () => {
    allMissing();
    await store.provision();
    // Without the internal-name hint, "Session Id" becomes Session_x0020_Id.
    const sessionId = http
      .find(/createfieldasxml/)
      .map((c) => JSON.parse(c.body).parameters)
      .find((p) => p.SchemaXml.includes('Name="SessionId"'));
    expect(sessionId.SchemaXml).toContain('DisplayName="Session Id"');
    expect(sessionId.SchemaXml).toContain('StaticName="SessionId"');
    expect(sessionId.Options & 8).toBe(8);
  });

  it("puts the picker's columns in the default view and leaves the payload out", async () => {
    allMissing();
    await store.provision();
    const options = (name) => http
      .find(/createfieldasxml/)
      .map((c) => JSON.parse(c.body).parameters)
      .find((p) => p.SchemaXml.includes(`Name="${name}"`)).Options;
    expect(options("SessionName") & 16).toBe(16);
    expect(options("PayloadJson") & 16).toBe(0);
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

  it("creates each column in a single request", async () => {
    // Schema XML carries the display name and the view membership, so the
    // create-rename-addtoview sequence the JSON route needed is gone.
    allMissing();
    await store.provision();
    expect(http.find(/getbyinternalnameortitle/)).toHaveLength(0);
    expect(http.find(/addviewfield/)).toHaveLength(0);
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
    expect(http.find(/items\?/)[0].url).toContain("$filter=AuthorId eq 41");
  });

  it("skips rows with no session id rather than emitting NaN", async () => {
    http.on(/UncertaintySessions'\)\/items\?/, { json: { value: [{ SessionId: 1 }, { Title: "orphan" }] } });
    expect(await store.listSessions()).toHaveLength(1);
  });

  it("names an untitled session readably", async () => {
    http.on(/UncertaintySessions'\)\/items\?/, { json: { value: [{ SessionId: 1 }] } });
    expect((await store.listSessions())[0].name).toBe("Untitled session");
  });

  it("reads a session from its user-scoped deterministic file name", async () => {
    http.on(/\$value/, { text: JSON.stringify({ id: 42, name: "B" }) });
    expect(await store.getSession(42)).toEqual({ id: 42, name: "B" });
    expect(http.find(/\$value/)[0].url).toContain("session-41-42.json");
  });

  it("retains the existing filename for an owned legacy session", async () => {
    http.on(/UncertaintySessions'\)\/items\?/, {
      json: {
        value: [
          { SessionId: 42, SessionName: "Legacy", FileLeafRef: "session-42.json" },
        ],
      },
    });
    http.on(/\$value/, { text: JSON.stringify({ id: 42, name: "Legacy" }) });

    await store.listSessions();
    await store.getSession(42);

    expect(http.find(/\$value/)[0].url).toContain("session-42.json");
  });

  it("deduplicates a legacy and migrated file with the same per-user session id", async () => {
    http.on(/UncertaintySessions'\)\/items\?/, {
      json: {
        value: [
          { SessionId: 7, SessionName: "Newest", FileLeafRef: "session-41-7.json" },
          { SessionId: 7, SessionName: "Legacy", FileLeafRef: "session-7.json" },
        ],
      },
    });
    expect(await store.listSessions()).toEqual([
      expect.objectContaining({ id: 7, name: "Newest" }),
    ]);
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
    expect(upload.url).toContain("session-41-9.json");
    expect(JSON.parse(upload.body)).toEqual({ id: 9, name: "Cal" });
  });

  it("promotes picker columns with a regular form-update POST", async () => {
    await store.saveSession({ id: 9, name: "Cal", analyst: "BB", organization: "NPSL" });
    const update = http.find(/UncertaintySessions'\)\/items\(91\)\/ValidateUpdateListItem/)[0];
    expect(update.method).toBe("POST");
    expect(update.spMethod).toBeUndefined();
    expect(formValueObject(update)).toMatchObject({
      SessionId: "9",
      SessionName: "Cal",
      Analyst: "BB",
    });
  });

  it("does not repeat the metadata form update for an ordinary budget-only save", async () => {
    http.on(/UncertaintySessions'\)\/items\?/, {
      json: {
        value: [
          {
            SessionId: 9,
            SessionName: "Cal",
            Analyst: "BB",
            Organization: "NPSL",
            FileLeafRef: "session-41-9.json",
          },
        ],
      },
    });
    await store.listSessions();
    await store.saveSession({
      id: 9,
      name: "Cal",
      analyst: "BB",
      organization: "NPSL",
      testPoints: [{ id: "changed-budget" }],
    });

    expect(http.find(/ValidateUpdateListItem/)).toHaveLength(0);
    expect(http.find(/files\/add/)).toHaveLength(1);
  });

  it("updates picker metadata when the user renames an existing session", async () => {
    http.on(/UncertaintySessions'\)\/items\?/, {
      json: {
        value: [
          { SessionId: 9, SessionName: "Before", FileLeafRef: "session-41-9.json" },
        ],
      },
    });
    await store.listSessions();
    await store.saveSession({ id: 9, name: "After" });

    const updates = http.find(/UncertaintySessions'\)\/items\(91\)\/ValidateUpdateListItem/);
    expect(updates).toHaveLength(1);
    expect(updates[0].spMethod).toBeUndefined();
    expect(formValueObject(updates[0]).SessionName).toBe("After");
  });

  it("surfaces a field validation failure instead of silently accepting metadata", async () => {
    http.on(/UncertaintySessions'\)\/items\(91\)\/ValidateUpdateListItem/, {
      json: {
        value: [
          { FieldName: "SessionName", HasException: true, ErrorMessage: "Invalid title" },
        ],
      },
    });

    await expect(store.saveSession({ id: 9, name: "Cal" })).rejects.toThrow(
      /SessionName: Invalid title/,
    );
  });

  it("recycles rather than hard-deleting so a mistake is recoverable", async () => {
    await store.deleteSession(5);
    expect(http.find(/recycle/)[0].url).toContain("session-41-5.json");
  });

  it("uses the signed-in user's id in image filenames", async () => {
    expect(await store.scopedImageFileName(5, "img-a")).toBe(
      "image-41-5-img-a.json",
    );
  });
});

describe("record lists", () => {
  it("returns the parsed payloads", async () => {
    http.on(/UncertaintyInstruments'\)\/items\?\$select/, {
      json: { value: [{ Id: 1, RecordId: "i-1", PayloadJson: '{"id":"i-1","name":"5790A"}' }] },
    });
    expect(await store.listRecords("instruments")).toEqual([{ id: "i-1", name: "5790A" }]);
    expect(http.find(/UncertaintyInstruments/)[0].url).not.toContain("AuthorId");
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

  it("updates an existing row without a tunneled mutation method", async () => {
    http.on(/\$filter=RecordId/, { json: { value: [{ Id: 12 }] } });
    await store.saveRecord("instruments", { id: "i-9", name: "8508A" });
    const write = http.find(/items\(12\)\/ValidateUpdateListItem/)[0];
    expect(write.spMethod).toBeUndefined();
    expect(formValueObject(write).RecordId).toBe("i-9");
  });

  it("escapes quotes in an id so the OData filter cannot be broken", async () => {
    http.on(/\$filter=RecordId/, { json: { value: [] } });
    await store.deleteRecord("instruments", "o'brien");
    expect(http.find(/\$filter/)[0].url).toContain("o''brien");
  });

  it("treats deleting an absent record as a no-op", async () => {
    http.on(/\$filter=RecordId/, { json: { value: [] } });
    await store.deleteRecord("instruments", "ghost");
    expect(http.find(/recycle/)).toHaveLength(0);
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

describe("user-scoped instrument records", () => {
  it("uses a stable SharePoint user owner key", () => {
    expect(sharePointInstrumentOwnerKey({ id: 41 })).toBe("sharepoint-user:41");
  });

  it("returns shared instruments and only the signed-in user's local instruments", async () => {
    http.on(/UncertaintyInstruments'\)\/items\?\$select/, {
      json: {
        value: [
          { Id: 1, AuthorId: 99, RecordId: "shared", PayloadJson: '{"id":"shared","scope":"validated"}' },
          { Id: 2, AuthorId: 41, RecordId: "mine", PayloadJson: '{"id":"mine","scope":"local","owner":"old-browser"}' },
          { Id: 3, AuthorId: 99, RecordId: "theirs", PayloadJson: '{"id":"theirs","scope":"local","owner":"other-browser"}' },
          { Id: 4, AuthorId: 99, RecordId: "legacy", PayloadJson: '{"id":"legacy","model":"Legacy shared"}' },
        ],
      },
    });

    expect(await store.listInstruments()).toEqual([
      { id: "shared", scope: "validated" },
      { id: "mine", scope: "local", owner: "sharepoint-user:41" },
      { id: "legacy", model: "Legacy shared" },
    ]);
    expect(http.find(/UncertaintyInstruments/)[0].url).toContain("AuthorId");
  });

  it("creates a separate local row instead of overwriting another user's matching id", async () => {
    http.on(/\$filter=RecordId/, {
      json: {
        value: [
          { Id: 72, AuthorId: 99, RecordId: "same", PayloadJson: '{"id":"same","scope":"local"}' },
        ],
      },
    });

    const saved = await store.saveInstrument({
      id: "same",
      scope: "local",
      owner: "spoofed",
      model: "5790A",
      password: "must-not-persist",
    });

    const write = http.calls.filter((call) => /items$/.test(call.url)).pop();
    expect(write.spMethod).toBeUndefined();
    expect(saved.owner).toBe("sharepoint-user:41");
    expect(saved).not.toHaveProperty("password");
    expect(JSON.parse(JSON.parse(write.body).PayloadJson)).toEqual(saved);
  });

  it("updates only the signed-in user's existing local row", async () => {
    http.on(/\$filter=RecordId/, {
      json: {
        value: [
          { Id: 72, AuthorId: 99, RecordId: "same", PayloadJson: '{"id":"same","scope":"local"}' },
          { Id: 73, AuthorId: 41, RecordId: "same", PayloadJson: '{"id":"same","scope":"local"}' },
        ],
      },
    });

    await store.saveInstrument({ id: "same", scope: "local", model: "8508A" });
    expect(http.find(/items\(73\)\/ValidateUpdateListItem/)[0].spMethod).toBeUndefined();
    expect(http.find(/items\(72\)/)).toHaveLength(0);
  });

  it("syncs a shared definition and removes only this user's linked local copy", async () => {
    http.on(/\$filter=RecordId/, {
      json: {
        value: [
          { Id: 80, AuthorId: 12, RecordId: "shared", PayloadJson: '{"id":"shared","scope":"validated"}' },
        ],
      },
    });
    http.on(/UncertaintyInstruments'\)\/items\?\$select=Id,RecordId,PayloadJson,AuthorId&\$top/, {
      json: {
        value: [
          { Id: 80, AuthorId: 12, RecordId: "shared", PayloadJson: '{"id":"shared","scope":"validated"}' },
          { Id: 81, AuthorId: 41, RecordId: "my-copy", PayloadJson: '{"id":"my-copy","scope":"local","sourceId":"shared"}' },
          { Id: 82, AuthorId: 99, RecordId: "their-copy", PayloadJson: '{"id":"their-copy","scope":"local","sourceId":"shared"}' },
        ],
      },
    });

    const saved = await store.saveInstrument({
      id: "shared",
      sourceId: "shared",
      scope: "validated",
      password: "calibrate",
    });

    expect(http.find(/items\(80\)\/ValidateUpdateListItem/)[0].spMethod).toBeUndefined();
    expect(http.find(/items\(81\)\/recycle/)[0].spMethod).toBeUndefined();
    expect(http.find(/items\(82\)/)).toHaveLength(0);
    expect(saved).not.toHaveProperty("password");
  });

  it("does not delete another user's local instrument", async () => {
    http.on(/\$filter=RecordId/, {
      json: {
        value: [
          { Id: 72, AuthorId: 99, RecordId: "theirs", PayloadJson: '{"id":"theirs","scope":"local"}' },
        ],
      },
    });

    await store.deleteInstrument("theirs");
    expect(http.find(/recycle/)).toHaveLength(0);
  });

  it("deletes the signed-in user's local row without touching a matching foreign row", async () => {
    http.on(/\$filter=RecordId/, {
      json: {
        value: [
          { Id: 72, AuthorId: 99, RecordId: "same", PayloadJson: '{"id":"same","scope":"local"}' },
          { Id: 73, AuthorId: 41, RecordId: "same", PayloadJson: '{"id":"same","scope":"local"}' },
        ],
      },
    });

    await store.deleteInstrument("same");
    expect(http.find(/items\(73\)\/recycle/)[0].spMethod).toBeUndefined();
    expect(http.find(/items\(72\)/)).toHaveLength(0);
  });

  it("never uses mutation override headers for update or recycle operations", async () => {
    http.on(/\$filter=RecordId/, {
      json: {
        value: [
          { Id: 73, AuthorId: 41, RecordId: "same", PayloadJson: '{"id":"same","scope":"local"}' },
        ],
      },
    });

    await store.saveInstrument({ id: "same", scope: "local", model: "8508A" });
    await store.deleteInstrument("same");

    expect(http.calls.some((call) => call.spMethod === "MERGE")).toBe(false);
    expect(http.calls.some((call) => call.spMethod === "DELETE")).toBe(false);
  });
});
