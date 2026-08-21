// ---------------------------------------------------------------------------
// Serve the module's Django REST calls from SharePoint.
// ---------------------------------------------------------------------------
// The uncertainty module talks to `${API_BASE_URL}/uncertainty/...` through the
// global axios singleton. Rather than editing every call site — which would
// fork the module and mean maintaining two copies of the same logic — this
// installs an axios adapter that recognises those routes and fulfils them from
// SharePoint instead.
//
// The upshot is that `modules/uncertainty/**` is byte-identical between the
// Django/Electron build and this SharePoint build. A fix to session handling
// lands in both, and there is exactly one implementation to reason about.
//
// Anything not matching an uncertainty route falls through to the real network
// adapter untouched.

import { SharePointStore } from './spStore';
import { SharePointError, spGetText } from './spContext';

/** Route table: [method, RegExp over the path after /uncertainty, handler]. */
function buildRoutes(store) {
  return [
    ['GET', /^\/sessions\/$/, () => listFullSessions(store)],
    ['POST', /^\/sessions\/$/, (_m, body) => store.saveSession(body)],
    ['PUT', /^\/sessions\/(\d+)\/$/, (m, body) => store.saveSession({ ...body, id: Number(m[1]) })],
    ['PATCH', /^\/sessions\/(\d+)\/notes\/$/, (m, body) => patchNotes(store, Number(m[1]), body)],
    ['DELETE', /^\/sessions\/(\d+)\/$/, (m) => store.deleteSession(Number(m[1]))],

    ['GET', /^\/sessions\/(\d+)\/images\/$/, (m) => listImages(store, Number(m[1]))],
    ['POST', /^\/sessions\/(\d+)\/images\/$/, (m, body) => saveImage(store, Number(m[1]), body)],
    ['DELETE', /^\/sessions\/(\d+)\/images\/([^/]+)\/$/, (m) => deleteImage(store, Number(m[1]), m[2])],

    ['GET', /^\/instruments\/$/, () => store.listInstruments()],
    ['POST', /^\/instruments\/$/, (_m, body) => store.saveInstrument(body)],
    ['DELETE', /^\/instruments\/([^/]+)\/$/, (m) => store.deleteInstrument(decodeURIComponent(m[1]))],

    ['GET', /^\/equations\/$/, () => store.listRecords('equations')],
    ['POST', /^\/equations\/$/, (_m, body) => store.saveRecord('equations', body)],
    ['DELETE', /^\/equations\/([^/]+)\/$/, (m) => store.deleteRecord('equations', decodeURIComponent(m[1]))],

    ['GET', /^\/bug_reports\/$/, () => store.listRecords('bugReports')],
    ['POST', /^\/bug_reports\/$/, (_m, body) => store.saveRecord('bugReports', body)],
    ['DELETE', /^\/bug_reports\/([^/]+)\/$/, (m) => store.deleteRecord('bugReports', decodeURIComponent(m[1]))],

    // The module probes these for backend health/version. There is no server
    // here, so report a static, honest answer rather than letting it 404.
    ['GET', /^\/info\/$/, () => ({ backend: 'sharepoint', version: 'standalone' })],
    ['GET', /^\/system_info\/$/, () => ({ backend: 'sharepoint', database: 'SharePoint lists' })],
  ];
}

/**
 * The module's session list endpoint returns whole nested documents, not
 * summaries — `loadData` calls `replaceSessions(res.data)` and then works
 * entirely from memory. So the list must be hydrated from every session file.
 *
 * Requests are issued with bounded concurrency: unbounded would open one
 * connection per session against SharePoint (which throttles), and serial
 * would make a 30-session site painfully slow to open.
 */
async function listFullSessions(store, concurrency = 6) {
  const summaries = await store.listSessions();
  const results = new Array(summaries.length);
  let cursor = 0;

  async function worker() {
    while (cursor < summaries.length) {
      const index = cursor++;
      try {
        results[index] = await store.getSession(summaries[index].id);
      } catch (error) {
        // One unreadable session must not stop the tool from opening; drop it
        // and leave a breadcrumb naming the file.
        console.warn(
          `[uncertainty] Skipping session ${summaries[index].id} (${summaries[index].name}): ${error.message}`,
        );
        results[index] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, summaries.length) }, worker));
  return results.filter(Boolean);
}

/** Notes autosave patches one field without rewriting the whole document. */
async function patchNotes(store, sessionId, body) {
  const session = await store.getSession(sessionId);
  session.notes = body?.notes ?? '';
  await store.saveSession(session);
  return { notes: session.notes };
}

