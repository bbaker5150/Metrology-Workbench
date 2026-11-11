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

import { buildValidatedSnapshot } from "../../modules/uncertainty/utils/instrumentSync";
import { getCurrentUser, SharePointError, spGet, spGetText, spPost } from './spContext';

export const LIST_TEMPLATE = { GENERIC: 100, LIBRARY: 101 };
export const FIELD_TYPE = { TEXT: 2, NOTE: 3, NUMBER: 9 };

/** Default container prefix; overridable so two instances can share a site. */
export const DEFAULT_PREFIX = 'Uncertainty';
export const isArchived = (record) => Boolean(record?._uncertaintyArchive?.at);
const isPublished = record => ['validated', 'shared'].includes(record?.scope);
function publishedDefinition(record) {
  const { _uncertaintyApprovals, _uncertaintyArchive, _uncertaintyApprovalClaim, formerPublicationId, ...definition } = record;
  return { ...definition, scope: 'validated' };
}
const reviewVersionOf = ({item, record}) => String(record._uncertaintyApprovalClaim?.version ?? item.owshiddenversion);
function privateDefinition(record) {
  const {_uncertaintyApprovalClaim, ...definition} = record;
  return definition;
}
// The private draft's native item ID in the publication receipt identifies the
// submitter even for approvals made before removal supported a Local copy.
// Migrated publications have an author-owned row in the original list instead.
function localFromPublication({ item, record }, submittedDraft, legacy, owner) {
  const approvedDraft = submittedDraft && String(submittedDraft.record.id) === String(record.id) &&
    record._uncertaintyApprovals?.[submittedDraft.item.Id];
  const migratedOriginal = isPublished(legacy?.record) && String(legacy.record.id) === String(record.id);
  if (!approvedDraft && !migratedOriginal) return null;
  const id = `local-from-publication-${item.Id}`;
  return {
    ...publishedDefinition(record), id, libraryInstrumentId: id, formerPublicationId: record.id,
    scope: 'local', owner, sourceId: '', validatedSnapshot: null, localOverride: true,
  };
}
function draftsWithoutApproval(drafts, catalog) {
  const publications = new Map(catalog.map(({record}) => [String(record.id), record]));
  return drafts.filter(({record, item}) => {
    if (isArchived(record)) return false;
    const publication = publications.get(String(record.sourceId || record.id));
    // Publication can commit before the version-checked draft cleanup.
    // A newer pending revision is still a real submission.
    return record.scope !== 'pending' || publication?._uncertaintyApprovals?.[item.Id] !== reviewVersionOf({item, record});
  });
}
const instrumentAccess = {
  instruments: { ReadSecurity: 2, WriteSecurity: 4 },
  instrumentDrafts: { ReadSecurity: 2, WriteSecurity: 2 },
  publishedInstruments: { ReadSecurity: 1, WriteSecurity: 4 },
};
// Only a list manager can add this field. Its presence certifies a completed
// migration, including sites whose old mixed list contained no shared rows.
const migrationMarker = { name: 'LegacyCatalogMigratedV1', title: 'Legacy catalog migration completed', type: FIELD_TYPE.TEXT };
const diagnosticText = value => String(value ?? 'unknown').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 180);
const permissionFlags = result => {
  const permissions = result?.EffectiveBasePermissions || result;
  const low = Number(permissions?.Low);
  if (permissions?.Low == null || String(permissions.Low).trim() === '' || !Number.isInteger(low) || low < 0) throw new SharePointError('SharePoint returned incomplete list permissions.', 502);
  return { low, high: permissions.High, viewItems: Boolean(low & 1), manageLists: Boolean(low & 2048) };
};
const diagnosticFailure = error => {
  const status = Number(error?.status ?? error?.httpStatus);
  const requestId = /^[a-f\d-]{8,80}$/i.test(String(error?.requestId || '')) ? error.requestId : null;
  // Never copy a response body/message: it can contain payloads or URL tokens.
  return `Unavailable (${Number.isInteger(status) && status > 0 ? `HTTP ${status}` : 'request failed'}${requestId ? `; Request ID ${requestId}` : ''})`;
};

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
    description: 'Original instrument records, retained with native author-only read access.',
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
  {
    key: 'instrumentDrafts',
    suffix: 'InstrumentDrafts',
    template: LIST_TEMPLATE.GENERIC,
    description: 'Private instrument definitions and submissions awaiting SME validation.',
    fields: [
      // SharePoint forbids unique fields on a list with author-only reads.
      { name: 'RecordId', title: 'Record Id', type: FIELD_TYPE.TEXT, indexed: true, inView: true },
      { name: 'PayloadJson', title: 'Definition', type: FIELD_TYPE.NOTE, lines: 12 },
      { name: 'SubmittedJson', title: 'Submitted definition', type: FIELD_TYPE.NOTE, lines: 12 },
    ],
  },
  {
    key: 'publishedInstruments',
    suffix: 'PublishedInstruments',
    template: LIST_TEMPLATE.GENERIC,
    description: 'Validated instruments available to every uncertainty session.',
    fields: [
      { name: 'RecordId', title: 'Record Id', type: FIELD_TYPE.TEXT, indexed: true, inView: true },
      { name: 'PublicationKey', title: 'Publication key', type: FIELD_TYPE.TEXT, indexed: true, unique: true },
      { name: 'PayloadJson', title: 'Definition', type: FIELD_TYPE.NOTE, lines: 12 },
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
  if (field.unique) attrs.EnforceUniqueValues = 'TRUE';
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

export function storageDisplayTitle(prefix, key) {
  const app = !prefix || prefix === DEFAULT_PREFIX ? 'Uncertalytics' : String(prefix).replace(/[^A-Za-z0-9]/g, '') || 'Uncertalytics';
  const labels = { bugReports: 'Bug Reports', instrumentDrafts: 'Instrument Drafts', publishedInstruments: 'Published Instruments' };
  return `${app} - ${labels[key] || containerFor(key).suffix}`;
}
const storageDescription = container => `Managed by Uncertalytics. ${container.description} Use the app to edit records; manage access through SharePoint permissions.`;

const listApi = (prefix, key) => `/_api/web/lists/getbytitle('${encodeURIComponent(listTitle(prefix, key))}')`;

const formValuesFor = (fields = {}) =>
  Object.entries(fields).map(([FieldName, value]) => ({
    FieldName,
    FieldValue: value === null || value === undefined ? '' : String(value),
  }));

const assertFormUpdateSucceeded = (result, context) => {
  const rows = result?.value || result?.d?.ValidateUpdateListItem?.results || [];
  const failures = rows.filter((row) => row?.HasException || row?.ErrorMessage);
  if (failures.length === 0) return;

  const detail = failures
    .map((row) => `${row.FieldName || 'Field'}: ${row.ErrorMessage || 'update rejected'}`)
    .join('; ');
  throw new SharePointError(`${context} was rejected by SharePoint. ${detail}`, 400, detail);
};

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
  constructor({ webUrl, prefix = DEFAULT_PREFIX, fetchImpl = fetch, currentUser, libraryPassword = 'calibrate' } = {}) {
    this.webUrl = String(webUrl || '').replace(/\/+$/, '');
    this.prefix = prefix;
    // Match the standard library confirmation password. SharePoint's own
    // permissions remain the access boundary for this browser-only build.
    this.libraryPassword = libraryPassword;
    this.fetchImpl = fetchImpl;
    this._folderCache = null;
    this._storageTitles = new Map();
    this._currentUser = currentUser ? normalizeUser(currentUser) : null;
    this._currentUserPromise = null;
    this._sessionFiles = new Map();
    this._sessionMetadata = new Map();
    this._imageFiles = new Map();
  }

  async storageRequest(path, send) {
    let resolved = path;
    for (const container of CONTAINERS) {
      const original = listApi(this.prefix, container.key);
      if (!path.startsWith(original)) continue;
      const known = this._storageTitles.get(container.key);
      if (known) resolved = path.replace(original, `/_api/web/lists/getbytitle('${encodeURIComponent(known)}')`);
      try { return await send(resolved); }
      catch (error) {
        if (error.status !== 404 || known) throw error;
        // A missing item must never redirect a write to another container.
        let missingContainer = false;
        try { await spGet(this.webUrl, `${original}?$select=Id`, this.fetchImpl); }
        catch (lookupError) { if (lookupError.status === 404) missingContainer = true; else throw lookupError; }
        if (!missingContainer) throw error;
        // Support both previous display names and the common App - Content
        // convention. Probe the container before replaying a request: an item
        // 404 must never cause a write to fall through to another container.
        const currentTitle = storageDisplayTitle(this.prefix, container.key);
        const aliases = [currentTitle, currentTitle.replace(' - ', ' — ')];
        for (const title of aliases) {
          const api = `/_api/web/lists/getbytitle('${encodeURIComponent(title)}')`;
          try { await spGet(this.webUrl, `${api}?$select=Id`, this.fetchImpl); }
          catch (lookupError) { if (lookupError.status === 404) continue; throw lookupError; }
          this._storageTitles.set(container.key, title);
          return send(path.replace(original, api));
        }
        throw error;
      }
    }
    return send(resolved);
  }
  get = path => this.storageRequest(path, resolved => spGet(this.webUrl, resolved, this.fetchImpl));
  post = (path, options) => this.storageRequest(path, resolved => spPost(this.webUrl, resolved, options, this.fetchImpl));

  async canManageStorage() {
    const result = await this.get('/_api/web/EffectiveBasePermissions');
    const permissions = result.EffectiveBasePermissions || result;
    return (Number(permissions.Low) & 2048) !== 0;
  }

  async storageInventory() {
    return Promise.all(CONTAINERS.map(async container => {
      const info = await this.get(`${listApi(this.prefix, container.key)}?$select=Id,Title,Description,Hidden,OnQuickLaunch,DefaultViewUrl,ItemCount`);
      return { ...container, ...info, displayTitle: storageDisplayTitle(this.prefix, container.key) };
    }));
  }

  /** Read-only, content-free diagnostics for comparing two signed-in accounts. */
  async instrumentAccessReport() {
    let web = 'unavailable';
    try {
      const url = new URL(this.webUrl);
      if (['https:', 'http:'].includes(url.protocol)) web = `${url.origin}${url.pathname}`;
    } catch { /* Do not echo an unparseable URL that could contain credentials. */ }
    const prefix = String(this.prefix || DEFAULT_PREFIX).replace(/[^A-Za-z0-9]/g, '') || DEFAULT_PREFIX;
    const capture = async read => { try { return { value: await read() }; } catch (error) { return { error }; } };
    const [identity, membership, smeGroup] = await Promise.all([
      capture(() => this.currentUser()),
      capture(() => this.getItems('/_api/web/currentuser/groups?$select=Title', { requireRows: true })),
      capture(async () => {
        const result = await this.get("/_api/web/sitegroups?$select=Title&$filter=Title eq 'Uncertalytics SME'&$top=1");
        if (!Array.isArray(result?.value)) throw new SharePointError('Incomplete group lookup.', 502);
        return result.value.length ? true
          : result['odata.nextLink'] || result['@odata.nextLink'] ? null : false;
      }),
    ]);
    const relevant = ['Metrology App Users', 'Metrology App User', 'Metrology Software Owners', 'Uncertalytics SME'];
    const groups = membership.value?.filter(group => relevant.includes(group.Title)).map(group => group.Title) || [];
    const eligible = membership.error ? null : groups.includes('Uncertalytics SME') ? true
      : !groups.includes('Metrology Software Owners') ? false : smeGroup.error || smeGroup.value === null ? null : !smeGroup.value;
    const lines = [
      'Uncertalytics instrument access report (read only)',
      `Site URL: ${diagnosticText(web)}`,
      `List prefix: ${prefix}`,
      `Signed-in user: ${identity.error ? diagnosticFailure(identity.error) : `${identity.value.id} — ${diagnosticText(identity.value.title)}`}`,
      `Relevant groups: ${membership.error ? diagnosticFailure(membership.error) : groups.join(', ') || 'none'}`,
      `Uncertalytics SME group: ${smeGroup.error ? diagnosticFailure(smeGroup.error) : smeGroup.value === null ? 'Unknown (incomplete lookup)' : smeGroup.value ? 'Exists; interim Owners review access has ended.' : 'Absent; Owners interim review access is available.'}`,
      `Reviewer group eligibility: ${eligible === null ? 'Unknown; could not verify.' : eligible ? 'Yes (list permissions must also allow review).' : 'No.'}`,
    ];
    const checks = await Promise.all(Object.entries(instrumentAccess).map(async ([key, expected]) => {
      const path = listApi(this.prefix, key);
      const [metadata, access] = await Promise.all([
        capture(() => this.get(`${path}?$select=Id,Title,ReadSecurity,WriteSecurity,HasUniqueRoleAssignments,EnableModeration,DraftVersionVisibility`)),
        capture(async () => permissionFlags(await this.get(`${path}/EffectiveBasePermissions`))),
      ]);
      const block = ['', storageDisplayTitle(this.prefix, key)];
      if (metadata.error) block.push(`  List settings: ${diagnosticFailure(metadata.error)}`);
      else {
        const data = metadata.value;
        block.push(`  Actual list: ${diagnosticText(data.Title)}; ID ${diagnosticText(data.Id)}`,
          `  ReadSecurity: ${diagnosticText(data.ReadSecurity)}; WriteSecurity: ${diagnosticText(data.WriteSecurity)}`,
          `  HasUniqueRoleAssignments: ${diagnosticText(data.HasUniqueRoleAssignments)}`,
          `  EnableModeration: ${diagnosticText(data.EnableModeration)}; DraftVersionVisibility: ${diagnosticText(data.DraftVersionVisibility)}`);
        if (!this.matchesAccess(data, expected)) block.push(`  Check list settings: expected ReadSecurity ${expected.ReadSecurity}, WriteSecurity ${expected.WriteSecurity}.`);
        if (data.HasUniqueRoleAssignments === true) block.push('  This list has unique permissions; site-level group access may not apply.');
        if (data.EnableModeration === true) block.push('  SharePoint content approval is enabled. App validation does not approve SharePoint moderation; pending items may be hidden from readers.');
      }
      if (access.error) block.push(`  Effective permissions: ${diagnosticFailure(access.error)}`);
      else {
        const flags = access.value;
        block.push(`  Effective permissions: Low ${flags.low}; High ${diagnosticText(flags.high)}; ViewListItems ${flags.viewItems ? 'Yes' : 'No'}; ManageLists ${flags.manageLists ? 'Yes' : 'No'}`);
        if (!flags.viewItems) block.push('  Missing ViewListItems: this account cannot read this list. Ask a list owner to check its group grants.');
        if (key === 'instrumentDrafts' && eligible && !flags.manageLists) block.push('  Review blocked: this eligible reviewer needs Manage Lists on Instrument Drafts to see submissions by other users.');
      }
      return block;
    }));
    lines.push(...checks.flat(), '',
      'Compare Site URL, List prefix and actual list IDs in reports from both accounts. Different values mean the accounts are using different storage.',
      'No instrument contents were read. Individual-item permissions were not checked. No permissions, groups or list settings were changed.');
    return lines.join('\n');
  }

  async organizeStorage() {
    if (!(await this.canManageStorage())) throw new Error('A site owner or someone with Manage Lists permission must organize this storage.');
    const inventory = await this.storageInventory();
    // Check every destination before updating anything. Never replace another list.
    for (const container of inventory) {
      if (container.Title === container.displayTitle) continue;
      try {
        const other = await spGet(this.webUrl, `/_api/web/lists/getbytitle('${encodeURIComponent(container.displayTitle)}')?$select=Id`, this.fetchImpl);
        if (other.Id !== container.Id) throw new Error(`A separate list named ${container.displayTitle} already exists. Ask a site owner to resolve the duplicate; no lists were deleted.`);
      } catch (error) { if (error.status !== 404) throw error; }
    }
    for (const container of inventory) {
      if (!/^[0-9a-f-]{36}$/i.test(container.Id || '')) throw new Error('SharePoint returned an invalid storage identifier. No replacement list will be created.');
      if (container.Title === container.displayTitle && container.Hidden === false && container.OnQuickLaunch === false && container.Description === storageDescription(container)) continue;
      await this.post(`/_api/web/lists(guid'${container.Id}')`, {
        headers: { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' },
        body: { Title: container.displayTitle, Description: storageDescription(container), Hidden: false, OnQuickLaunch: false },
      });
      this._storageTitles.set(container.key, container.displayTitle);
    }
    const verified = await this.storageInventory();
    for (const container of verified) {
      const before = inventory.find(row => row.key === container.key);
      if (container.Id !== before.Id || container.Title !== container.displayTitle || container.Hidden !== false || container.OnQuickLaunch !== false) {
        throw new Error(`Could not verify visible storage for ${container.displayTitle}. Reload and retry; existing data was not replaced.`);
      }
    }
    return verified;
  }

  async getItems(path, { requireRows = false } = {}) {
    const items = [];
    while (path) {
      const body = await this.get(path);
      const rows = body.value || body.d?.results;
      if (requireRows && !Array.isArray(rows)) throw new SharePointError('SharePoint returned an incomplete instrument listing.', 502);
      items.push(...(rows || []));
      const next = body['odata.nextLink'] || body['@odata.nextLink'] || body.d?.__next;
      if (!next) break;
      const url = new URL(next, `${this.webUrl}${path}`);
      if (!url.href.startsWith(`${this.webUrl}/`)) throw new SharePointError('SharePoint returned an unexpected paging URL.', 500);
      path = url.href.slice(this.webUrl.length);
    }
    return items;
  }

  async updateListItem(key, itemId, fields) {
    const result = await this.post(
      `${listApi(this.prefix, key)}/items(${itemId})/ValidateUpdateListItem()`,
      {
        body: {
          formValues: formValuesFor(fields),
          bNewDocumentUpdate: false,
        },
      },
    );
    assertFormUpdateSucceeded(result, `Updating ${listTitle(this.prefix, key)} item ${itemId}`);
    return result;
  }

  async updateFileListItem(folder, name, fields) {
    const itemPath =
      `/_api/web/getfilebyserverrelativeurl('${encodeURIComponent(`${folder}/${name}`)}')` +
      '/ListItemAllFields?$select=Id';
    const item = await this.get(itemPath);
    const itemId = Number(item?.Id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      throw new SharePointError(
        `SharePoint returned no list item for session file ${name}.`,
        500,
      );
    }
    return this.updateListItem('sessions', itemId, fields);
  }

  async archivedRecord(record) {
    if (isArchived(record)) return record;
    const user = await this.currentUser();
    return { ...record, _uncertaintyArchive: { at: new Date().toISOString(), userId: user.id } };
  }

  async archiveListItem(key, item) {
    const record = this.parsePayload(item, key);
    if (!record) throw new SharePointError('Cannot archive an unreadable record.', 400);
    if (isArchived(record)) return;
    const payload = JSON.stringify(await this.archivedRecord(record));
    const fields = { PayloadJson: payload };
    if (key === 'instrumentDrafts' && item.SubmittedJson) fields.SubmittedJson = payload;
    await this.updateListItem(key, item.Id, fields);
  }

  // Removal from the app is a normal content update. The original data remains
  // in SharePoint; no delete/recycle operation or bulk-delete permission is used.
  async archiveJsonFile(name) {
    const folder = await this.libraryFolder();
    const readPath = `/_api/web/getfilebyserverrelativeurl('${encodeURIComponent(`${folder}/${name}`)}')/$value`;
    let record;
    try {
      record = JSON.parse(await spGetText(this.webUrl, readPath, this.fetchImpl));
    } catch (error) {
      if (error instanceof SharePointError && error.status === 404) return null;
      throw error;
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new SharePointError('Cannot archive an invalid JSON document.', 400);
    if (!isArchived(record)) {
      await this.post(
        `/_api/web/getfolderbyserverrelativeurl('${encodeURIComponent(folder)}')/files/add(url='${encodeURIComponent(name)}',overwrite=true)`,
        { raw: true, body: JSON.stringify(await this.archivedRecord(record)), headers: { 'Content-Type': 'application/json' } },
      );
    }
    return record;
  }

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
   * Existing records and field IDs survive interrupted and repeated setup.
   */
  async provision() {
    const steps = [];
    this._instrumentSecurityReady = false;
    for (const container of CONTAINERS) {
      const title = listTitle(this.prefix, container.key);
      const exists = await this.listExists(title);

      if (!exists) {
        await this.post('/_api/web/lists', {
          body: {
            Title: storageDisplayTitle(this.prefix, container.key),
            Description: storageDescription(container),
            Hidden: false,
            OnQuickLaunch: false,
            BaseTemplate: container.template,
            AllowContentTypes: false,
            ContentTypesEnabled: false,
          },
        });
        this._storageTitles.set(container.key, storageDisplayTitle(this.prefix, container.key));
        steps.push({ container: title, action: 'created' });
      } else {
        steps.push({ container: title, action: 'already-present' });
      }

      // Restrict the old mixed list in place before any record is copied.
      // Original author IDs, versions and item IDs stay on that list.
      const requiredAccess = instrumentAccess[container.key];
      if (requiredAccess) {
        const path = listApi(this.prefix, container.key);
        if (exists && container.key === 'instrumentDrafts') {
          // Repair sites that created the previous unique field before native
          // own-item permissions were applied. Keep its index and all values.
          const fields = await this.get(`${path}/fields?$select=InternalName,EnforceUniqueValues&$filter=InternalName eq 'RecordId'`);
          if (fields.value?.some(field => field.InternalName === 'RecordId' && field.EnforceUniqueValues === true)) {
            await this.post(`${path}/fields/getbyinternalnameortitle('RecordId')`, {
              headers: { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' }, body: { EnforceUniqueValues: false },
            });
            steps.push({ container: title, field: 'RecordId', action: 'unique-constraint-removed' });
          }
        }
        const current = await this.get(`${path}?$select=ReadSecurity,WriteSecurity`);
        if (!this.matchesAccess(current, requiredAccess)) {
          await this.post(path, { headers: { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' }, body: requiredAccess });
          steps.push({ container: title, action: 'access-updated' });
        }
      }
      const existing = await this.fieldNames(title);
      for (const field of container.fields) {
        if (!existing.includes(field.name)) {
          await this.createField(title, field);
          steps.push({ container: title, action: 'field-added', field: field.name });
        }
      }
    }
    await this.checkInstrumentAccess();
    const publishedTitle = listTitle(this.prefix, 'publishedInstruments');
    if (!(await this.fieldNames(publishedTitle)).includes(migrationMarker.name)) {
      await this.migratePublishedInstruments();
      await this.createField(publishedTitle, migrationMarker);
      steps.push({ container: publishedTitle, action: 'legacy-catalog-migrated' });
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
    const items = await this.getItems(`${listApi(this.prefix, 'sessions')}/items?${query}`);
    return items.filter(item => Number(item.AuthorId) === user.id).map((item) => item.FileLeafRef).filter(Boolean);
  }

  async listSessions() {
    const user = await this.currentUser();
    const select =
      '$select=SessionId,SessionName,Analyst,Organization,DocumentRef,DocumentDate,Modified,FileLeafRef,AuthorId' +
      `&$filter=AuthorId eq ${user.id}&$orderby=Modified desc&$top=500`;
    const items = await this.getItems(`${listApi(this.prefix, 'sessions')}/items?${select}`);
    const seen = new Set();
    return items
      .filter((item) => {
        if (Number(item.AuthorId) !== user.id) return false;
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
      const doc = JSON.parse(text);
      return isArchived(doc) ? null : doc;
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
    // identical. ValidateUpdateListItem is a regular POST rather than a
    // tunneled MERGE, so embedded SharePoint hosts do not interrupt users with
    // a mutation-method confirmation for this already validated operation.
    const metadata = this.sessionMetadata(doc);
    const metadataSignature = this.sessionMetadataSignature(metadata);
    if (this._sessionMetadata.get(Number(doc.id)) !== metadataSignature) {
      await this.updateFileListItem(folder, name, metadata);
      this._sessionMetadata.set(Number(doc.id), metadataSignature);
    }

    this._sessionFiles.set(Number(doc.id), name);
    return doc;
  }

  async deleteSession(id) {
    const folder = await this.libraryFolder();
    const name = await this.sessionFileName(id);
    const record = await this.archiveJsonFile(name);
    // Keep the full JSON and descriptive metadata, but remove the picker key.
    // getSession also filters the marker if this metadata update is interrupted.
    if (record) await this.updateFileListItem(folder, name, { SessionId: null });
    this._sessionFiles.delete(Number(id));
    this._sessionMetadata.delete(Number(id));
  }

  // -- generic record lists (instruments, equations, bug reports) ------------

  matchesAccess(current, expected) {
    return current.ReadSecurity === expected.ReadSecurity && current.WriteSecurity === expected.WriteSecurity;
  }

  async checkInstrumentAccess() {
    await Promise.all(Object.entries(instrumentAccess).map(async ([key, expected]) => {
      const current = await this.get(`${listApi(this.prefix, key)}?$select=ReadSecurity,WriteSecurity`);
      if (!this.matchesAccess(current, expected)) {
        throw new SharePointError(`Ask a site owner to finish instrument setup. ${storageDisplayTitle(this.prefix, key)} needs its instrument access settings applied.`, 403);
      }
    }));
  }

  async ensureInstrumentSecurity() {
    if (this._instrumentSecurityReady) return;
    await this.checkInstrumentAccess();
    const [catalogFields, draftFields] = await Promise.all(['publishedInstruments','instrumentDrafts'].map(key =>
      this.fieldNames(listTitle(this.prefix, key))));
    if (!catalogFields.includes(migrationMarker.name) || !draftFields.includes('SubmittedJson')) {
      throw new SharePointError('Ask a site owner to finish migrating the shared instrument library.', 403);
    }
    this._instrumentSecurityReady = true;
  }

  async migratePublishedInstruments() {
    // Native author-only reads otherwise return a plausible but incomplete set.
    const legacy = listApi(this.prefix, 'instruments');
    const permissions = await this.get(`${legacy}/EffectiveBasePermissions`);
    if (!(Number((permissions.EffectiveBasePermissions || permissions).Low) & 2048)) {
      throw new SharePointError('A site owner with Manage Lists on the original Instruments list must migrate the shared library.', 403);
    }
    const rows = await this.getItems(`${legacy}/items?$select=Id,RecordId,PayloadJson&$top=5000`);
    const published = listApi(this.prefix, 'publishedInstruments');
    const existing = new Set((await this.getItems(`${published}/items?$select=PublicationKey&$top=5000`)).map(row => row.PublicationKey));
    const seen = new Set();
    for (const row of rows) {
      const record = this.parsePayload(row, 'instruments');
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new SharePointError(`The original Instruments item ${row.Id} has an unreadable definition. Repair it and run setup again.`, 409);
      }
      if (!isPublished(record) || isArchived(record)) continue;
      const id = String(record.id ?? '');
      if (!id || seen.has(id)) throw new SharePointError(`The original Instruments item ${row.Id} needs a unique instrument ID. Repair it and run setup again.`, 409);
      seen.add(id);
      if (existing.has(id)) continue;
      try {
        await this.post(`${published}/items`, { body: {
          Title: String(record.description || record.model || id).slice(0, 255),
          RecordId: id, PublicationKey: id, PayloadJson: JSON.stringify(publishedDefinition(record)),
        } });
      } catch (error) {
        // Another setup may have inserted the unique public key, or the
        // server may have committed this request before the connection failed.
        if (!(await this.instrumentRows('publishedInstruments', id)).some(({item, record}) =>
          item.RecordId === id && String(record.id) === id && isPublished(record))) throw error;
      }
    }
  }

  async instrumentRows(key, recordId, authorId) {
    const conditions = [];
    if (recordId != null) conditions.push(`RecordId eq '${String(recordId).replace(/'/g, "''")}'`);
    if (authorId != null) conditions.push(`AuthorId eq ${Number(authorId)}`);
    const filter = conditions.length ? `&$filter=${conditions.join(' and ')}` : '';
    const submitted = key === 'instrumentDrafts' ? ',SubmittedJson' : '';
    const items = await this.getItems(`${listApi(this.prefix, key)}/items?$select=Id,RecordId,PayloadJson,AuthorId,owshiddenversion${submitted}${filter}&$top=5000`, {requireRows:true});
    const rows = items.map(item => ({ item, record: this.parsePayload(item, key) })).filter(row => row.record);
    if (key !== 'instrumentDrafts') return rows;
    // Item IDs have a stable native order even when two tabs create the same
    // author/record pair. All reads, reviews, edits and tombstones use its first
    // row. A later duplicate never reappears after the first is archived.
    const first = new Map();
    for (const row of rows) {
      const identity = `${row.item.AuthorId}:${row.item.RecordId}`;
      const previous = first.get(identity);
      if (!previous || Number(row.item.Id) < Number(previous.item.Id)) first.set(identity, row);
    }
    return [...first.values()];
  }

  async listInstruments() {
    await this.ensureInstrumentSecurity();
    const user = await this.currentUser();
    const [catalog, legacy, drafts] = await Promise.all([
      this.instrumentRows('publishedInstruments'), this.instrumentRows('instruments', null, user.id),
      this.instrumentRows('instrumentDrafts', null, user.id),
    ]);
    const ownDrafts = drafts.filter(({ item }) => Number(item.AuthorId) === user.id);
    // Tombstones also suppress the older local record in the read-only catalog.
    const ownById = new Map(ownDrafts.map(row => [String(row.record.id), row]));
    const legacyById = new Map(legacy.filter(({item, record}) => Number(item.AuthorId) === user.id && !isArchived(record))
      .map(row => [String(row.record.id), row]));
    const owner = sharePointInstrumentOwnerKey(user);
    return [
      ...catalog.filter(({record}) => !isArchived(record) && isPublished(record))
        .map(({record}) => publishedDefinition(record)),
      ...catalog.filter(({record}) => isArchived(record) && isPublished(record)).flatMap(row => {
        const id = String(row.record.id);
        const local = localFromPublication(row, ownById.get(id), legacyById.get(id), owner);
        return local && !ownById.has(local.id) ? [local] : [];
      }),
      ...legacy.filter(({item, record}) => !isArchived(record) && !isPublished(record) &&
        Number(item.AuthorId) === user.id && !ownById.has(String(record.id)))
        .map(({record}) => ({ ...record, scope: 'local', owner })),
      ...draftsWithoutApproval(ownDrafts, catalog).map(({record, item}) => ({
        ...privateDefinition(record), scope: record.scope === 'pending' ? 'pending' : 'local', owner,
        ...(record.scope === 'pending' && { reviewVersion: reviewVersionOf({item, record}) }),
      })),
    ];
  }

  async saveInstrument(record) {
    if (!record?.id) throw new Error('Cannot save an instruments record with no id.');
    if (['validated', 'shared'].includes(record.scope)) throw new SharePointError('Submit a local copy for SME validation.', 403);
    if (record.action === 'demote-shared' && !(await this.instrumentReviewAccess()).canValidate) {
      throw new SharePointError('You do not have instrument validation access to demote a shared instrument.', 403);
    }
    await this.ensureInstrumentSecurity();
    const user = await this.currentUser();
    if (record.action === 'withdraw') return this.withdrawInstrument(user, record.id, record.reviewVersion);
    const { password, reviewVersion, action, _uncertaintyArchive, _uncertaintyApprovals, _uncertaintyApprovalClaim, formerPublicationId, ...safe } = record;
    const canonical = { ...safe, owner: sharePointInstrumentOwnerKey(user), scope: record.scope === 'pending' ? 'pending' : 'local' };
    if (formerPublicationId != null && /^local-from-publication-\d+$/.test(record.id)) canonical.formerPublicationId = formerPublicationId;
    await this.writeOwnInstrument(user, canonical, reviewVersion);
    if (canonical.scope === 'pending') {
      const [saved] = await this.instrumentRows('instrumentDrafts', `${user.id}:${record.id}`, user.id);
      if (!saved || saved.record.scope !== 'pending' || isArchived(saved.record)) {
        throw new SharePointError('The submission changed. Reopen the instrument library to see its current status.', 409);
      }
      return { ...privateDefinition(saved.record), reviewVersion: reviewVersionOf(saved) };
    }
    return canonical;
  }

  async withdrawInstrument(user, id, reviewVersion) {
    const drafts = await this.instrumentRows('instrumentDrafts', `${user.id}:${id}`, user.id);
    const existing = drafts.find(({item}) => Number(item.AuthorId) === user.id);
    if (!existing) throw new SharePointError('This submission is not available in your library.', 404);
    const changed = () => new SharePointError('This submission changed or has already been reviewed. Reopen the instrument library before withdrawing it.', 409);
    if (existing.record.scope !== 'pending' || isArchived(existing.record) || reviewVersionOf(existing) !== reviewVersion) throw changed();
    const catalog = await this.instrumentRows('publishedInstruments', existing.record.sourceId || existing.record.id);
    if (!draftsWithoutApproval([existing], catalog).length) throw changed();
    if (existing.record._uncertaintyApprovalClaim) {
      // A failed first publication can lose its unique ID to another draft,
      // or a linked target can be archived. Those durable catalog rows fence
      // every delayed create/old-version update, so withdrawal is safe again.
      const cannotPublish = catalog.some(({record}) => isPublished(record) &&
        (isArchived(record) || !existing.record.sourceId));
      if (!cannotPublish) throw changed();
    }
    // Withdrawal changes status only. A stale session copy must never replace
    // the submitted specifications or another user's private instrument.
    const {reviewVersion: _version, reviewId, action, ...definition} = privateDefinition(existing.record);
    const local = {...definition, scope: 'local', owner: sharePointInstrumentOwnerKey(user), localOverride: true};
    try {
      await this.post(`${listApi(this.prefix, 'instrumentDrafts')}/items(${existing.item.Id})`, {
        headers: {'X-HTTP-Method': 'MERGE', 'IF-MATCH': `"${existing.item.owshiddenversion}"`},
        body: {PayloadJson: JSON.stringify(local), SubmittedJson: null},
      });
    } catch (error) {
      if (error.status === 412) throw changed();
      throw error;
    }
    return local;
  }

  async writeOwnInstrument(user, record, reviewVersion) {
    const key = 'instrumentDrafts';
    const recordId = `${user.id}:${record.id}`;
    const ownRow = async () => (await this.instrumentRows(key, recordId, user.id)).find(({item}) => Number(item.AuthorId) === user.id);
    let existing = await ownRow();
    const fields = { Title: String(record.description || record.model || record.id).slice(0, 255),
      RecordId: recordId, PayloadJson: JSON.stringify(record) };
    // Normal autosaves write only the editable payload. A save already in
    // flight when a user submits cannot replace what the SME will review.
    const pending = record.scope === 'pending';
    if (pending) fields.SubmittedJson = fields.PayloadJson;
    if (!existing) {
      let created;
      let createError;
      try {
        created = await this.post(`${listApi(this.prefix, key)}/items`, { body: fields });
      } catch (error) {
        createError = error;
      }
      existing = await ownRow();
      if (!existing) throw createError || new SharePointError('Could not confirm the saved draft. Reopen the library and retry.', 409);
      if (Number(existing.item.Id) === Number(created?.Id)) return;
      if (!pending && !existing.item.SubmittedJson && existing.item.PayloadJson === fields.PayloadJson) return;
    }
    const currentlyPending = existing.record.scope === 'pending' && !isArchived(existing.record);
    if (currentlyPending && existing.record._uncertaintyApprovalClaim) {
      throw new SharePointError('An SME has started publishing this submission. Reopen the library after review completes.', 409);
    }
    if (pending && currentlyPending && existing.item.SubmittedJson === fields.SubmittedJson) return;
    if (currentlyPending && String(existing.item.owshiddenversion) !== reviewVersion) {
      throw new SharePointError('This instrument has already been submitted. Reopen it to edit the current submission.', 409);
    }
    if (pending || currentlyPending || existing.item.SubmittedJson) {
      // Submission, withdrawal and reuse of an archived row must all compare
      // the revision actually read, even after the caller supplies its token.
      if (!pending) fields.SubmittedJson = null;
      await this.post(`${listApi(this.prefix, key)}/items(${existing.item.Id})`, {
        headers: { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': `"${existing.item.owshiddenversion}"` }, body: fields,
      });
    } else await this.updateListItem(key, existing.item.Id, fields);
  }

  async canValidateInstruments() {
    const groups = await this.getItems('/_api/web/currentuser/groups?$select=Title');
    if (groups.some(group => group.Title === 'Uncertalytics SME')) return true;
    if (!groups.some(group => group.Title === 'Metrology Software Owners')) return false;
    // Recheck on every approval so creating the SME group ends interim access
    // even if the owner opened the inbox before it was created.
    const result = await this.get("/_api/web/sitegroups?$select=Title&$filter=Title eq 'Uncertalytics SME'&$top=1");
    return Array.isArray(result?.value) && result.value.length === 0 && !result['odata.nextLink'] && !result['@odata.nextLink'];
  }

  async instrumentReviewAccess() {
    if (!(await this.canValidateInstruments())) return { canValidate: false };
    await this.assertInstrumentReviewVisibility();
    return { canValidate: true };
  }

  async instrumentReviews() {
    if (!(await this.instrumentReviewAccess()).canValidate) return { canValidate: false, reviews: [] };
    await this.ensureInstrumentSecurity();
    const rows = await this.instrumentRows('instrumentDrafts');
    const pending = rows.filter(({record}) => record.scope === 'pending' && !isArchived(record));
    if (!pending.length) return { canValidate: true, reviews: [] };
    const catalog = await this.instrumentRows('publishedInstruments');
    return { canValidate: true, reviews: draftsWithoutApproval(pending, catalog)
      .map(({item, record}) => ({ ...privateDefinition(record), reviewId: String(item.Id), reviewVersion: reviewVersionOf({item, record}) })) };
  }

  async assertInstrumentReviewVisibility() {
    const flags = permissionFlags(await this.get(`${listApi(this.prefix, 'instrumentDrafts')}/EffectiveBasePermissions`));
    if (!flags.manageLists) throw new SharePointError(`Your reviewer group is eligible, but this account needs Manage Lists on ${storageDisplayTitle(this.prefix, 'instrumentDrafts')} to see submissions by other users. Ask a list owner to check that list's permissions, then reopen the validation inbox.`, 403);
  }

  async returnInstrumentReview(reviewId, version) {
    if (!(await this.canValidateInstruments())) throw new SharePointError('You do not have instrument validation access.', 403);
    if (!/^\d+$/.test(reviewId) || !/^\d+$/.test(version)) throw new SharePointError('Invalid submission version.', 400);
    await this.assertInstrumentReviewVisibility();
    await this.ensureInstrumentSecurity();
    const key = 'instrumentDrafts';
    const path = `${listApi(this.prefix, key)}/items(${reviewId})`;
    const read = () => this.get(`${path}?$select=Id,AuthorId,PayloadJson,SubmittedJson,RecordId,owshiddenversion`);
    const item = await read();
    const record = this.parsePayload(item, key);
    const changed = () => new SharePointError('This submission changed or has already been reviewed. Reopen the validation inbox before returning it to the submitter.', 409);
    if (!record?.id || record.scope !== 'pending' || isArchived(record) || record._uncertaintyApprovalClaim ||
        !Number.isInteger(Number(item.AuthorId)) || Number(item.AuthorId) <= 0 ||
        !/^\d+$/.test(String(item.owshiddenversion)) || String(item.owshiddenversion) !== version) throw changed();
    const drafts = await this.instrumentRows(key, item.RecordId, item.AuthorId);
    const authoritative = drafts.find(({item: candidate}) => Number(candidate.AuthorId) === Number(item.AuthorId) && candidate.RecordId === item.RecordId);
    if (Number(authoritative?.item.Id) !== Number(item.Id)) {
      throw new SharePointError('This duplicate submission has been superseded. Reopen the validation inbox.', 409);
    }
    const catalog = await this.instrumentRows('publishedInstruments', record.sourceId || record.id);
    if (!draftsWithoutApproval([{item, record}], catalog).length) throw changed();
    // The reviewer changes status on the author's original row, using the
    // submitted snapshot rather than any late autosave or caller-supplied data.
    const {reviewVersion: _version, reviewId: _reviewId, action, ...definition} = privateDefinition(record);
    const local = {...definition, scope: 'local', owner: sharePointInstrumentOwnerKey({id:Number(item.AuthorId)}), localOverride: true};
    const payload = JSON.stringify(local);
    try {
      // Approval claims and returns compete for this same native revision.
      await this.post(path, {
        headers: {'X-HTTP-Method': 'MERGE', 'IF-MATCH': `"${item.owshiddenversion}"`},
        body: {PayloadJson: payload, SubmittedJson: null},
      });
    } catch (error) {
      if (error.status === 412) throw changed();
      // A lost response is success only if the exact write is now persisted.
      // Never retry a write against a later edit, resubmission or approval.
      try {
        const latest = await read();
        if (Number(latest.AuthorId) === Number(item.AuthorId) && latest.RecordId === item.RecordId &&
            Number(latest.owshiddenversion) === Number(item.owshiddenversion) + 1 &&
            latest.SubmittedJson == null && latest.PayloadJson === payload) return local;
      } catch { /* Preserve the original failed request for error reporting. */ }
      throw error;
    }
    return local;
  }

  async claimInstrumentApproval(path, item, record, version) {
    if (record._uncertaintyApprovalClaim) return item;
    const claimed = {...record, _uncertaintyApprovalClaim: {version}};
    const payload = JSON.stringify(claimed);
    let failure;
    try {
      // Approval and withdrawal must win the same draft revision before
      // either can complete. Catalog writes happen only after this claim.
      await this.post(path, {headers: {'X-HTTP-Method': 'MERGE', 'IF-MATCH': `"${item.owshiddenversion}"`},
        body: {PayloadJson: payload, SubmittedJson: payload}});
    } catch (error) { failure = error; }
    const latest = await this.get(`${path}?$select=Id,AuthorId,PayloadJson,SubmittedJson,RecordId,owshiddenversion`);
    const current = this.parsePayload(latest, 'instrumentDrafts');
    // A lost success response is recoverable using the persisted claim.
    if (current?.scope === 'pending' && !isArchived(current) && current._uncertaintyApprovalClaim?.version === version) return latest;
    if (failure && failure.status !== 412) throw failure;
    throw new SharePointError('This submission changed. Reopen the inbox to review it again.', 409);
  }

  async validateInstrument(reviewId, version) {
    if (!(await this.canValidateInstruments())) throw new SharePointError('You do not have instrument validation access.', 403);
    if (!/^\d+$/.test(reviewId) || !/^\d+$/.test(version)) throw new SharePointError('Invalid submission version.', 400);
    await this.assertInstrumentReviewVisibility();
    await this.ensureInstrumentSecurity();
    const key = 'instrumentDrafts';
    const path = `${listApi(this.prefix, key)}/items(${reviewId})`;
    let item = await this.get(`${path}?$select=Id,AuthorId,PayloadJson,SubmittedJson,RecordId,owshiddenversion`);
    const record = this.parsePayload(item, key);
    if (!record || record.scope !== 'pending' || !Number.isInteger(Number(item.AuthorId)) || Number(item.AuthorId) <= 0) {
      throw new SharePointError('This submission changed. Reopen the inbox to review it again.', 409);
    }
    const drafts = await this.instrumentRows(key, item.RecordId, item.AuthorId);
    const authoritative = drafts.find(({item: candidate}) => Number(candidate.AuthorId) === Number(item.AuthorId) && candidate.RecordId === item.RecordId);
    if (Number(authoritative?.item.Id) !== Number(item.Id)) {
      throw new SharePointError('This duplicate submission has been superseded. Reopen the inbox.', 409);
    }
    const target = String(record.sourceId || record.id);
    let canonical = { ...publishedDefinition(record), id: target, sourceId: target, owner: '',
      localOverride: false, validatedSnapshot: buildValidatedSnapshot(record) };
    const catalogItem = async () => (await this.instrumentRows('publishedInstruments', target)).find(({record: entry}) => isPublished(entry));
    const existing = await catalogItem();
    const removed = isArchived(existing?.record);
    const removedError = () => new SharePointError('This shared instrument has been removed.', 409);
    // The receipt is saved atomically with the public definition. If another
    // submission changes that definition before a retry, the retry only
    // finishes cleanup and returns the newer public contents.
    const wasPublished = entry => entry?.record._uncertaintyApprovals?.[reviewId] === version;
    if (removed && !wasPublished(existing)) throw removedError();
    if (wasPublished(existing)) {
      canonical = publishedDefinition(existing.record);
      if (isArchived(record) || reviewVersionOf({item, record}) !== version) {
        if (removed) throw removedError();
        return canonical;
      }
    } else {
      if (isArchived(record) || reviewVersionOf({item, record}) !== version) {
        throw new SharePointError('This submission changed. Reopen the inbox to review it again.', 409);
      }
      if (record.sourceId && target !== String(record.id) && !existing) throw new SharePointError('The original shared instrument no longer exists.', 409);
      if (existing && !record.sourceId) throw new SharePointError('A different instrument already uses this shared ID.', 409);
      item = await this.claimInstrumentApproval(path, item, record, version);
      const approved = { ...existing?.record._uncertaintyApprovals, [reviewId]: version };
      const fields = { Title: String(canonical.description || canonical.model || target).slice(0, 255),
        RecordId: target, PublicationKey: target, PayloadJson: JSON.stringify({ ...canonical, _uncertaintyApprovals: approved }) };
      const published = listApi(this.prefix, 'publishedInstruments');
      try {
        if (existing) {
          await this.post(`${published}/items(${existing.item.Id})`, {
            headers: { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': `"${existing.item.owshiddenversion}"` }, body: fields });
        } else {
          await this.post(`${published}/items`, { body: fields });
        }
      } catch (error) {
        const latest = await catalogItem();
        if (!wasPublished(latest) || isArchived(latest.record)) {
          if (error.status === 412 || (!existing && latest)) throw new SharePointError('The shared instrument changed during approval. Reopen the inbox to review it again.', 409);
          throw error;
        }
        canonical = publishedDefinition(latest.record);
      }
    }
    // A claimed approval stays reserved across failures so a retry from a
    // reopened inbox can finish it without permitting a delayed publication
    // after a successful withdrawal. Cleanup uses the claim's native revision.
    try {
      const payload = JSON.stringify(await this.archivedRecord(record));
      await this.post(path, { headers: { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': `"${item.owshiddenversion}"` },
        body: { PayloadJson: payload, SubmittedJson: payload } });
    } catch (error) { if (error.status !== 412) throw error; }
    if (removed) throw removedError();
    return canonical;
  }

  async deleteInstrument(recordId, password) {
    await this.ensureInstrumentSecurity();
    const user = await this.currentUser();
    const [drafts, catalog, legacy] = await Promise.all([
      this.instrumentRows('instrumentDrafts', `${user.id}:${recordId}`), this.instrumentRows('publishedInstruments', recordId),
      this.instrumentRows('instruments', recordId, user.id),
    ]);
    const ownDraft = drafts.find(({item}) => Number(item.AuthorId) === user.id);
    const publication = catalog.find(({record}) => isPublished(record));
    const shared = publication && !isArchived(publication.record);
    const ownLegacy = legacy.find(({item, record}) => Number(item.AuthorId) === user.id && !isArchived(record));
    const legacyLocal = ownLegacy && !isPublished(ownLegacy.record) ? ownLegacy : null;
    if (password != null || (shared && !legacyLocal && (!ownDraft || isArchived(ownDraft.record)))) {
      if (!password || password !== this.libraryPassword) throw new SharePointError('Invalid shared-library password.', 403);
      if (!publication) return;
      const restored = localFromPublication(publication, ownDraft, ownLegacy, sharePointInstrumentOwnerKey(user));
      if (!shared) {
        // A caller may retry a successful removal after the author already
        // edited or removed the recovered copy.
        return restored && (await this.listInstruments()).find(record => record.id === restored.id && record.scope === 'local');
      }
      const version = publication.item.owshiddenversion;
      if (version != null) {
        await this.post(`${listApi(this.prefix, 'publishedInstruments')}/items(${publication.item.Id})`, {
          headers: { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': `"${version}"` },
          body: { PayloadJson: JSON.stringify(await this.archivedRecord(publication.record)) },
        });
      } else await this.archiveListItem('publishedInstruments', publication.item);
      return restored;
    }
    if (ownDraft && !isArchived(ownDraft.record)) {
      if (ownDraft.record._uncertaintyApprovalClaim) throw new SharePointError('An SME has started publishing this submission. Reopen the library after review completes.', 409);
      if (ownDraft.record.scope === 'pending') {
        const payload = JSON.stringify(await this.archivedRecord(ownDraft.record));
        await this.post(`${listApi(this.prefix, 'instrumentDrafts')}/items(${ownDraft.item.Id})`, {
          headers: {'X-HTTP-Method': 'MERGE', 'IF-MATCH': `"${ownDraft.item.owshiddenversion}"`},
          body: {PayloadJson: payload, SubmittedJson: payload},
        });
      } else await this.archiveListItem('instrumentDrafts', ownDraft.item);
    }
    else if (!ownDraft && legacyLocal) await this.writeOwnInstrument(user, await this.archivedRecord(legacyLocal.record));
    else if (!ownDraft && /^local-from-publication-\d+$/.test(recordId)) {
      // Untouched Local copies have no editable draft yet. A private tombstone
      // suppresses this projection without writing to the archived publication.
      const restored = (await this.listInstruments()).find(record => record.id === recordId && record.scope === 'local');
      if (restored) await this.writeOwnInstrument(user, await this.archivedRecord(restored));
    }
  }

  async listRecords(key) {
    const items = await this.getItems(`${listApi(this.prefix, key)}/items?$select=Id,RecordId,PayloadJson&$top=5000`);
    return items.map((item) => this.parsePayload(item, key)).filter(record => record && !isArchived(record));
  }

  parsePayload(item, key) {
    const payload = (key === 'instrumentDrafts' && item.SubmittedJson) || item.PayloadJson;
    if (!payload) return null;
    try {
      return JSON.parse(payload);
    } catch {
      // One unreadable row must not take down the whole library listing.
      console.warn(`[uncertainty] Skipping unreadable ${key} record ${item.RecordId}.`);
      return null;
    }
  }

  async findRecordItem(key, recordId) {
    const filter = `$filter=RecordId eq '${String(recordId).replace(/'/g, "''")}'&$select=Id,RecordId,PayloadJson&$top=5000`;
    const items = await this.getItems(`${listApi(this.prefix, key)}/items?${filter}`);
    return items.find(item => !isArchived(this.parsePayload(item, key)));
  }

  async findItemId(key, recordId) {
    return (await this.findRecordItem(key, recordId))?.Id;
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
      await this.updateListItem(key, existingId, fields);
    } else {
      await this.post(`${listApi(this.prefix, key)}/items`, { body: fields });
    }
    return record;
  }

  async deleteRecord(key, recordId) {
    const item = await this.findRecordItem(key, recordId);
    // Deleting something already gone is not an error worth surfacing.
    if (!item) return;
    await this.archiveListItem(key, item);
  }
}
