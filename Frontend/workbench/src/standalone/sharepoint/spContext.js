// ---------------------------------------------------------------------------
// SharePoint context discovery and request plumbing.
// ---------------------------------------------------------------------------
// Firepit supplies the exact hosting web and mediates fetch in its opaque
// iframe. Direct SharePoint hosting still needs a browser form digest.

/** Cached web URL so discovery only runs once per page load. */
let cachedWebUrl;
let currentUserCache = null;

/**
 * Absolute URL of the SharePoint web this page is hosted in.
 *
 * Firepit's public context wins and must agree with an explicit destination.
 * Outside Firepit, retain configured URLs, SharePoint page context, same-origin
 * parent context and the legacy URL fallback for directly hosted pages.
 */
export function resolveWebUrl(win = typeof window !== 'undefined' ? window : undefined, configuredWebUrl) {
  const hosted = firepitWebUrl(win);
  // Firepit preserves the original app query in the blob frame's fragment.
  const query = win?.location?.search || (hosted ? String(win?.location?.hash || '').replace(/^#\??/, '?') : '');
  const override = configuredWebUrl || new URLSearchParams(query).get('webUrl');
  if (hosted) {
    if (override && canonicalWebUrl(override) !== canonicalWebUrl(hosted)) {
      throw new SharePointError('The configured storage web differs from the Firepit hosting web. Open the app on its intended storage web or correct its webUrl setting; no SharePoint request was sent.');
    }
    return hosted;
  }
  if (override) return normalizeWebUrl(override);
  if (cachedWebUrl === undefined) cachedWebUrl = discoverWebUrl(win);
  return cachedWebUrl;
}

function normalizeWebUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return stripTrailingSlash(`${url.origin}${url.pathname}`);
  } catch {
    throw new SharePointError('A valid absolute SharePoint web URL is required. Open the app from its SharePoint hosting page.');
  }
}

function firepitWebUrl(win = typeof window !== 'undefined' ? window : undefined) {
  const value = win?.firepit?.sharepoint?.siteUrl;
  return value ? normalizeWebUrl(value) : '';
}

function canonicalWebUrl(value) {
  const url = new URL(normalizeWebUrl(value));
  if (/\.(?:sharepoint\.com|sharepoint\.us|sharepoint-mil\.us|sharepoint\.de|sharepoint\.cn)\.mcas-gov\.us$/i.test(url.hostname)) {
    url.hostname = url.hostname.slice(0, -'.mcas-gov.us'.length);
  }
  return stripTrailingSlash(url.href).toLowerCase();
}

export function isFirepitHosted() {
  return Boolean(firepitWebUrl());
}

/** Test seam: forget the discovered web URL. */
export function resetWebUrlCache() {
  cachedWebUrl = undefined;
  digestCache = null;
  currentUserCache = null;
}

/**
 * Resolve the Microsoft 365 identity already authenticated by SharePoint.
 *
 * The standalone page deliberately has no second password/login system. It
 * uses SharePoint's same-origin authentication cookie and current-user REST
 * endpoint, so tenant MFA and access policies continue to apply.
 */
export async function getCurrentUser(webUrl, fetchImpl = fetch) {
  if (currentUserCache?.webUrl === webUrl) return currentUserCache.promise;

  const promise = spGet(
    webUrl,
    '/_api/web/currentuser?$select=Id,LoginName,Email,Title',
    fetchImpl,
  ).then((body) => {
    const source = body?.d || body || {};
    const id = Number(source.Id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new SharePointError(
        'SharePoint could not identify the signed-in user. Open this file from its SharePoint site and sign in again.',
        401,
      );
    }
    return {
      id,
      loginName: source.LoginName || '',
      email: source.Email || '',
      title: source.Title || source.Email || source.LoginName || `User ${id}`,
    };
  });

  currentUserCache = { webUrl, promise };
  try {
    return await promise;
  } catch (error) {
    currentUserCache = null;
    throw error;
  }
}

