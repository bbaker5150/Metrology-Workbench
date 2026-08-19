// ---------------------------------------------------------------------------
// SharePoint-backed storage for the uncertainty tool.
// ---------------------------------------------------------------------------
// Shape follows the Django backend's own observation about this data: the
// module "treats a session as one deeply-nested document that it loads and
// saves whole", and its REST surface only ever wrote whole sessions. So a
// session is one JSON file in a document library rather than rows across ten
// lists, with the fields the session picker needs promoted to real columns so
// listing never downloads a payload.
//
// A multiline text column would have been simpler, but SharePoint caps a Note
// field well below the size a budget with many test points reaches, and the
// failure mode is a silently truncated — that is, corrupted — session.
//
// Instruments and equations are genuinely row-shaped and are lists.

import { getCurrentUser, SharePointError, spGet, spGetText, spPost } from './spContext';

export const LIST_TEMPLATE = { GENERIC: 100, LIBRARY: 101 };
export const FIELD_TYPE = { TEXT: 2, NOTE: 3, NUMBER: 9 };

/** Default container prefix; overridable so two instances can share a site. */
export const DEFAULT_PREFIX = 'Uncertainty';

export const CONTAINERS = [
  {
    key: 'sessions',
    suffix: 'Sessions',
    template: LIST_TEMPLATE.LIBRARY,
    description: 'Uncertainty budget sessions. Each file is one saved session document.',
    fields: [
      { name: 'SessionId', title: 'Session Id', type: FIELD_TYPE.NUMBER, indexed: true, inView: true },
      { name: 'SessionName', title: 'Session Name', type: FIELD_TYPE.TEXT, inView: true },
      { name: 'Analyst', title: 'Analyst', type: FIELD_TYPE.TEXT, inView: true },
      { name: 'Organization', title: 'Organization', type: FIELD_TYPE.TEXT, inView: true },
      { name: 'DocumentRef', title: 'Document', type: FIELD_TYPE.TEXT, inView: true },
      { name: 'DocumentDate', title: 'Document Date', type: FIELD_TYPE.TEXT, inView: true },
    ],
  },
  {
    key: 'instruments',
    suffix: 'Instruments',
    template: LIST_TEMPLATE.GENERIC,
    description: 'Shared instrument definitions available to every uncertainty session.',
    fields: [
      { name: 'RecordId', title: 'Record Id', type: FIELD_TYPE.TEXT, indexed: true, inView: true },
      { name: 'PayloadJson', title: 'Definition', type: FIELD_TYPE.NOTE, lines: 12 },
    ],
  },
  {
    key: 'equations',
    suffix: 'Equations',
    template: LIST_TEMPLATE.GENERIC,
    description: 'Custom uncertainty equations shared across sessions.',
    fields: [
      { name: 'RecordId', title: 'Record Id', type: FIELD_TYPE.TEXT, indexed: true, inView: true },
      { name: 'PayloadJson', title: 'Definition', type: FIELD_TYPE.NOTE, lines: 12 },
    ],
  },
  {
    key: 'bugReports',
    suffix: 'BugReports',
    template: LIST_TEMPLATE.GENERIC,
    description: 'Bug reports raised from the uncertainty tool.',
    fields: [
      { name: 'RecordId', title: 'Record Id', type: FIELD_TYPE.TEXT, indexed: true, inView: true },
      { name: 'PayloadJson', title: 'Report', type: FIELD_TYPE.NOTE, lines: 12 },
    ],
  },
];

// SP.AddFieldOptions, as a bit field.
const ADD_FIELD = {
  /** Take the internal name from `Name` instead of deriving it from the title. */
  INTERNAL_NAME_HINT: 8,
  /** Put the column in the list's default view. */
  TO_DEFAULT_VIEW: 16,
};

export function addFieldOptions(field) {
  return ADD_FIELD.INTERNAL_NAME_HINT | (field.inView ? ADD_FIELD.TO_DEFAULT_VIEW : 0);
}

const xmlAttr = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Field schema XML for one column.
 *
 * `Name` and `StaticName` are both set so the internal name is exactly what the
 * rest of this file addresses the column by; `DisplayName` is free to be
 * whatever reads well in the list UI.
 */
