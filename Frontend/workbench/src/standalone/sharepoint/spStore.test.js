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
import { computeSyncState, buildValidatedSnapshot } from '../../modules/uncertainty/utils/instrumentSync';

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
        const r = await (typeof respond === "function" ? respond({ url, method, spMethod, init }) : respond);
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
let draftRows;

beforeEach(() => {
  resetWebUrlCache();
  http = fakeFetch();
  draftRows = [];
  http.on(/InstrumentDrafts'\)\/items\?/, ({url}) => {
    const id = /RecordId eq '([^']+)'/.exec(url)?.[1];
    return {json:{value:draftRows.filter(row => !id || row.RecordId === id)}};
  });
  http.on(/InstrumentDrafts'\)\/items$/, ({init}) => {
    const item = {Id:100 + draftRows.length, AuthorId:41, owshiddenversion:1, ...JSON.parse(init.body)};
    draftRows.push(item);
    return {status:201,json:item};
  });
  http.on(/InstrumentDrafts'\)\/items\((\d+)\)\?/, ({url}) => {
    const item = draftRows.find(row => row.Id === Number(/items\((\d+)\)/.exec(url)[1]));
    return item ? {json:item} : {status:404};
  });
  http.on(/InstrumentDrafts'\)\/items\((\d+)\)$/, ({url,init}) => {
    const item = draftRows.find(row => row.Id === Number(/items\((\d+)\)/.exec(url)[1]));
    if (!item) return {status:404};
    if (init.headers['IF-MATCH'] !== `"${item.owshiddenversion}"`) return {status:412};
    Object.assign(item, JSON.parse(init.body));
    item.owshiddenversion++;
    return {status:204};
  });
  http.on(/InstrumentDrafts'\)\/items\((\d+)\)\/ValidateUpdateListItem/, ({url,init}) => {
    const item = draftRows.find(row => row.Id === Number(/items\((\d+)\)/.exec(url)[1]));
    if (item) {
      Object.assign(item, formValueObject({body:init.body}));
      item.owshiddenversion++;
    }
    return {json:{value:[]}};
  });
  http.on(/InstrumentDrafts.*ReadSecurity/, { json: { ReadSecurity: 2, WriteSecurity: 2 } });
  http.on(/Instrument%20Drafts.*ReadSecurity/, { json: { ReadSecurity: 2, WriteSecurity: 2 } });
  http.on(/Instruments.*ReadSecurity/, { json: { ReadSecurity: 2, WriteSecurity: 4 } });
  http.on(/Published(?:%20)?Instruments.*ReadSecurity/, { json: { ReadSecurity: 1, WriteSecurity: 4 } });
  http.on(/EffectiveBasePermissions/, { json: { Low: '2048' } });
  http.on(/Published(?:%20)?Instruments.*fields\?/, { json: { value: [{InternalName:'LegacyCatalogMigratedV1'}] } });
  http.on(/Instrument(?:%20)?Drafts.*fields\?/, { json: { value: [{InternalName:'SubmittedJson'}] } });
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
      "UncertaintyInstrumentDrafts",
      "UncertaintyPublishedInstruments",
    ]);
  });

  it("creates the sessions container as a document library", async () => {
    allMissing();
    await store.provision();
    const create = http.find(/\/_api\/web\/lists$/)[0];
    expect(JSON.parse(create.body)).toMatchObject({ Title: "Uncertalytics - Sessions", BaseTemplate: 101, Hidden: false });
  });

  it("creates the record containers as generic lists", async () => {
    allMissing();
    await store.provision();
    const bodies = http.find(/\/_api\/web\/lists$/).map((c) => JSON.parse(c.body));
    expect(bodies.find((b) => b.Title === "Uncertalytics - Instruments").BaseTemplate).toBe(100);
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
      json: { value: [...CONTAINERS.flatMap((c) => c.fields).map((f) => ({ InternalName: f.name })), { InternalName: 'LegacyCatalogMigratedV1' }] },
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

  it('resumes partial setup with an ordinary indexed draft key and a native unique public key', async () => {
    allPresent();
    const draftFields = new Set();
    let interrupt = true;
    http.on(/InstrumentDrafts.*fields\?/, () => ({json:{value:[...draftFields].map(InternalName => ({InternalName}))}}));
    http.on(/InstrumentDrafts.*createfieldasxml/, ({init}) => {
      const {SchemaXml} = JSON.parse(init.body).parameters;
      if (SchemaXml.includes('EnforceUniqueValues="TRUE"')) return {status:500,text:'A list for which users can only view their own items cannot have fields that enforce unique values.'};
      const name = / Name="([^"]+)"/.exec(SchemaXml)[1];
      if (name === 'PayloadJson' && interrupt) { interrupt = false; return {status:503}; }
      if (name === 'RecordId') expect(SchemaXml).toContain('Indexed="TRUE"');
      expect(draftFields.has(name)).toBe(false);
      draftFields.add(name);
      return {status:201};
    });
    await expect(store.provision()).rejects.toThrow();
    expect([...draftFields]).toEqual(['RecordId']);
    await store.provision();
    expect([...draftFields]).toEqual(['RecordId','PayloadJson','SubmittedJson']);
    expect(createdFields().find(xml => xml.includes('Name="PublicationKey"'))).toContain('EnforceUniqueValues="TRUE"');
    expect(http.find(/\/_api\/web\/lists$/)).toHaveLength(0);
  });

  it('repairs an earlier unique draft field in place before enabling author-only reads', async () => {
    allPresent();
    let unique = true;
    let access = {ReadSecurity:1, WriteSecurity:1};
    const fieldPath = /InstrumentDrafts.*getbyinternalnameortitle\('RecordId'\)/;
    http.on(/InstrumentDrafts.*fields\?/, () => ({json:{value:[
      {InternalName:'RecordId',EnforceUniqueValues:unique}, {InternalName:'PayloadJson'}, {InternalName:'SubmittedJson'},
    ]}}));
    http.on(fieldPath, ({spMethod,init}) => {
      expect(spMethod).toBe('MERGE');
      expect(JSON.parse(init.body)).toEqual({EnforceUniqueValues:false});
      unique = false;
      return {status:204};
    });
    http.on(/InstrumentDrafts.*ReadSecurity/, () => ({json:access}));
    http.on(/UncertaintyInstrumentDrafts'\)$/, ({init}) => {
      if (unique) return {status:500,text:'Cannot change item-level permissions with a unique field'};
      access = JSON.parse(init.body);
      return {status:204};
    });
    await store.provision();
    await store.provision();
    expect(access).toEqual({ReadSecurity:2,WriteSecurity:2});
    expect(http.find(fieldPath)).toHaveLength(1);
    expect(http.calls.filter(call => call.method === 'POST' && /InstrumentDrafts.*(?:items|createfieldasxml)/.test(call.url))).toHaveLength(0);
  });
});