function discoverWebUrl(win) {
  if (!win || !win.location) return '';

  // 1. Injected directly into a SharePoint page.
  const own = win._spPageContextInfo?.webAbsoluteUrl;
  if (own) return normalizeWebUrl(own);

  // 2. Iframed by a web part on a SharePoint page (same origin).
  try {
    const parent = win.parent?._spPageContextInfo?.webAbsoluteUrl;
    if (parent) return normalizeWebUrl(parent);
  } catch {
    // Cross-origin parent. Not fatal; fall through to path derivation.
  }

  // 3. Derive from our own location.
  if (!/^https?:\/\//i.test(win.location.origin || '') || /^(?:about|blob|data|file):/i.test(win.location.protocol || '')) {
    throw new SharePointError('The SharePoint hosting context is unavailable in this frame. Reopen the app from its Firepit hosting page.');
  }
  return normalizeWebUrl(deriveWebUrlFromPath(win.location.origin, win.location.pathname));
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

// A few endpoints will not accept a payload without an explicit OData type.
// Field creation is the one this build needs: the Fields collection is
// polymorphic, so SharePoint cannot infer whether a body describes a text,
// number, or note column, and rejects it with a bare 400.
const VERBOSE = 'application/json;odata=verbose';

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

  const response = await fetchSharePoint(webUrl, '/_api/contextinfo', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: JSON_ACCEPT },
  }, fetchImpl);

  if (!response.ok) {
    throw responseError(response, 'POST /_api/contextinfo', await response.text().catch(() => ''),
      'Could not obtain a SharePoint form digest. You may be signed out, or this page may not ' +
        'be hosted inside the SharePoint site it is trying to write to.',
    );
  }

  const body = await response.json();
  const value = body.FormDigestValue || body.d?.GetContextWebInformation?.FormDigestValue;
  const seconds =
    body.FormDigestTimeoutSeconds || body.d?.GetContextWebInformation?.FormDigestTimeoutSeconds || 1800;

  if (!value) {
    throw responseError(response, 'POST /_api/contextinfo', '', 'SharePoint returned no form digest value.');
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

function responseError(response, context, detail, message) {
  const reason = sharePointErrorMessage(detail);
  const error = new SharePointError(message || describeFailure(context, response.status, reason), response.status, detail);
  error.httpStatus = response.status;
  error.operation = context.split('?')[0];
  error.requestId = response.headers?.get?.('SPRequestGuid') || response.headers?.get?.('request-id');
  error.serverMessage = reason || (response.ok ? message : 'SharePoint returned no error message.');
  try { copyHostErrorDetails(error, JSON.parse(detail)?.error); } catch { /* Not a JSON error. */ }
  const changeSent = response.headers?.get?.('X-Firepit-Change-Sent');
  if (changeSent === 'true' || changeSent === 'false') error.changeSent = changeSent === 'true';
  return error;
}

function copyHostErrorDetails(error, source) {
  for (const key of ['code', 'phase', 'resource', 'changeSent', 'originalRecycled']) {
    if (source?.[key] !== undefined) error[key] = source[key];
  }
}

async function fetchSharePoint(webUrl, path, options, fetchImpl) {
  try {
    // Fail before a foreign-web read can make the whole Firepit session read-only.
    const hosted = firepitWebUrl();
    if (hosted && canonicalWebUrl(webUrl) !== canonicalWebUrl(hosted)) {
      throw new SharePointError('This request targets a different storage web from the Firepit hosting web. Reopen the app on its intended storage web; no SharePoint request was sent.');
    }
    if (hosted) {
      const target = new URL(`${webUrl}${path}`);
      const apiRoot = new URL(`${webUrl}/_api/`);
      if (target.origin !== apiRoot.origin || !target.pathname.toLowerCase().startsWith(apiRoot.pathname.toLowerCase())) {
        throw new SharePointError('SharePoint returned a request path outside the hosting web API. No request was sent.');
      }
    }
    return await fetchImpl(`${webUrl}${path}`, options);
  } catch (cause) {
    const error = new SharePointError(cause?.message || String(cause), cause?.status);
    copyHostErrorDetails(error, cause);
    error.operation = `${options.method} ${path.split('?')[0]}`;
    error.cause = cause;
    throw error;
  }
}

/** GET returning parsed JSON. */
export async function spGet(webUrl, path, fetchImpl = fetch) {
  const response = await fetchSharePoint(webUrl, path, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: JSON_ACCEPT },
  }, fetchImpl);
  return readJson(response, `GET ${path}`);
}

/** POST through the host bridge, or with a digest when directly hosted. */
export async function spPost(
  webUrl,
  path,
  { body, headers = {}, raw = false, verbose = false } = {},
  fetchImpl = fetch,
) {
  const digest = isFirepitHosted() ? null : await getFormDigest(webUrl, fetchImpl);
  const contentType = verbose ? VERBOSE : JSON_ACCEPT;
  const requestHeaders = {
    Accept: contentType,
    ...(digest ? { 'X-RequestDigest': digest } : {}),
    ...headers,
  };
  if (!raw && body !== undefined) {
    requestHeaders['Content-Type'] = contentType;
  }
  const response = await fetchSharePoint(webUrl, path, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders,
    body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
  }, fetchImpl);
  return readJson(response, `POST ${path}`);
}

/** GET returning the raw response text, for file contents. */
export async function spGetText(webUrl, path, fetchImpl = fetch) {
  const response = await fetchSharePoint(webUrl, path, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: '*/*' },
  }, fetchImpl);
  if (!response.ok) {
    throw responseError(response, `GET ${path}`, await response.text().catch(() => ''));
  }
  return response.text();
}

async function readJson(response, context) {
  if (response.status === 204) return {};
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw responseError(response, context, detail);
  }
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw responseError(response, context, '', 'SharePoint returned a response that was not JSON.');
  }
}

/**
 * SharePoint's own explanation of a failure, dug out of the response body.
 *
 * It says things like "A duplicate field name … was found" or "Column limit
 * exceeded" — the whole diagnosis, sitting in the body of a response we would
 * otherwise report as a bare status code. Three body shapes are in play because
 * the format depends on the OData flavour the request asked for.
 */
export function sharePointErrorMessage(detail) {
  if (!detail) return '';
  let parsed;
  try {
    parsed = JSON.parse(detail);
  } catch {
    // An HTML sign-in page or a proxy error. Not worth showing raw.
    return /^\s*</.test(detail) ? '' : detail.slice(0, 300).trim();
  }

  const error = parsed?.error || parsed?.['odata.error'];
  const message = error?.message ?? parsed?.['odata.error']?.message;
  const text = typeof message === 'string' ? message : message?.value;
  return typeof text === 'string' ? text.trim() : '';
}

/** Turn a bare status into something an analyst can act on. */
function describeFailure(context, status, reason) {
  const because = reason ? ` SharePoint said: ${reason}` : '';

  if (status === 403) {
    return `${context} was denied (403). Check the reported reason and your access to this SharePoint resource.${because}`;
  }
  if (status === 404) {
    return `${context} was not found (404). The lists may not have been created yet — run setup from the tool's Storage panel.${because}`;
  }
  if (status === 401) {
    return `${context} was rejected as unauthenticated (401). Reload the page to sign in again.${because}`;
  }
  return `${context} failed (HTTP ${status}).${because}`;
}