export function fieldSchemaXml(field) {
  const attrs = {
    Type: { [FIELD_TYPE.TEXT]: 'Text', [FIELD_TYPE.NOTE]: 'Note', [FIELD_TYPE.NUMBER]: 'Number' }[field.type],
    DisplayName: field.title || field.name,
    Name: field.name,
    StaticName: field.name,
  };
  if (!attrs.Type) throw new Error(`No schema XML for field type ${field.type}.`);

  // A Note column cannot be indexed or shown in a view the way the others can,
  // and rich text would mangle the JSON it holds.
  if (field.type === FIELD_TYPE.NOTE) {
    attrs.NumLines = field.lines || 6;
    attrs.RichText = 'FALSE';
    attrs.AppendOnly = 'FALSE';
  } else if (field.indexed) {
    attrs.Indexed = 'TRUE';
  }

  const pairs = Object.entries(attrs).map(([key, value]) => `${key}="${xmlAttr(value)}"`);
  return `<Field ${pairs.join(' ')} />`;
}

export function containerFor(key) {
  const found = CONTAINERS.find((c) => c.key === key);
  if (!found) throw new Error(`Unknown container '${key}'.`);
  return found;
}

/** List title from the configured prefix, stripped of characters SP rejects. */
export function listTitle(prefix, key) {
  const cleaned = String(prefix || DEFAULT_PREFIX).replace(/[^A-Za-z0-9]/g, '');
  return `${cleaned || DEFAULT_PREFIX}${containerFor(key).suffix}`;
}

const listApi = (prefix, key) => `/_api/web/lists/getbytitle('${encodeURIComponent(listTitle(prefix, key))}')`;

function normalizeUser(user) {
  const id = Number(user?.id ?? user?.Id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new SharePointError('SharePoint returned an invalid signed-in user.', 401);
  }
  return {
    id,
    loginName: user?.loginName ?? user?.LoginName ?? '',
    email: user?.email ?? user?.Email ?? '',
    title: user?.title ?? user?.Title ?? '',
  };
}

/** Stable owner identity used by the shared React code for local records. */
export function sharePointInstrumentOwnerKey(user) {
  const id = Number(user?.id ?? user?.Id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new SharePointError('SharePoint returned an invalid signed-in user.', 401);
  }
  return `sharepoint-user:${id}`;
}

/**
 * SharePoint store. Constructed with the web URL and container prefix; `deps`
 * exists so tests can drive it with a fake fetch.
 */
export class SharePointStore {
  constructor({ webUrl, prefix = DEFAULT_PREFIX, fetchImpl = fetch, currentUser } = {}) {
    this.webUrl = String(webUrl || '').replace(/\/+$/, '');
    this.prefix = prefix;
    this.fetchImpl = fetchImpl;
    this._folderCache = null;
    this._currentUser = currentUser ? normalizeUser(currentUser) : null;
    this._currentUserPromise = null;
    this._sessionFiles = new Map();
    this._sessionMetadata = new Map();
    this._imageFiles = new Map();
  }

  get = (path) => spGet(this.webUrl, path, this.fetchImpl);
  post = (path, options) => spPost(this.webUrl, path, options, this.fetchImpl);

  async currentUser() {
    if (this._currentUser) return this._currentUser;
    if (!this._currentUserPromise) {
      this._currentUserPromise = getCurrentUser(this.webUrl, this.fetchImpl)
        .then((user) => {
          this._currentUser = normalizeUser(user);
          return this._currentUser;
        })
        .catch((error) => {
          this._currentUserPromise = null;
          throw error;
        });
    }
    return this._currentUserPromise;
  }

  // -- provisioning ---------------------------------------------------------

  /**
   * Create any missing containers and columns.
   *
   * Idempotent and strictly additive: an existing container is left alone and
   * only absent fields are added. Nothing is deleted or retyped, because the
   * natural reaction to any storage error is to run setup again, and that must
   * never be able to damage real budgets.
   */
  async provision() {
    const steps = [];
    for (const container of CONTAINERS) {
      const title = listTitle(this.prefix, container.key);
      const exists = await this.listExists(title);

      if (!exists) {
        await this.post('/_api/web/lists', {
          body: {
            Title: title,
            Description: container.description,
            BaseTemplate: container.template,
            AllowContentTypes: false,
            ContentTypesEnabled: false,
          },
        });
        steps.push({ container: title, action: 'created' });
      } else {
        steps.push({ container: title, action: 'already-present' });
      }

      const existing = await this.fieldNames(title);
      for (const field of container.fields) {
        if (!existing.includes(field.name)) {
          await this.createField(title, field);
          steps.push({ container: title, action: 'field-added', field: field.name });
        }
      }
    }
    return { steps, alreadyProvisioned: steps.every((s) => s.action === 'already-present') };
  }