describe('legacy instrument migration', () => {
  const original = payload => ({ Id: payload.id, RecordId: payload.id, AuthorId: 19, PayloadJson: JSON.stringify(payload) });
  function mixedSite() {
    const legacy = [
      original({id:'mine', scope:'local', model:'private'}),
      original({id:'unscoped', model:'private legacy'}),
      original({id:'old', scope:'validated', _uncertaintyArchive:{at:'2026-01-01'}}),
      original({id:'first', scope:'shared', model:'meter'}),
      original({id:'second', scope:'validated', model:'shunt'}),
    ];
    const published = [];
    let access = {ReadSecurity:1, WriteSecurity:1};
    let marker = false;
    let failOnce = true;
    http.on(/UncertaintyInstruments'\)\?\$select=ReadSecurity/, () => ({json:access}));
    http.on(/UncertaintyInstruments'\)$/, ({method, init}) => {
      if (method === 'POST') access = JSON.parse(init.body);
      return {json:{}};
    });
    http.on(/UncertaintyInstruments'\)\/items\?/, () => {
      expect(access).toEqual({ReadSecurity:2,WriteSecurity:4});
      return {json:{value:legacy}};
    });
    http.on(/UncertaintyPublishedInstruments'\)\/fields\?/, () => ({json:{
      value: [...CONTAINERS.find(c => c.key === 'publishedInstruments').fields.map(f => ({InternalName:f.name})),
        ...(marker ? [{InternalName:'LegacyCatalogMigratedV1'}] : [])],
    }}));
    http.on(/UncertaintyPublishedInstruments'\)\/fields\/createfieldasxml/, ({init}) => {
      expect(init.body).toContain('LegacyCatalogMigratedV1');
      marker = true;
      return {json:{}};
    });
    http.on(/UncertaintyPublishedInstruments'\)\/items\?/, () => ({json:{value:published}}));
    http.on(/UncertaintyPublishedInstruments'\)\/items$/, ({init}) => {
      const fields = JSON.parse(init.body);
      if (fields.RecordId === 'second' && failOnce) { failOnce = false; return {status:503}; }
      expect(published.some(row => row.PublicationKey === fields.PublicationKey)).toBe(false);
      published.push(fields);
      return {status:201};
    });
    return {legacy, published, complete:() => marker};
  }

  it('protects original records in place, resumes copying shared rows and verifies completion before listing', async () => {
    const {legacy, published, complete} = mixedSite();
    const originals = JSON.stringify(legacy);
    await expect(store.provision()).rejects.toThrow();
    expect(published.map(row => row.RecordId)).toEqual(['first']);
    expect(complete()).toBe(false);
    await expect(store.listInstruments()).rejects.toThrow(/finish migrating/);
    await store.provision();
    expect(complete()).toBe(true);
    expect(published.map(row => JSON.parse(row.PayloadJson))).toEqual([
      {id:'first', scope:'validated', model:'meter'}, {id:'second', scope:'validated', model:'shunt'},
    ]);
    expect(JSON.stringify(legacy)).toBe(originals);
    expect((await store.listInstruments()).map(row => row.id)).toEqual(['first', 'second']);
    const author = new SharePointStore({webUrl:WEB,fetchImpl:http,currentUser:{id:19}});
    expect((await author.listInstruments()).map(row => row.id)).toEqual(['first','second','mine','unscoped']);
    await store.provision();
    expect(published).toHaveLength(2);
    expect(http.find(/PublishedInstruments'\)\/fields\/createfieldasxml/)).toHaveLength(1);
  });

  it('keeps the migration incomplete when the operator cannot enumerate other authors’ original rows', async () => {
    const {published, complete} = mixedSite();
    http.on(/UncertaintyInstruments'\)\/EffectiveBasePermissions/, {json:{Low:'3'}});
    await expect(store.provision()).rejects.toThrow(/Manage Lists on the original/);
    expect(published).toHaveLength(0);
    expect(complete()).toBe(false);
    expect(http.find(/UncertaintyInstruments'\)\/items\?/)).toHaveLength(0);
  });

  it('rejects an unprotected original list even when the published migration marker exists', async () => {
    http.on(/UncertaintyInstruments.*ReadSecurity/, {json:{ReadSecurity:1,WriteSecurity:4}});
    await expect(store.listInstruments()).rejects.toThrow(/site owner/);
    expect(http.find(/\/items\?/)).toHaveLength(0);
  });
});

describe("sessions", () => {
  it("rejects foreign and ownerless results before caching session file paths", async () => {
    http.on(/UncertaintySessions'\)\/items\?/, { json: { value: [
      { AuthorId: 99, SessionId: 7, FileLeafRef: 'session-99-7.json' },
      { SessionId: 8, FileLeafRef: 'session-8.json' },
      { AuthorId: 41, SessionId: 9, FileLeafRef: 'session-41-9.json' },
    ] } });
    expect((await store.listSessions()).map(item => item.id)).toEqual([9]);
    expect(await store.sessionFileName(7)).toBe('session-41-7.json');
    expect(await store.sessionFileName(8)).toBe('session-41-8.json');
  });
  it("lists sessions newest-first without reading payloads", async () => {
    http.on(/UncertaintySessions'\)\/items\?/, {
      json: { value: [{ AuthorId: 41, SessionId: 7, SessionName: "Shunt", Analyst: "BB", Modified: "2026-05-01" }] },
    });
    const sessions = await store.listSessions();
    expect(sessions).toEqual([
      expect.objectContaining({ id: 7, name: "Shunt", analyst: "BB", updated_at: "2026-05-01" }),
    ]);
    expect(http.find(/items\?/)[0].url).toContain("$orderby=Modified desc");
    expect(http.find(/items\?/)[0].url).toContain("$filter=AuthorId eq 41");
  });

  it("skips rows with no session id rather than emitting NaN", async () => {
    http.on(/UncertaintySessions'\)\/items\?/, { json: { value: [{ AuthorId: 41, SessionId: 1 }, { Title: "orphan" }] } });
    expect(await store.listSessions()).toHaveLength(1);
  });

  it("names an untitled session readably", async () => {
    http.on(/UncertaintySessions'\)\/items\?/, { json: { value: [{ AuthorId: 41, SessionId: 1 }] } });
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
          { AuthorId: 41, SessionId: 42, SessionName: "Legacy", FileLeafRef: "session-42.json" },
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
          { AuthorId: 41, SessionId: 7, SessionName: "Newest", FileLeafRef: "session-41-7.json" },
          { AuthorId: 41, SessionId: 7, SessionName: "Legacy", FileLeafRef: "session-7.json" },
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

  it('restores qualifier names and all three sync scopes from the saved session file', async () => {
    const base={id:'shared',model:'Meter',scope:'validated'};
    const shared={...base,validatedSnapshot:buildValidatedSnapshot(base),localOverride:false};
    const local={...shared,id:'local',scope:'local',sourceId:'shared',localOverride:true};
    const sessionOnly={...local,id:'draft',scope:'session'};
    const doc={id:9,name:'Qualifiers',qualifierColumnNames:{uut:['Frequency','Interval'],tmde:['Mode']},
      uuts:[shared,local,sessionOnly].map((instrument,index)=>({id:index,instrument}))};
    await store.saveSession(doc);
    const upload=http.find(/files\/add/)[0];
    http.on(/\$value/,{text:upload.body});
    const restored=await store.getSession(9);
    expect(restored.qualifierColumnNames).toEqual(doc.qualifierColumnNames);
    expect(restored.uuts.map(row=>computeSyncState(row.instrument))).toEqual(['green','orange','red']);
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
            AuthorId: 41,
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
          { AuthorId: 41, SessionId: 9, SessionName: "Before", FileLeafRef: "session-41-9.json" },
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

  it("archives the complete session and clears its picker key without deleting a file", async () => {
    const doc = { id: 5, name: 'Calibration', testPoints: [{ id: 'point', value: 10 }] };
    http.on(/session-41-5.json.*\$value$/, { json: doc });
    await store.deleteSession(5);
    const archived = JSON.parse(http.find(/files\/add/)[0].body);
    expect(archived).toMatchObject(doc);
    expect(archived._uncertaintyArchive).toMatchObject({ userId: 41, at: expect.any(String) });
    expect(formValueObject(http.find(/ValidateUpdateListItem/)[0])).toEqual({ SessionId: '' });
    expect(http.find(/recycle|delete/i)).toHaveLength(0);
    http.on(/session-41-5.json.*\$value$/, { json: archived });
    expect(await store.getSession(5)).toBeNull();
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
  it('rejects an incomplete publication listing even when the failed page returns HTTP 200', async () => {
    http.on(/PublishedInstruments'\)\/items\?/, {json:{value:[], '@odata.nextLink':WEB + '/_api/publications-page-two'}});
    http.on(/publications-page-two/, {json:{}});
    await expect(store.listInstruments()).rejects.toThrow(/incomplete instrument listing/);
  });
  it('finishes interrupted approval cleanup after removal without republishing or clearing a newer submission', async () => {
    vi.spyOn(store, 'canValidateInstruments').mockResolvedValue(true);
    const draft = {Id:19, RecordId:'41:meter', AuthorId:41, owshiddenversion:2,
      PayloadJson:'{"id":"meter","scope":"pending","model":"Submitted"}'};
    draftRows.push(draft);
    http.on(/InstrumentDrafts'\)\/items\(19\)\?/, () => ({json:draft}));
    http.on(/InstrumentDrafts'\)\/items\(19\)$/, ({init}) => {
      if (init.headers['IF-MATCH'] !== `"${draft.owshiddenversion}"`) return {status:412};
      Object.assign(draft, JSON.parse(init.body));
      draft.owshiddenversion++;
      return {status:204};
    });
    http.on(/PublishedInstruments'\)\/items\?/, {json:{value:[{Id:70, RecordId:'meter', PayloadJson:JSON.stringify({
      id:'meter', scope:'validated', model:'Published', _uncertaintyApprovals:{19:'2'}, _uncertaintyArchive:{at:'2026-11-10'},
    })}]}});
    expect((await store.listInstruments()).map(record => record.scope)).toEqual(['local']);
    expect((await store.instrumentReviews()).reviews).toEqual([]);
    await expect(store.validateInstrument('19', '2')).rejects.toThrow(/has been removed/);
    expect(JSON.parse(draft.SubmittedJson)._uncertaintyArchive).toBeDefined();
    expect((await store.instrumentReviews()).reviews).toEqual([]);
    draft.SubmittedJson = '{"id":"meter","scope":"pending","model":"New specs"}';
    draft.owshiddenversion++;
    await expect(store.validateInstrument('19', '2')).rejects.toThrow(/has been removed/);
    expect((await store.listInstruments()).find(record => record.scope === 'pending').model).toBe('New specs');
    expect((await store.instrumentReviews()).reviews.map(review => review.model)).toEqual(['New specs']);
    expect(http.calls.filter(call => call.method === 'POST' && call.url.includes('PublishedInstruments'))).toEqual([]);
  });
  it.each(['approved draft', 'migrated original'])('restores the removed publication only to its %s author and keeps later edits private', async origin => {
    const id = 'meter';
    const publication = {Id:70, RecordId:id, AuthorId:56, owshiddenversion:5, PayloadJson:JSON.stringify({
      id, scope:'validated', model:'Latest specifications', sourceId:id, validatedSnapshot:{model:'Latest specifications'},
      _uncertaintyApprovals:origin === 'approved draft' ? {'19':'2'} : {},
    })};
    http.on(/PublishedInstruments'\)\/items\?/, ({url}) => ({
      json:{value:!url.includes('RecordId eq') || url.includes("RecordId eq 'meter'") ? [publication] : []},
    }));
    http.on(/PublishedInstruments'\)\/items\(70\)$/, ({init}) => {
      if (init.headers['IF-MATCH'] !== `"${publication.owshiddenversion}"`) return {status:412};
      Object.assign(publication, JSON.parse(init.body));
      publication.owshiddenversion++;
      return {status:204};
    });
    if (origin === 'approved draft') {
      draftRows.push({Id:19, RecordId:'41:meter', AuthorId:41, owshiddenversion:3,
        PayloadJson:JSON.stringify({id, scope:'pending', _uncertaintyArchive:{at:'2026-11-01'}})});
    } else {
      http.on(/UncertaintyInstruments'\)\/items\?/, {json:{value:[{Id:15, AuthorId:41, RecordId:id,
        PayloadJson:JSON.stringify({id,scope:'shared',model:'Original specifications'})}]}});
    }
    const other = new SharePointStore({webUrl:WEB, fetchImpl:http, currentUser:{id:56}});
    if (origin === 'migrated original') {
      expect(await other.deleteInstrument(id, 'calibrate')).toBeNull();
    } else {
      expect(await store.deleteInstrument(id, 'calibrate')).toMatchObject({scope:'local', formerPublicationId:id});
    }
    expect(await other.listInstruments()).toEqual([]);
    const [restored] = await store.listInstruments();
    expect(restored).toMatchObject({formerPublicationId:id, scope:'local', model:'Latest specifications', owner:'sharepoint-user:41', sourceId:''});
    expect(computeSyncState(restored)).toBe('orange');
    expect(restored).not.toHaveProperty('_uncertaintyApprovals');
    expect(restored).not.toHaveProperty('_uncertaintyArchive');
    if (origin === 'approved draft') {
      await store.saveInstrument({...restored, model:'Edited privately'});
      expect((await store.listInstruments()).map(row => row.model)).toEqual(['Edited privately']);
      expect((await store.deleteInstrument(id, 'calibrate')).model).toBe('Edited privately');
    }
    expect(await other.listInstruments()).toEqual([]);
    await store.deleteInstrument(restored.id);
    expect(await store.listInstruments()).toEqual([]);
    expect(JSON.parse(publication.PayloadJson)._uncertaintyArchive.userId).toBe(origin === 'migrated original' ? 56 : 41);
  });
  it('keeps a deliberately demoted instrument orange after library reload', async () => {
    const base={id:'shared',scope:'validated',model:'Meter'};
    const local={...base,id:'copy',scope:'local',sourceId:'shared',localOverride:true,validatedSnapshot:buildValidatedSnapshot(base)};
    await store.saveInstrument(local);
    const write=http.calls.filter(call=>/items$/.test(call.url)).at(-1);
    const payload=JSON.parse(write.body).PayloadJson;
    http.on(/UncertaintyInstruments'\)\/items\?\$select/,{json:{value:[{Id:1,AuthorId:41,PayloadJson:payload}]}});
    expect(computeSyncState((await store.listInstruments())[0])).toBe('orange');
  });
  it("uses a stable SharePoint user owner key", () => {
    expect(sharePointInstrumentOwnerKey({ id: 41 })).toBe("sharepoint-user:41");
  });

  it("returns shared instruments and only the signed-in user's local instruments", async () => {
    http.on(/UncertaintyPublishedInstruments'\)\/items\?\$select/, { json: { value: [
      { Id: 21, RecordId: "shared", PayloadJson: '{"id":"shared","scope":"shared"}' },
    ] } });
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

    ]);
    expect(http.find(/UncertaintyInstruments.*items\?/)[0].url).toContain("$filter=AuthorId eq 41");
  });

  it("creates a separate local row instead of overwriting another user's matching id", async () => {
    draftRows.push({ Id: 72, AuthorId: 99, RecordId: "41:same", PayloadJson: '{"id":"same","scope":"local"}' });

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
    expect(draftRows.map(row => row.AuthorId)).toEqual([99,41]);
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

  it('converges simultaneous first saves on the same native row and keeps duplicates hidden after removal', async () => {
    const secondTab = new SharePointStore({webUrl:WEB,fetchImpl:http,currentUser:{id:41}});
    await Promise.all([store.ensureInstrumentSecurity(),secondTab.ensureInstrumentSecurity()]);
    await Promise.all([
      store.saveInstrument({id:'parallel',scope:'local',model:'One'}),
      secondTab.saveInstrument({id:'parallel',scope:'local',model:'Two'}),
    ]);
    expect(draftRows).toHaveLength(2);
    draftRows.reverse(); // SharePoint does not promise an ordering here.
    const [current] = await store.listInstruments();
    expect((await secondTab.listInstruments())).toEqual([current]);
    expect(current.model).toBe('Two');
    expect(JSON.parse(draftRows.find(row => row.Id === 100).PayloadJson).model).toBe('Two');
    await store.deleteInstrument('parallel');
    expect(await secondTab.listInstruments()).toEqual([]);
    expect(JSON.parse(draftRows.find(row => row.Id === 101).PayloadJson).model).toBe('Two');
  });

  it('ignores a shadow pending row in the inbox and refuses its direct review ID even after the first row was archived', async () => {
    vi.spyOn(store,'canValidateInstruments').mockResolvedValue(true);
    const shadow = {Id:45,AuthorId:41,RecordId:'41:meter',owshiddenversion:3,PayloadJson:'{"id":"meter","scope":"pending"}'};
    draftRows.push(shadow, {...shadow,Id:44,PayloadJson:'{"id":"meter","scope":"pending","_uncertaintyArchive":{"at":"2026-11-09"}}'});
    http.on(/InstrumentDrafts'\)\/items\(45\)\?/, {json:shadow});
    expect((await store.instrumentReviews()).reviews).toEqual([]);
    await expect(store.validateInstrument('45','3')).rejects.toThrow(/superseded/);
    expect(http.calls.some(call => call.method === 'POST')).toBe(false);
  });

  it('retries an interrupted approval without overwriting a later accepted catalog revision', async () => {
    vi.spyOn(store,'canValidateInstruments').mockResolvedValue(true);
    const draft = {Id:42,AuthorId:41,RecordId:'41:meter',owshiddenversion:2,PayloadJson:'{"id":"meter","scope":"pending","model":"First"}'};
    draftRows.push(draft);
    const catalog = [];
    let failCleanup = true;
    http.on(/InstrumentDrafts'\)\/items\(42\)\?/, () => ({json:draft}));
    http.on(/InstrumentDrafts'\)\/items\(42\)$/, ({init}) => {
      if (failCleanup && JSON.parse(JSON.parse(init.body).PayloadJson)._uncertaintyArchive) { failCleanup = false; return {status:503}; }
      Object.assign(draft, JSON.parse(init.body));
      draft.owshiddenversion++;
      return {status:204};
    });
    http.on(/PublishedInstruments'\)\/items\?/, () => ({json:{value:catalog}}));
    http.on(/PublishedInstruments'\)\/items$/, ({init}) => {
      catalog.push({Id:90, owshiddenversion:1, ...JSON.parse(init.body)});
      // Commit happened but its response was lost. The store confirms the
      // exact submission receipt before proceeding to the interrupted cleanup.
      return {status:503};
    });
    await expect(store.validateInstrument('42','2')).rejects.toThrow(/503/);
    expect(catalog).toHaveLength(1);
    const later = JSON.parse(catalog[0].PayloadJson);
    later.model = 'Latest';
    later._uncertaintyApprovals['43'] = '1';
    catalog[0].PayloadJson = JSON.stringify(later);
    catalog[0].owshiddenversion++;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await store.validateInstrument('42','2');
      expect(result.model).toBe('Latest');
      expect(result).not.toHaveProperty('_uncertaintyApprovals');
    }
    expect(http.calls.filter(call => call.method === 'POST' && call.url.includes('PublishedInstruments'))).toHaveLength(1);
    expect((await store.instrumentReviews()).reviews).toEqual([]);
  });

  it('cannot overwrite a simultaneous first publication from a different draft with the same shared ID', async () => {
    vi.spyOn(store,'canValidateInstruments').mockResolvedValue(true);
    const draft = {Id:42,AuthorId:41,RecordId:'41:meter',owshiddenversion:2,PayloadJson:'{"id":"meter","scope":"pending","model":"Contender"}'};
    draftRows.push(draft);
    http.on(/InstrumentDrafts'\)\/items\(42\)\?/, {json:draft});
    const catalog = [];
    http.on(/PublishedInstruments'\)\/items\?/, () => ({json:{value:catalog}}));
    http.on(/PublishedInstruments'\)\/items$/, () => {
      catalog.push({Id:90,RecordId:'meter',PublicationKey:'meter',owshiddenversion:1,PayloadJson:JSON.stringify({
        id:'meter',scope:'validated',model:'Already published',_uncertaintyApprovals:{51:'1'},
      })});
      return {status:500,text:'A duplicate value cannot be inserted into a unique index.'};
    });
    await expect(store.validateInstrument('42','2')).rejects.toMatchObject({status:409});
    await expect(store.validateInstrument('42','2')).rejects.toMatchObject({status:409});
    expect(catalog).toHaveLength(1);
    expect((await store.instrumentReviews()).reviews).toHaveLength(1);
    const draftWrites = http.calls.filter(call => call.method === 'POST' && call.url.includes('/items('));
    expect(draftWrites).toHaveLength(1);
    expect(JSON.parse(JSON.parse(draftWrites[0].body).SubmittedJson)._uncertaintyApprovalClaim).toEqual({version:'2'});
    const pending = (await store.listInstruments()).find(record => record.scope === 'pending');
    expect(await store.saveInstrument({...pending,scope:'local',action:'withdraw'})).toMatchObject({scope:'local',model:'Contender'});
    expect((await store.instrumentReviews()).reviews).toEqual([]);
    expect(JSON.parse(catalog[0].PayloadJson).model).toBe('Already published');
  });

  it.each([
    { reviewerGroup: "Metrology Software Owners", smeExists: false },
    { reviewerGroup: "Uncertalytics SME", smeExists: true },
  ])("isolates pending definitions and publishes the reviewed version for $reviewerGroup", async ({reviewerGroup, smeExists}) => {
    const record = { id: "copy", sourceId: "shared", scope: "pending", model: "DMM" };
    const item = { Id: 81, AuthorId: 12, RecordId: "12:copy", owshiddenversion: 3, PayloadJson: JSON.stringify(record) };
    draftRows.push(item);
    http.on(/InstrumentDrafts'\)\/items\?/, { json: { value: [item] } });
    http.on(/InstrumentDrafts'\)\/items\(81\)\?/, { json: item });
    http.on(/Instruments'\)\/items\?/, { json: { value: [{Id: 80, RecordId: "shared", AuthorId: 12,
      owshiddenversion: 4, PayloadJson: '{"id":"shared","scope":"validated","model":"Old"}'}] } });
    expect(await store.listInstruments()).toEqual([{id:"shared",scope:"validated",model:"Old"}]);
    http.on(/currentuser\/groups/, {json:{value:[{Title:"Metrology App User"},{Title:"Metrology Software Owners Backup"}]}});
    expect(await store.instrumentReviews()).toEqual({canValidate:false,reviews:[]});
    expect(http.find(/web\/sitegroups/)).toHaveLength(0);
    await expect(store.saveInstrument({...record,scope:"validated",password:"calibrate"})).rejects.toMatchObject({status:403});
    await expect(store.validateInstrument("81", "3")).rejects.toMatchObject({status:403});
    const smeLookup = /web\/sitegroups.*filter=Title eq 'Uncertalytics SME'/;
    http.on(smeLookup, {json:{value:smeExists ? [{Title:"Uncertalytics SME"}] : []}});
    http.on(/currentuser\/groups/, {json:{value:[{Title:reviewerGroup}]}});
    expect((await store.instrumentReviews()).reviews).toEqual([{...record,reviewId:"81",reviewVersion:"3"}]);
    await expect(store.validateInstrument("81","2")).rejects.toMatchObject({status:409});
    const approved = await store.validateInstrument("81", "3");
    expect(approved).toMatchObject({id:"shared", model:"DMM", scope:"validated", validatedSnapshot:{model:"DMM"}});
    expect(http.find(smeLookup)).toHaveLength(smeExists ? 0 : 3);
    const publication = http.calls.find(call => call.spMethod === "MERGE" && call.url.includes("UncertaintyPublishedInstruments')/items(80)"));
    expect(publication.headers["IF-MATCH"]).toBe('"4"');
    expect(JSON.parse(publication.body).PublicationKey).toBe("shared");
    const draftWrites = http.calls.filter(call => call.spMethod === "MERGE" && call.url.includes("UncertaintyInstrumentDrafts')/items(81)"));
    expect(draftWrites[0].headers["IF-MATCH"]).toBe('"3"');
    expect(JSON.parse(JSON.parse(draftWrites[0].body).SubmittedJson)._uncertaintyApprovalClaim).toEqual({version:'3'});
    const cleanup = draftWrites[1];
    expect(cleanup.headers["IF-MATCH"]).toBe('"4"');
    expect(JSON.parse(JSON.parse(cleanup.body).PayloadJson)).toMatchObject({_uncertaintyArchive:{userId:41}});
  });

  it("ends interim validation when the SME group is created, even with an inbox already open", async () => {
    http.on(/currentuser\/groups/, {json:{value:[{Title:"Metrology Software Owners"}]}});
    const lookup = /web\/sitegroups.*filter=Title eq 'Uncertalytics SME'/;
    http.on(lookup, {json:{value:[]}});
    expect((await store.instrumentReviews()).canValidate).toBe(true);
    http.on(lookup, {json:{value:[{Title:"Uncertalytics SME"}]}});
    await expect(store.validateInstrument("81", "3")).rejects.toMatchObject({status:403});
    expect(await store.instrumentReviews()).toEqual({canValidate:false,reviews:[]});
    expect(http.find(/items\(81\)/)).toHaveLength(0);

    http.on(lookup, {json:{}});
    expect(await store.canValidateInstruments()).toBe(false);
    http.on(lookup, {status:403});
    await expect(store.validateInstrument("81","3")).rejects.toMatchObject({status:403});
    http.on(lookup, {status:503});
    await expect(store.validateInstrument("81","3")).rejects.toMatchObject({status:503});
  });

  it("fails closed when the private list allows reading other users' drafts", async () => {
    http.on(/InstrumentDrafts.*ReadSecurity/, {json:{ReadSecurity:1,WriteSecurity:2}});
    await expect(store.saveInstrument({id:"private",scope:"pending"})).rejects.toMatchObject({status:403});
    expect(http.calls.some(call=>call.method==="POST")).toBe(false);
  });

  it('keeps submitted specifications intact after a late autosave and requires the current revision to withdraw', async () => {
    const local = {id:'meter', scope:'local', model:'Draft'};
    const item = {Id:81, AuthorId:41, RecordId:'41:meter', owshiddenversion:2, PayloadJson:JSON.stringify(local)};
    http.on(/InstrumentDrafts'\)\/items\?/, () => ({json:{value:[item]}}));
    http.on(/InstrumentDrafts'\)\/items\(81\)$/, ({init}) => {
      if (init.headers['IF-MATCH'] !== `"${item.owshiddenversion}"`) return {status:412};
      Object.assign(item, JSON.parse(init.body));
      item.owshiddenversion++;
      return {status:204};
    });
    const submitted = await store.saveInstrument({...local, scope:'pending', model:'Submitted'});
    expect(submitted).toMatchObject({scope:'pending', model:'Submitted', reviewVersion:'3'});
    // An earlier form update arrives after submission. It only carries the
    // editable payload, which cannot overwrite the snapshot being reviewed.
    item.PayloadJson = JSON.stringify({...local, model:'Stale'});
    item.owshiddenversion++;
    const [current] = await store.listInstruments();
    expect(current).toMatchObject({scope:'pending', model:'Submitted', reviewVersion:'4'});
    http.on(/currentuser\/groups/, {json:{value:[{Title:'Uncertalytics SME'}]}});
    expect((await store.instrumentReviews()).reviews[0]).toMatchObject({scope:'pending', model:'Submitted', reviewVersion:'4'});
    await expect(store.saveInstrument(local)).rejects.toMatchObject({status:409});
    await expect(store.saveInstrument({...submitted, scope:'local'})).rejects.toMatchObject({status:409});
    expect(await store.saveInstrument({...current, scope:'local', model:'Withdrawn'})).toMatchObject({scope:'local',model:'Withdrawn'});
    expect(item.SubmittedJson).toBeNull();
    expect((await store.listInstruments())[0]).toMatchObject({scope:'local',model:'Withdrawn'});
    expect((await store.instrumentReviews()).reviews).toEqual([]);
  });

  it('lets a general user withdraw only the current stored submission and rejects a stale SME review', async () => {
    const submitted = {id:'meter', scope:'pending', model:'Submitted torque meter', functions:[{name:'Torque'}], localOverride:true};
    const item = {Id:81, AuthorId:41, RecordId:'41:meter', owshiddenversion:3,
      PayloadJson:JSON.stringify({...submitted, model:'Late form edit'}), SubmittedJson:JSON.stringify(submitted)};
    draftRows.push(item);
    http.on(/currentuser\/groups/, {json:{value:[{Title:'Metrology App User'}]}});
    http.on(/InstrumentDrafts'\)\/items\(81\)\?/, () => ({json:item}));
    http.on(/InstrumentDrafts'\)\/items\(81\)$/, ({init}) => {
      if (init.headers['IF-MATCH'] !== `"${item.owshiddenversion}"`) return {status:412};
      Object.assign(item, JSON.parse(init.body)); item.owshiddenversion++;
      return {status:204};
    });
    const local = await store.saveInstrument({id:'meter', scope:'local', action:'withdraw', reviewVersion:'3', model:'Stale session copy', functions:[]});
    expect(local).toMatchObject({...submitted, scope:'local', localOverride:true});
    expect(local).not.toHaveProperty('action');
    expect(local).not.toHaveProperty('reviewVersion');
    expect(item.SubmittedJson).toBeNull();
    expect(http.find(/currentuser\/groups/)).toHaveLength(0);
    expect((await store.listInstruments())[0]).toMatchObject(local);
    http.on(/currentuser\/groups/, {json:{value:[{Title:'Uncertalytics SME'}]}});
    expect((await store.instrumentReviews()).reviews).toEqual([]);
    await expect(store.validateInstrument('81','3')).rejects.toMatchObject({status:409});
    expect(http.calls.filter(call => call.method === 'POST' && call.url.includes('PublishedInstruments'))).toHaveLength(0);
  });

  it.each(['foreign', 'stale', 'local', 'approved'])('rejects an explicit withdrawal of a %s submission without writing', async scenario => {
    const item = {Id:81, AuthorId:scenario === 'foreign' ? 99 : 41, RecordId:scenario === 'foreign' ? '99:meter' : '41:meter',
      owshiddenversion:3, PayloadJson:JSON.stringify({id:'meter', scope:scenario === 'local' ? 'local' : 'pending', model:'Stored'})};
    draftRows.push(item);
    if (scenario === 'approved') http.on(/PublishedInstruments'\)\/items\?/, {json:{value:[{Id:90,RecordId:'meter',PayloadJson:JSON.stringify({id:'meter',scope:'validated',_uncertaintyApprovals:{81:'3'}})}]}});
    await expect(store.saveInstrument({id:'meter',scope:'local',action:'withdraw',reviewVersion:scenario === 'stale' ? '2' : '3'}))
      .rejects.toMatchObject({status:scenario === 'foreign' ? 404 : 409});
    expect(http.calls.filter(call => call.method === 'POST')).toHaveLength(0);
  });

  it('keeps a concurrently changed submission when withdrawal loses its revision check', async () => {
    draftRows.push({Id:81,AuthorId:41,RecordId:'41:meter',owshiddenversion:3,PayloadJson:'{"id":"meter","scope":"pending","model":"Submitted"}'});
    http.on(/InstrumentDrafts'\)\/items\(81\)$/, {status:412});
    await expect(store.saveInstrument({id:'meter',scope:'local',action:'withdraw',reviewVersion:'3'})).rejects.toMatchObject({status:409});
    expect(JSON.parse(draftRows[0].PayloadJson).scope).toBe('pending');
  });

  it('does not publish when withdrawal wins while an SME approval is paused before its draft claim', async () => {
    vi.spyOn(store,'canValidateInstruments').mockResolvedValue(true);
    const submitted = {id:'meter',scope:'pending',model:'Submitted'};
    draftRows.push({Id:81,AuthorId:41,RecordId:'41:meter',owshiddenversion:3,PayloadJson:JSON.stringify(submitted)});
    let resumeApproval, reachedCatalog;
    const paused = new Promise(resolve => { reachedCatalog = resolve; });
    const resume = new Promise(resolve => { resumeApproval = resolve; });
    let firstRead = true;
    http.on(/PublishedInstruments'\)\/items\?/, async () => {
      if (firstRead) { firstRead = false; reachedCatalog(); await resume; }
      return {json:{value:[]}};
    });
    const approval = store.validateInstrument('81','3');
    const rejectedApproval = expect(approval).rejects.toMatchObject({status:409});
    await paused;
    expect(await store.saveInstrument({id:'meter',scope:'local',action:'withdraw',reviewVersion:'3'})).toMatchObject({scope:'local'});
    resumeApproval();
    await rejectedApproval;
    expect(JSON.parse(draftRows[0].PayloadJson)).toMatchObject({scope:'local',model:'Submitted'});
    expect(http.calls.filter(call => call.method === 'POST' && call.url.includes('PublishedInstruments'))).toEqual([]);
  });

  it('blocks withdrawal and edits after approval claims the draft but before publication commits', async () => {
    vi.spyOn(store,'canValidateInstruments').mockResolvedValue(true);
    draftRows.push({Id:81,AuthorId:41,RecordId:'41:meter',owshiddenversion:3,PayloadJson:'{"id":"meter","scope":"pending","model":"Reviewed"}'});
    const catalog = [];
    let resumePublication, reachedPublication;
    const paused = new Promise(resolve => { reachedPublication = resolve; });
    const resume = new Promise(resolve => { resumePublication = resolve; });
    http.on(/PublishedInstruments'\)\/items\?/, () => ({json:{value:catalog}}));
    http.on(/PublishedInstruments'\)\/items$/, async ({init}) => {
      reachedPublication(); await resume;
      catalog.push({Id:90,owshiddenversion:1,...JSON.parse(init.body)});
      return {status:201,json:catalog[0]};
    });
    const approval = store.validateInstrument('81','3');
    await paused;
    const [current] = await store.listInstruments();
    expect(current.reviewVersion).toBe('3');
    expect(current).not.toHaveProperty('_uncertaintyApprovalClaim');
    for (const reviewVersion of ['3', String(draftRows[0].owshiddenversion)]) {
      await expect(store.saveInstrument({id:'meter',scope:'local',action:'withdraw',reviewVersion})).rejects.toMatchObject({status:409});
      await expect(store.saveInstrument({...current,scope:'pending',model:'Changed',reviewVersion})).rejects.toMatchObject({status:409});
    }
    await expect(store.deleteInstrument('meter')).rejects.toMatchObject({status:409});
    resumePublication();
    expect(await approval).toMatchObject({scope:'validated',model:'Reviewed'});
    expect(JSON.parse(catalog[0].PayloadJson)).not.toHaveProperty('_uncertaintyApprovalClaim');
    expect((await store.instrumentReviews()).reviews).toEqual([]);
  });

  it('resumes a persisted approval claim from a reopened inbox after lost claim and failed publication responses', async () => {
    vi.spyOn(store,'canValidateInstruments').mockResolvedValue(true);
    const draft = {Id:81,AuthorId:41,RecordId:'41:meter',owshiddenversion:3,PayloadJson:'{"id":"meter","scope":"pending","model":"Reviewed"}'};
    draftRows.push(draft);
    const catalog = [];
    let loseClaimResponse = true, failPublication = true;
    http.on(/PublishedInstruments'\)\/items\?/, () => ({json:{value:catalog}}));
    http.on(/InstrumentDrafts'\)\/items\(81\)$/, ({init}) => {
      if (init.headers['IF-MATCH'] !== `"${draft.owshiddenversion}"`) return {status:412};
      Object.assign(draft,JSON.parse(init.body)); draft.owshiddenversion++;
      if (loseClaimResponse) { loseClaimResponse = false; return {status:503}; }
      return {status:204};
    });
    http.on(/PublishedInstruments'\)\/items$/, ({init}) => {
      if (failPublication) { failPublication = false; return {status:503}; }
      catalog.push({Id:90,owshiddenversion:1,...JSON.parse(init.body)});
      return {status:201,json:catalog[0]};
    });
    await expect(store.validateInstrument('81','3')).rejects.toMatchObject({status:503});
    const reopened = new SharePointStore({webUrl:WEB,fetchImpl:http,currentUser:{id:41}});
    vi.spyOn(reopened,'canValidateInstruments').mockResolvedValue(true);
    const [review] = (await reopened.instrumentReviews()).reviews;
    expect(review).toMatchObject({reviewId:'81',reviewVersion:'3',model:'Reviewed'});
    expect(review).not.toHaveProperty('_uncertaintyApprovalClaim');
    expect(draft.owshiddenversion).toBe(4);
    expect(await reopened.validateInstrument(review.reviewId,review.reviewVersion)).toMatchObject({scope:'validated',model:'Reviewed'});
    expect(catalog).toHaveLength(1);
    expect(JSON.parse(catalog[0].PayloadJson)).not.toHaveProperty('_uncertaintyApprovalClaim');
    expect((await reopened.instrumentReviews()).reviews).toEqual([]);
  });

  it('lets the author withdraw a failed claim once its shared target was durably removed', async () => {
    const record = {id:'copy',sourceId:'shared',scope:'pending',model:'Reviewed',_uncertaintyApprovalClaim:{version:'3'}};
    draftRows.push({Id:81,AuthorId:41,RecordId:'41:copy',owshiddenversion:4,PayloadJson:JSON.stringify(record)});
    http.on(/PublishedInstruments'\)\/items\?/, {json:{value:[{Id:90,RecordId:'shared',owshiddenversion:8,PayloadJson:JSON.stringify({id:'shared',scope:'validated',_uncertaintyArchive:{at:'2026-11-10'}})}]}});
    const local = await store.saveInstrument({id:'copy',scope:'local',action:'withdraw',reviewVersion:'3'});
    expect(local).toMatchObject({scope:'local',model:'Reviewed'});
    expect(local).not.toHaveProperty('_uncertaintyApprovalClaim');
    expect(draftRows[0].SubmittedJson).toBeNull();
    expect(http.calls.filter(call => call.method === 'POST' && call.url.includes('PublishedInstruments'))).toEqual([]);
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
    const archived = JSON.parse(formValueObject(http.find(/items\(73\)\/ValidateUpdateListItem/)[0]).PayloadJson);
    expect(archived).toMatchObject({ id: 'same', scope: 'local', _uncertaintyArchive: { userId: 41 } });
    expect(http.find(/items\(72\)/)).toHaveLength(0);
  });
  it("requires the shared-library password before archiving a shared instrument", async () => {
    http.on(/\$filter=RecordId/, { json: { value: [
      { Id: 74, AuthorId: 99, RecordId: "shared", PayloadJson: '{"id":"shared","scope":"validated"}' },
    ] } });
    await expect(store.deleteInstrument("shared")).rejects.toMatchObject({status:403});
    await expect(store.deleteInstrument("shared", "wrong")).rejects.toMatchObject({status:403});
    expect(http.find(/ValidateUpdateListItem/)).toHaveLength(0);
    await store.deleteInstrument("shared", "calibrate");
    const saved=JSON.parse(formValueObject(http.find(/items\(74\)\/ValidateUpdateListItem/)[0]).PayloadJson);
    expect(saved._uncertaintyArchive).toBeDefined();
    expect(saved).not.toHaveProperty('password');
  });

  it("never requests deletion, recycling, bulk operations, or mutation override headers", async () => {
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
    expect(http.calls.some(call => /recycle|delete|\$batch/i.test(call.url) || call.method === 'DELETE')).toBe(false);
  });

  it("keeps archived records hidden after reload and preserves a new record with the same id", async () => {
    const archived = { id: 'same', scope: 'local', model: 'Old', _uncertaintyArchive: { at: '2026-09-13', userId: 41 } };
    const active = { id: 'same', scope: 'local', model: 'New' };
    http.on(/UncertaintyInstruments'\)\/items\?/, { json: { value: [
      { Id: 71, AuthorId: 41, RecordId: 'same', PayloadJson: JSON.stringify(archived) },
      { Id: 72, AuthorId: 41, RecordId: 'same', PayloadJson: JSON.stringify(active) },
    ] } });
    expect(await store.listInstruments()).toEqual([{ ...active, owner: 'sharepoint-user:41' }]);
    expect(await store.listRecords('instruments')).toEqual([active]);
    expect(await store.findItemId('instruments', 'same')).toBe(72);
    await store.saveInstrument({ ...active, model: 'Updated' });
    expect(http.find(/items\(71\)/)).toHaveLength(0);
    expect(http.find(/items\(72\)\/ValidateUpdateListItem/)).toHaveLength(0);
    expect(http.find(/InstrumentDrafts'\)\/items$/)).toHaveLength(1);
  });

  it("archives equations and reports with their original content intact", async () => {
    const record = { id: 'equation', equation: 'x * 2', name: 'Example' };
    http.on(/\$filter=RecordId/, { json: { value: [{ Id: 12, PayloadJson: JSON.stringify(record) }] } });
    await store.deleteRecord('equations', 'equation');
    const saved = JSON.parse(formValueObject(http.find(/ValidateUpdateListItem/)[0]).PayloadJson);
    expect(saved).toMatchObject({ ...record, _uncertaintyArchive: { userId: 41 } });
  });

  it("does not claim success or erase data when SharePoint rejects archiving", async () => {
    http.on(/\$filter=RecordId/, { json: { value: [{ Id: 12, PayloadJson: '{"id":"eq"}' }] } });
    http.on(/ValidateUpdateListItem/, { json: { value: [{ FieldName: 'PayloadJson', HasException: true, ErrorMessage: 'Denied' }] } });
    await expect(store.deleteRecord('equations', 'eq')).rejects.toThrow('Denied');
    expect(http.find(/recycle|delete/i)).toHaveLength(0);
  });

  it('continues past archived records on earlier SharePoint pages', async () => {
    const archived = { id: 'old', _uncertaintyArchive: { at: '2026-09-13' } };
    http.on(/UncertaintyPublishedInstruments'\)\/items\?/, { json: {
      value: [{ Id: 1, PayloadJson: JSON.stringify(archived) }],
      'odata.nextLink': `${WEB}/_api/page2`,
    } });
    http.on(/\/_api\/page2$/, { json: { value: [{ Id: 2, PayloadJson: '{"id":"active","scope":"validated"}' }] } });
    expect(await store.listInstruments()).toEqual([{ id: 'active', scope: 'validated' }]);
  });

  it('leaves already archived file content untouched and treats missing files as removed', async () => {
    http.on(/already.json.*\$value$/, { json: { id: 5, _uncertaintyArchive: { at: '2026-09-12', userId: 41 } } });
    http.on(/missing.json.*\$value$/, { status: 404 });
    await store.archiveJsonFile('already.json');
    expect(await store.archiveJsonFile('missing.json')).toBeNull();
    expect(http.find(/files\/add/)).toHaveLength(0);
  });
});