// -- images ------------------------------------------------------------------
// Kept out of the session document so a page of screenshots does not bloat
// every session read. Each image is its own small JSON file in the same
// library, named so the set for a session can be found by prefix.

async function listImages(store, sessionId) {
  const folder = await store.libraryFolder();
  const user = await store.currentUser();
  const scopedPrefix = `image-${user.id}-${sessionId}-`;
  const legacyPrefix = `image-${sessionId}-`;
  const ownedNames = await store.listOwnedLibraryFileNames();
  const names = ownedNames.filter(
    (name) => name.startsWith(scopedPrefix) || name.startsWith(legacyPrefix),
  );

  const images = [];
  for (const name of names) {
    try {
      const path = `/_api/web/getfilebyserverrelativeurl('${encodeURIComponent(`${folder}/${name}`)}')/$value`;
      const image = JSON.parse(await spGetText(store.webUrl, path, store.fetchImpl));
      store.rememberImageFile(sessionId, image.imageId, name);
      images.push(image);
    } catch (error) {
      console.warn(`[uncertainty] Skipping unreadable image ${name}: ${error.message}`);
    }
  }
  return images;
}

async function saveImage(store, sessionId, body) {
  const folder = await store.libraryFolder();
  const name = await store.scopedImageFileName(sessionId, body.imageId);
  const path =
    `/_api/web/getfolderbyserverrelativeurl('${encodeURIComponent(folder)}')` +
    `/files/add(url='${encodeURIComponent(name)}',overwrite=true)`;
  await store.post(path, {
    raw: true,
    body: JSON.stringify({ imageId: body.imageId, dataBase64: body.dataBase64, fileName: body.fileName }),
    headers: { 'Content-Type': 'application/json' },
  });
  return { imageId: body.imageId };
}

async function deleteImage(store, sessionId, imageId) {
  const folder = await store.libraryFolder();
  const name = await store.scopedImageFileName(sessionId, imageId);
  const path = `/_api/web/getfilebyserverrelativeurl('${encodeURIComponent(`${folder}/${name}`)}')/recycle()`;
  try {
    await store.post(path, {});
  } catch (error) {
    // Already gone is a successful delete from the caller's point of view.
    if (!(error instanceof SharePointError && error.status === 404)) throw error;
  }
}

/**
 * Build the adapter.
 *
 * @param {object}   options
 * @param {SharePointStore} options.store
 * @param {string}   options.apiRoot  the `${API_BASE_URL}/uncertainty` prefix to intercept
 * @param {Function} options.fallback axios adapter for everything else
 */
export function createSharePointAdapter({ store, apiRoot, fallback }) {
  const routes = buildRoutes(store);

  return async function sharePointAdapter(config) {
    const url = config.url || '';
    if (!url.startsWith(apiRoot)) {
      return fallback(config);
    }

    const path = url.slice(apiRoot.length) || '/';
    const method = (config.method || 'get').toUpperCase();
    const body = parseBody(config.data);

    for (const [routeMethod, pattern, handler] of routes) {
      if (routeMethod !== method) continue;
      const match = pattern.exec(path);
      if (!match) continue;

      try {
        const data = await handler(match, body);
        return respond(config, data === undefined ? null : data, 200);
      } catch (error) {
        // Present it the way axios would, so the module's existing catch
        // blocks and error logging keep working unchanged.
        const status = error instanceof SharePointError ? error.status || 500 : 500;
        const axiosError = new Error(error.message);
        axiosError.config = config;
        axiosError.response = respond(config, { detail: error.message }, status);
        axiosError.isAxiosError = true;
        throw axiosError;
      }
    }

    // An uncertainty route we do not implement is a bug, not a network
    // condition — say so loudly rather than silently returning empty.
    const unsupported = new Error(
      `[uncertainty] No SharePoint handler for ${method} ${path}. ` +
        `This route is not supported in the SharePoint build.`,
    );
    unsupported.config = config;
    unsupported.isAxiosError = true;
    unsupported.response = respond(config, { detail: unsupported.message }, 501);
    throw unsupported;
  };
}

function parseBody(data) {
  if (data === undefined || data === null) return undefined;
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function respond(config, data, status) {
  return {
    data,
    status,
    statusText: status === 200 ? 'OK' : String(status),
    headers: {},
    config,
    request: null,
  };
}