  async listExists(title) {
    try {
      await this.get(`/_api/web/lists/getbytitle('${encodeURIComponent(title)}')?$select=Id`);
      return true;
    } catch (error) {
      if (error instanceof SharePointError && error.status === 404) return false;
      throw error;
    }
  }

  async fieldNames(title) {
    const body = await this.get(
      `/_api/web/lists/getbytitle('${encodeURIComponent(title)}')/fields?$select=InternalName&$top=500`,
    );
    return (body.value || []).map((f) => f.InternalName);
  }

  /**
   * Add one column, described as Field schema XML.
   *
   * Posting a plain object to the `/fields` collection does not work: that
   * collection is polymorphic — SP.FieldText, SP.FieldNumber,
   * SP.FieldMultiLineText — so without an OData type annotation SharePoint
   * cannot tell what is being created and answers 400. Schema XML sidesteps the
   * question entirely by naming the type in the payload.
   *
   * It also collapses what used to be three requests into one. Internal name,
   * display name, and indexing are all set at creation, where the old JSON
   * route had to create the column under its internal name, rename it, and add
   * it to the default view separately — with the internal name derived from the
   * title, which is how a column ends up called `Session_x0020_Id`.
   */
  async createField(title, field) {
    const api = `/_api/web/lists/getbytitle('${encodeURIComponent(title)}')`;
    await this.post(`${api}/fields/createfieldasxml`, {
      verbose: true,
      body: {
        parameters: {
          __metadata: { type: 'SP.XmlSchemaFieldCreationInformation' },
          SchemaXml: fieldSchemaXml(field),
          Options: addFieldOptions(field),
        },
      },
    });
  }

  // -- sessions -------------------------------------------------------------

  async libraryFolder() {
    if (this._folderCache) return this._folderCache;
    const body = await this.get(`${listApi(this.prefix, 'sessions')}/RootFolder?$select=ServerRelativeUrl`);
    this._folderCache = body.ServerRelativeUrl;
    return this._folderCache;
  }

  fileName = (id, userId) => `session-${userId}-${id}.json`;

  imageFileName = (sessionId, imageId, userId) =>
    `image-${userId}-${sessionId}-${imageId}.json`;

  imageKey = (sessionId, imageId) => `${sessionId}:${imageId}`;

  async sessionFileName(id) {
    const cached = this._sessionFiles.get(Number(id));
    if (cached) return cached;
    const user = await this.currentUser();
    return this.fileName(id, user.id);
  }

  async scopedImageFileName(sessionId, imageId) {
    const cached = this._imageFiles.get(this.imageKey(sessionId, imageId));
    if (cached) return cached;
    const user = await this.currentUser();
    return this.imageFileName(sessionId, imageId, user.id);
  }

  rememberImageFile(sessionId, imageId, name) {
    this._imageFiles.set(this.imageKey(sessionId, imageId), name);
  }

  sessionMetadata(doc) {
    return {
      Title: doc.name || 'Untitled session',
      SessionId: Number(doc.id),
      SessionName: doc.name || 'Untitled session',
      Analyst: doc.analyst || '',
      Organization: doc.organization || '',
      DocumentRef: doc.document || '',
      DocumentDate: doc.documentDate || '',
    };
  }

  sessionMetadataSignature(metadata) {
    return JSON.stringify(metadata);
  }

  async listOwnedLibraryFileNames() {
    const user = await this.currentUser();
    const query =
      '$select=FileLeafRef,AuthorId&' +
      `$filter=AuthorId eq ${user.id}&$top=5000`;
    const body = await this.get(`${listApi(this.prefix, 'sessions')}/items?${query}`);
    return (body.value || []).map((item) => item.FileLeafRef).filter(Boolean);
  }

