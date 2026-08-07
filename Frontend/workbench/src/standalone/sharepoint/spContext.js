// ---------------------------------------------------------------------------
// SharePoint context discovery and request plumbing.
// ---------------------------------------------------------------------------
// This build runs as a plain HTML page hosted inside a SharePoint site, not as
// an SPFx web part, so none of the SPFx runtime is available: no
// `context.pageContext`, no SPHttpClient, no automatic digest handling. What we
// do have is same-origin cookies, because the page is served from the same
// SharePoint host as the REST API.
//
// Everything below exists to reconstruct, from a bare page, the two things
// SPFx would have handed us for free: which web we are in, and a valid form
// digest for writes.

/** Cached web URL so discovery only runs once per page load. */
let cachedWebUrl;

/**
 * Absolute URL of the SharePoint web this page is hosted in.
 *
 * Tried in order of reliability, because the hosting web part may either
 * inject this page inline or load it in an iframe, and we do not control
 * which:
 *
 *   1. `_spPageContextInfo` on our own window — present when SharePoint
 *      injected us into one of its pages.
 *   2. The same value on the parent frame — present when we are iframed by a
 *      web part on a SharePoint page. Same-origin, so this read is legal;
 *      wrapped anyway because a cross-origin parent throws on access.
 *   3. Derived from our own path. A file served out of a document library
 *      still sits under the web, so /sites/<x>/... yields /sites/<x>.
 *   4. An explicit ?webUrl= override, checked first in practice for testing
 *      against a web other than the hosting one.
 */
export function resolveWebUrl(win = typeof window !== 'undefined' ? window : undefined) {
  if (cachedWebUrl !== undefined) return cachedWebUrl;
  cachedWebUrl = discoverWebUrl(win);
  return cachedWebUrl;
}

/** Test seam: forget the discovered web URL. */
export function resetWebUrlCache() {
  cachedWebUrl = undefined;
  digestCache = null;
}

function discoverWebUrl(win) {
  if (!win || !win.location) return '';

  // 4. Explicit override wins, so a page can be pointed at another web.
  try {
    const override = new URLSearchParams(win.location.search).get('webUrl');
    if (override) return stripTrailingSlash(override);
  } catch {
    /* malformed query string — fall through to discovery */
  }

  // 1. Injected directly into a SharePoint page.
  const own = win._spPageContextInfo?.webAbsoluteUrl;
  if (own) return stripTrailingSlash(own);

  // 2. Iframed by a web part on a SharePoint page (same origin).
  try {
    const parent = win.parent?._spPageContextInfo?.webAbsoluteUrl;
    if (parent) return stripTrailingSlash(parent);
  } catch {
    // Cross-origin parent. Not fatal; fall through to path derivation.
  }

  // 3. Derive from our own location.
  return stripTrailingSlash(deriveWebUrlFromPath(win.location.origin, win.location.pathname));
}

/**
 * Best-effort web URL from a served path.
 *
 * SharePoint managed paths are conventionally /sites/<name> and /teams/<name>.
 * Anything else is treated as the tenant root, which is correct for a root-site
 * deployment and detectably wrong (a 404 on the first call) otherwise.
 */
export function deriveWebUrlFromPath(origin, pathname) {
  const match = /^\/(sites|teams)\/([^/]+)/i.exec(pathname || '');
  return match ? `${origin}/${match[1]}/${match[2]}` : origin;
}

function stripTrailingSlash(url) {
  return String(url).replace(/\/+$/, '');
}

const JSON_ACCEPT = 'application/json;odata=nometadata';

/** Cached digest plus the moment it stops being valid. */
let digestCache = null;

/**
 * A current form digest for the web.
 *
 * SharePoint rejects any write without one. The value expires (typically 30
 * minutes), and this tool is left open on a desk for hours at a time, so the
 * expiry the server reports is honoured and the digest refetched rather than
 * cached for the life of the page. A safety margin covers clock skew and slow
 * requests.
 */
export async function getFormDigest(webUrl, fetchImpl = fetch) {
  if (digestCache && digestCache.webUrl === webUrl && Date.now() < digestCache.expiresAt) {
    return digestCache.value;
  }

  const response = await fetchImpl(`${webUrl}/_api/contextinfo`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: JSON_ACCEPT, 'Content-Length': '0' },
  });

  if (!response.ok) {
    throw new SharePointError(
      'Could not obtain a SharePoint form digest. You may be signed out, or this page may not ' +
        'be hosted inside the SharePoint site it is trying to write to.',
      response.status,
    );
  }

  const body = await response.json();
  const value = body.FormDigestValue || body.d?.GetContextWebInformation?.FormDigestValue;
  const seconds =
    body.FormDigestTimeoutSeconds || body.d?.GetContextWebInformation?.FormDigestTimeoutSeconds || 1800;

  if (!value) {
    throw new SharePointError('SharePoint returned no form digest value.', response.status);
  }

  // Refresh a minute early so a long-running request cannot straddle expiry.
  digestCache = { webUrl, value, expiresAt: Date.now() + Math.max(60, seconds - 60) * 1000 };
  return value;
}

/** Error carrying the HTTP status so callers can distinguish 403 from 404. */
export class SharePointError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'SharePointError';
    this.status = status;
    this.detail = detail;
  }
}

/** GET returning parsed JSON. */
export async function spGet(webUrl, path, fetchImpl = fetch) {
  const response = await fetchImpl(`${webUrl}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: JSON_ACCEPT },
  });
  return readJson(response, `GET ${path}`);
}

/**
 * POST with a form digest attached.
 *
 * `method` lets callers issue SharePoint's tunnelled MERGE and DELETE verbs,
 * which it expects as a POST carrying X-HTTP-Method.
 */
export async function spPost(webUrl, path, { body, method, headers = {}, raw = false } = {}, fetchImpl = fetch) {
  const digest = await getFormDigest(webUrl, fetchImpl);
  const requestHeaders = {
    Accept: JSON_ACCEPT,
    'X-RequestDigest': digest,
    ...headers,
  };
  if (!raw && body !== undefined) {
    requestHeaders['Content-Type'] = JSON_ACCEPT;
  }
  if (method) {
    requestHeaders['X-HTTP-Method'] = method;
    requestHeaders['IF-MATCH'] = requestHeaders['IF-MATCH'] || '*';
  }

  const response = await fetchImpl(`${webUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders,
    body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  return readJson(response, `POST ${path}`);
}

/** GET returning the raw response text, for file contents. */
export async function spGetText(webUrl, path, fetchImpl = fetch) {
  const response = await fetchImpl(`${webUrl}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: '*/*' },
  });
  if (!response.ok) {
    throw new SharePointError(describeFailure(`GET ${path}`, response.status), response.status);
  }
  return response.text();
}

async function readJson(response, context) {
  if (response.status === 204) return {};
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new SharePointError(describeFailure(context, response.status), response.status, detail);
  }
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new SharePointError(`${context} returned a response that was not JSON.`, response.status);
  }
}

/** Turn a bare status into something an analyst can act on. */
function describeFailure(context, status) {
  if (status === 403) {
    return `${context} was denied (403). You need Edit permission on this site; ask a site owner.`;
  }
  if (status === 404) {
    return `${context} was not found (404). The lists may not have been created yet — run setup from the tool's Storage panel.`;
  }
  if (status === 401) {
    return `${context} was rejected as unauthenticated (401). Reload the page to sign in again.`;
  }
  return `${context} failed (HTTP ${status}).`;
}