describe('organized application storage', () => {
  const ids = CONTAINERS.map((_, i) => `00000000-0000-4000-8000-00000000000${i}`);
  const titles = ['Uncertalytics - Sessions', 'Uncertalytics - Instruments', 'Uncertalytics - Equations', 'Uncertalytics - Bug Reports', 'Uncertalytics - Instrument Drafts', 'Uncertalytics - Published Instruments'];
  function setup() {
    const rows = CONTAINERS.map((c,i) => ({Id:ids[i],Title:listTitle('Uncertainty',c.key),Hidden:true,OnQuickLaunch:true,ItemCount:7}));
    http.on(/EffectiveBasePermissions/, {json:{Low:'2048',High:'0'}});
    http.on(/getbytitle/, ({url}) => {
      const title=decodeURIComponent(url.match(/getbytitle\('([^']+)'\)/)[1]);
      const row=rows.find(r=>r.Title===title);
      return row ? {json:row} : {status:404};
    });
    http.on(/lists\(guid'/, ({url,init})=>{
      const row=rows.find(r=>url.includes(r.Id));
      Object.assign(row,JSON.parse(init.body));
      return {status:204};
    });
    return rows;
  }
  it('renames and reveals existing storage in place without altering data or permissions', async()=>{
    const rows=setup();
    const result=await store.organizeStorage();
    expect(result.map(r=>r.Title)).toEqual(titles);
    expect(rows.map(r=>r.Id)).toEqual(ids);
    expect(rows.every(r=>r.ItemCount===7 && !r.Hidden && !r.OnQuickLaunch)).toBe(true);
    const writes=http.calls.filter(c=>c.method==='POST' && !c.url.includes('contextinfo'));
    expect(writes).toHaveLength(6);
    for(const write of writes) {
      expect(write.spMethod).toBe('MERGE');
      expect(Object.keys(JSON.parse(write.body)).sort()).toEqual(['Description','Hidden','OnQuickLaunch','Title']);
    }
  });
  it('reopens renamed storage in a fresh app instance', async()=>{
    setup(); await store.organizeStorage();
    const reopened=new SharePointStore({webUrl:WEB,fetchImpl:http});
    expect(await reopened.listExists('UncertaintySessions')).toBe(true);
    expect((await reopened.storageInventory()).map(r=>r.Title)).toEqual(titles);
  });
  it('upgrades hidden em-dash names from the previous release without creating containers', async()=>{
    const rows=setup(); rows.forEach((row,i)=>{row.Title=titles[i].replace(' - ',' — '); row.Hidden=true;});
    expect((await store.organizeStorage()).map(r=>r.Title)).toEqual(titles);
    expect(rows.every(r=>r.Hidden===false)).toBe(true);
    expect(http.find(/\/_api\/web\/lists$/)).toHaveLength(0);
  });
  it('performs no metadata writes when organization is already correct', async()=>{
    setup(); await store.organizeStorage();
    const writes=http.find(/lists\(guid'/).length;
    await store.organizeStorage();
    expect(http.find(/lists\(guid'/)).toHaveLength(writes);
  });
  it('rejects unconfirmed visibility rather than reporting success', async()=>{
    setup(); http.on(/lists\(guid'/,()=>({status:204}));
    await expect(store.organizeStorage()).rejects.toThrow();
  });
  it('does not retry a missing item write in another renamed container', async()=>{
    const rows=setup(); rows[1].Title=titles[1];
    http.on(/items\(999\)/,{status:404});
    await expect(store.post("/_api/web/lists/getbytitle('UncertaintyInstruments')/items(999)",{body:{Title:'test'}})).rejects.toThrow();
    expect(http.calls.filter(c=>c.method==='POST' && c.url.includes('Uncertalytics'))).toHaveLength(1);
  });
  it('refuses collisions before modifying any container', async()=>{
    setup();
    http.on(new RegExp(encodeURIComponent(titles[2])),{json:{Id:'another-list'}});
    await expect(store.organizeStorage()).rejects.toThrow(/separate list/);
    expect(http.find(/lists\(guid'/)).toHaveLength(0);
  });
  it('resumes after a partial rename without replacing containers', async()=>{
    const rows=setup(); let rejected=true;
    http.on(new RegExp(`lists\\(guid'${ids[1]}`), ({init})=>{
      if(rejected) { rejected=false; return {status:403}; }
      Object.assign(rows[1],JSON.parse(init.body)); return {status:204};
    });
    await expect(store.organizeStorage()).rejects.toThrow();
    expect(rows[0].Title).toBe(titles[0]);
    const reopened=new SharePointStore({webUrl:WEB,fetchImpl:http});
    expect((await reopened.organizeStorage()).map(r=>r.Title)).toEqual(titles);
    expect(rows.map(r=>r.Id)).toEqual(ids);
  });
  it('requires Manage Lists and never changes permission assignments', async()=>{
    setup(); http.on(/EffectiveBasePermissions/,{json:{Low:'3',High:'0'}});
    await expect(store.organizeStorage()).rejects.toThrow(/Manage Lists/);
    expect(http.calls.some(c=>c.method==='POST')).toBe(false);
  });
  it('does not redirect a missing record write when the original list exists', async()=>{
    setup(); http.on(/items\(999\)/,{status:404});
    await expect(store.post("/_api/web/lists/getbytitle('UncertaintyInstruments')/items(999)",{body:{Title:'test'}})).rejects.toThrow();
    expect(http.calls.some(c=>c.method==='POST' && c.url.includes('Uncertalytics'))).toBe(false);
  });
});