  async listSessions() {
    const user = await this.currentUser();
    const select =
      '$select=SessionId,SessionName,Analyst,Organization,DocumentRef,DocumentDate,Modified,FileLeafRef,AuthorId' +
      `&$filter=AuthorId eq ${user.id}&$orderby=Modified desc&$top=500`;
    const body = await this.get(`${listApi(this.prefix, 'sessions')}/items?${select}`);
    const seen = new Set();
    return (body.value || [])
      .filter((item) => {
        if (item.SessionId === null || item.SessionId === undefined) return false;
        const id = Number(item.SessionId);
        if (seen.has(id)) return false;
        seen.add(id);
        if (item.FileLeafRef) this._sessionFiles.set(id, item.FileLeafRef);
        this._sessionMetadata.set(
          id,
          this.sessionMetadataSignature({
            Title: item.SessionName || 'Untitled session',
            SessionId: id,
            SessionName: item.SessionName || 'Untitled session',
            Analyst: item.Analyst || '',
            Organization: item.Organization || '',
            DocumentRef: item.DocumentRef || '',
            DocumentDate: item.DocumentDate || '',
          }),
        );
        return true;
      })
      .map((item) => ({
        id: Number(item.SessionId),
        name: item.SessionName || 'Untitled session',
        analyst: item.Analyst || '',
        organization: item.Organization || '',
        document: item.DocumentRef || '',
        documentDate: item.DocumentDate || '',
        updated_at: item.Modified || '',
      }));
  }

  async getSession(id) {
    const folder = await this.libraryFolder();
    const name = await this.sessionFileName(id);
    const path = `/_api/web/getfilebyserverrelativeurl('${encodeURIComponent(`${folder}/${name}`)}')/$value`;
    const text = await spGetText(this.webUrl, path, this.fetchImpl);
    try {
      return JSON.parse(text);
    } catch {
      throw new SharePointError(`Session ${id} is not valid JSON and may be corrupt.`, 200);
    }
  }

  async saveSession(doc) {
    const folder = await this.libraryFolder();
    const name = await this.sessionFileName(doc.id);
    const addPath =
      `/_api/web/getfolderbyserverrelativeurl('${encodeURIComponent(folder)}')` +
      `/files/add(url='${encodeURIComponent(name)}',overwrite=true)`;

    await this.post(addPath, {
      raw: true,
      body: JSON.stringify(doc),
      headers: { 'Content-Type': 'application/json' },
    });

    // Promote picker columns only when they actually changed. Budget edits
    // rewrite the JSON frequently, while this small metadata set usually stays
    // identical. Avoiding a redundant tunneled MERGE prevents the embedded
    // SharePoint host from asking the user to approve the same metadata
    // mutation after every ordinary edit.
    const metadata = this.sessionMetadata(doc);
    const metadataSignature = this.sessionMetadataSignature(metadata);
    if (this._sessionMetadata.get(Number(doc.id)) !== metadataSignature) {
      const itemPath =
        `/_api/web/getfilebyserverrelativeurl('${encodeURIComponent(`${folder}/${name}`)}')/ListItemAllFields`;
      await this.post(itemPath, {
        method: 'MERGE',
        body: metadata,
      });
      this._sessionMetadata.set(Number(doc.id), metadataSignature);
    }

    this._sessionFiles.set(Number(doc.id), name);
    return doc;
  }

  async deleteSession(id) {
    const folder = await this.libraryFolder();
    const name = await this.sessionFileName(id);
    // recycle() rather than a hard delete, so a mistaken removal is
    // recoverable from the site recycle bin.
    const path = `/_api/web/getfilebyserverrelativeurl('${encodeURIComponent(`${folder}/${name}`)}')/recycle()`;
    await this.post(path, {});
    this._sessionFiles.delete(Number(id));
    this._sessionMetadata.delete(Number(id));
  }

  // -- generic record lists (instruments, equations, bug reports) ------------

  async instrumentRows(recordId) {
    const filter = recordId == null
      ? ''
      : `&$filter=RecordId eq '${String(recordId).replace(/'/g, "''")}'`;
    const body = await this.get(
      `${listApi(this.prefix, 'instruments')}/items?` +
      `$select=Id,RecordId,PayloadJson,AuthorId${filter}&$top=5000`,
    );
    return (body.value || []).map((item) => ({
      item,
      record: this.parsePayload(item, 'instruments'),
    })).filter(({ record }) => Boolean(record));
  }

  /**
   * Return every validated/shared definition plus only the signed-in user's
   * local definitions. AuthorId is the access boundary for legacy rows whose
   * payload still carries an old per-browser owner key.
   */
  async listInstruments() {
    const user = await this.currentUser();
    const owner = sharePointInstrumentOwnerKey(user);
    const rows = await this.instrumentRows();
    return rows.flatMap(({ item, record }) => {
      if (record.scope !== 'local') return [record];
      if (Number(item.AuthorId) !== user.id) return [];
      return [{ ...record, scope: 'local', owner }];
    });
  }

