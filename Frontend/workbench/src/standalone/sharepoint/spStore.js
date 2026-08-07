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

import { SharePointError, spGet, spGetText, spPost } from './spContext';

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

/**
 * SharePoint store. Constructed with the web URL and container prefix; `deps`
 * exists so tests can drive it with a fake fetch.
 */
export class SharePointStore {
  constructor({ webUrl, prefix = DEFAULT_PREFIX, fetchImpl = fetch } = {}) {
    this.webUrl = String(webUrl || '').replace(/\/+$/, '');
    this.prefix = prefix;
    this.fetchImpl = fetchImpl;
    this._folderCache = null;
  }

  get = (path) => spGet(this.webUrl, path, this.fetchImpl);
  post = (path, options) => spPost(this.webUrl, path, options, this.fetchImpl);

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

  async createField(title, field) {
    const api = `/_api/web/lists/getbytitle('${encodeURIComponent(title)}')`;
    const payload = { Title: field.name, FieldTypeKind: field.type, Indexed: Boolean(field.indexed) };
    if (field.type === FIELD_TYPE.NOTE) {
      payload.NumberOfLines = field.lines || 6;
      payload.RichText = false;
    }
    await this.post(`${api}/fields`, { body: payload });

    // SharePoint derives the internal name from Title at creation time, so the
    // field is created under its internal name and given its display name
    // afterwards. Renaming first would produce an internal name with escapes.
    if (field.title && field.title !== field.name) {
      await this.post(`${api}/fields/getbyinternalnameortitle('${encodeURIComponent(field.name)}')`, {
        method: 'MERGE',
        body: { Title: field.title },
      });
    }

    if (field.inView) {
      try {
        await this.post(`${api}/defaultView/viewfields/addviewfield('${encodeURIComponent(field.name)}')`, {});
      } catch {
        // A column missing from the default view is cosmetic; never abort
        // provisioning over it.
      }
    }
  }

  // -- sessions -------------------------------------------------------------

  async libraryFolder() {
    if (this._folderCache) return this._folderCache;
    const body = await this.get(`${listApi(this.prefix, 'sessions')}/RootFolder?$select=ServerRelativeUrl`);
    this._folderCache = body.ServerRelativeUrl;
    return this._folderCache;
  }

  fileName = (id) => `session-${id}.json`;

  async listSessions() {
    const select =
      '$select=SessionId,SessionName,Analyst,Organization,DocumentRef,DocumentDate,Modified' +
      '&$orderby=Modified desc&$top=500';
    const body = await this.get(`${listApi(this.prefix, 'sessions')}/items?${select}`);
    return (body.value || [])
      .filter((item) => item.SessionId !== null && item.SessionId !== undefined)
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
    const path = `/_api/web/getfilebyserverrelativeurl('${encodeURIComponent(`${folder}/${this.fileName(id)}`)}')/$value`;
    const text = await spGetText(this.webUrl, path, this.fetchImpl);
    try {
      return JSON.parse(text);
    } catch {
      throw new SharePointError(`Session ${id} is not valid JSON and may be corrupt.`, 200);
    }
  }

  async saveSession(doc) {
    const folder = await this.libraryFolder();
    const name = this.fileName(doc.id);
    const addPath =
      `/_api/web/getfolderbyserverrelativeurl('${encodeURIComponent(folder)}')` +
      `/files/add(url='${encodeURIComponent(name)}',overwrite=true)`;

    await this.post(addPath, {
      raw: true,
      body: JSON.stringify(doc),
      headers: { 'Content-Type': 'application/json' },
    });

    // Promote the picker's columns onto the file's list item.
    const itemPath =
      `/_api/web/getfilebyserverrelativeurl('${encodeURIComponent(`${folder}/${name}`)}')/ListItemAllFields`;
    await this.post(itemPath, {
      method: 'MERGE',
      body: {
        Title: doc.name || 'Untitled session',
        SessionId: doc.id,
        SessionName: doc.name || 'Untitled session',
        Analyst: doc.analyst || '',
        Organization: doc.organization || '',
        DocumentRef: doc.document || '',
        DocumentDate: doc.documentDate || '',
      },
    });

    return doc;
  }

  async deleteSession(id) {
    const folder = await this.libraryFolder();
    // recycle() rather than a hard delete, so a mistaken removal is
    // recoverable from the site recycle bin.
    const path = `/_api/web/getfilebyserverrelativeurl('${encodeURIComponent(`${folder}/${this.fileName(id)}`)}')/recycle()`;
    await this.post(path, {});
  }

  // -- generic record lists (instruments, equations, bug reports) ------------

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
