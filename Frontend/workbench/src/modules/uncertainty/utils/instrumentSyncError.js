const requestIdHeaders = ["sprequestguid", "request-id", "x-request-id"];

function reportText(value) {
  if (typeof value !== "string") return "";
  // A SharePoint error can include its request URL. Keep the list and item
  // path, but omit URL credentials and query parameters from a shared report.
  return value.trim()
    .replace(/(https?:\/\/)[^\s/@]+@/gi, "$1")
    .replace(/((?:https?:\/\/|\/)[^\s?#]*)[?#][^\s]+/gi, "$1");
}

function axiosOperation(config) {
  if (!config?.method || !config.url) return "";
  try {
    const { pathname, protocol } = new URL(config.url, "https://localhost");
    return /^https?:$/.test(protocol) ? `${config.method.toUpperCase()} ${pathname}` : "";
  } catch {
    return "";
  }
}

function responseRequestId(error) {
  const headers = error?.response?.headers || {};
  const headerName = Object.keys(headers).find(key => requestIdHeaders.includes(key.toLowerCase()));
  const id = error?.requestId || headers[headerName] ||
    requestIdHeaders.map(name => headers.get?.(name)).find(Boolean);
  return typeof id === "string" && /^[\w.:-]{1,128}$/.test(id) ? id : "";
}

/** Only include diagnostic fields; Axios config and response bodies can hold
 * instrument definitions, credentials, or a whole HTML sign-in page. */
export function formatInstrumentSyncError(error) {
  const response = error?.response;
  const body = response?.data;
  const serviceError = body?.error || body?.["odata.error"];
  const plainBody = typeof body === "string" && !/^\s*[<{\[]/.test(body) ? body : "";
  const reason = [error?.serverMessage, body?.detail, body?.message, serviceError?.message?.value,
    serviceError?.message, plainBody, error?.message, error]
    .map(reportText).find(Boolean) || "No error message was provided.";

  // The SharePoint adapter exposes the native HTTP status separately from its
  // compatibility response (which can report 500 even for a network failure).
  const fromSharePoint = error != null && Object.hasOwn(error, "httpStatus");
  const httpStatus = fromSharePoint ? error.httpStatus : response?.status;
  const operation = reportText(error?.operation) || (!fromSharePoint && axiosOperation(error?.config));
  const lines = [reason];
  if (operation) lines.push(operation);
  if (httpStatus) lines.push(`HTTP ${httpStatus}`);
  else if (error?.status) lines.push(`Status ${error.status}`);
  else if ((fromSharePoint && operation) || error?.request || error?.code === "ERR_NETWORK") {
    lines.push("No HTTP response received.");
  }
  const requestId = responseRequestId(error);
  if (requestId) lines.push(`Request ID ${requestId}`);
  return lines.join("\n");
}