  async saveInstrument(record) {
    const recordId = String(record?.id ?? '');
    if (!recordId) throw new Error('Cannot save an instruments record with no id.');

    const user = await this.currentUser();
    const scope = record.scope === 'validated' ? 'validated' : 'local';
    const { password: _password, ...safeRecord } = record;
    const canonical = scope === 'local'
      ? { ...safeRecord, scope, owner: sharePointInstrumentOwnerKey(user) }
      : { ...safeRecord, scope };
    const rows = await this.instrumentRows(recordId);
    const existing = rows.find(({ item, record: candidate }) =>
      scope === 'local'
        ? candidate.scope === 'local' && Number(item.AuthorId) === user.id
        : candidate.scope !== 'local',
    );
    const fields = {
      Title: String(canonical.name || canonical.description || canonical.model || recordId).slice(0, 255),
      RecordId: recordId,
      PayloadJson: JSON.stringify(canonical),
    };

    if (existing) {
      await this.post(`${listApi(this.prefix, 'instruments')}/items(${existing.item.Id})`, {
        method: 'MERGE',
        body: fields,
      });
    } else {
      await this.post(`${listApi(this.prefix, 'instruments')}/items`, { body: fields });
    }

    // A successful sync replaces this user's linked local working copy while
    // leaving every other user's local copy untouched.
    if (scope === 'validated') {
      const sourceId = String(canonical.sourceId || canonical.id);
      // The local copy normally has its own RecordId, so search the whole
      // instrument list by sourceId rather than only the shared record's id.
      const cleanupRows = await this.instrumentRows();
      const ownLinkedLocals = cleanupRows.filter(({ item, record: candidate }) =>
        candidate.scope === 'local' &&
        Number(item.AuthorId) === user.id &&
        String(candidate.sourceId || '') === sourceId,
      );
      await Promise.all(
        ownLinkedLocals.map(({ item }) =>
          this.post(`${listApi(this.prefix, 'instruments')}/items(${item.Id})`, {
            method: 'DELETE',
          }),
        ),
      );
    }
    return canonical;
  }

  async deleteInstrument(recordId) {
    const user = await this.currentUser();
    const rows = await this.instrumentRows(recordId);
    const ownLocal = rows.find(({ item, record }) =>
      record.scope === 'local' && Number(item.AuthorId) === user.id,
    );
    const shared = rows.find(({ record }) => record.scope !== 'local');
    const target = ownLocal || shared;
    // Another user's local row is intentionally indistinguishable from an
    // absent record and can never be deleted through the app.
    if (!target) return;
    await this.post(`${listApi(this.prefix, 'instruments')}/items(${target.item.Id})`, {
      method: 'DELETE',
    });
  }

  async listRecords(key) {
    const body = await this.get(`${listApi(this.prefix, key)}/items?$select=Id,RecordId,PayloadJson&$top=5000`);
    return (body.value || []).map((item) => this.parsePayload(item, key)).filter(Boolean);
  }

  parsePayload(item, key) {
    if (!item.PayloadJson) return null;
    try {
      return JSON.parse(item.PayloadJson);
    } catch {
      // One unreadable row must not take down the whole library listing.
      console.warn(`[uncertainty] Skipping unreadable ${key} record ${item.RecordId}.`);
      return null;
    }
  }

  async findItemId(key, recordId) {
    const filter = `$filter=RecordId eq '${String(recordId).replace(/'/g, "''")}'&$select=Id&$top=1`;
    const body = await this.get(`${listApi(this.prefix, key)}/items?${filter}`);
    return body.value?.length ? body.value[0].Id : undefined;
  }

  async saveRecord(key, record) {
    const recordId = String(record.id ?? record.report_id ?? record.equation_id ?? '');
    if (!recordId) throw new Error(`Cannot save a ${key} record with no id.`);

    const existingId = await this.findItemId(key, recordId);
    const fields = {
      Title: String(record.name || record.title || recordId).slice(0, 255),
      RecordId: recordId,
      PayloadJson: JSON.stringify(record),
    };

    if (existingId) {
      await this.post(`${listApi(this.prefix, key)}/items(${existingId})`, { method: 'MERGE', body: fields });
    } else {
      await this.post(`${listApi(this.prefix, key)}/items`, { body: fields });
    }
    return record;
  }

  async deleteRecord(key, recordId) {
    const existingId = await this.findItemId(key, recordId);
    // Deleting something already gone is not an error worth surfacing.
    if (!existingId) return;
    await this.post(`${listApi(this.prefix, key)}/items(${existingId})`, { method: 'DELETE' });
  }
}
