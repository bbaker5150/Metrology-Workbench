import { describe, expect, it } from "vitest";
import { formatInstrumentSyncError } from "./instrumentSyncError";

describe("instrument sync error reports", () => {
  it("reports SharePoint's reason, failing list operation, HTTP status, and request ID", () => {
    const operation = "POST /_api/web/lists/getbytitle('Uncertalytics%20-%20Instrument%20Drafts')/items";
    const error = Object.assign(new Error("The request was denied."), {
      response: { status: 403, data: { detail: "The request was denied." } },
      httpStatus: 403, requestId: "af23-5319", operation, serverMessage: "Access denied.",
    });
    expect(formatInstrumentSyncError(error)).toBe(
      `Access denied.\n${operation}\nHTTP 403\nRequest ID af23-5319`,
    );
  });

  it("keeps application conflicts distinct from HTTP failures", () => {
    const error = Object.assign(new Error("This instrument has already been submitted."), {
      response: { status: 409 }, status: 409, httpStatus: null,
    });
    expect(formatInstrumentSyncError(error)).toBe("This instrument has already been submitted.\nStatus 409");
  });

  it("reports fetch failures without the adapter's synthetic HTTP 500", () => {
    const error = Object.assign(new TypeError("Failed to fetch"), {
      response: { status: 500 }, httpStatus: null, operation: "POST /_api/contextinfo",
    });
    expect(formatInstrumentSyncError(error)).toBe("Failed to fetch\nPOST /_api/contextinfo\nNo HTTP response received.");
  });

  it("uses the backend detail and only the safe request metadata", () => {
    const error = Object.assign(new Error("Request failed with status code 409"), {
      config: { method: "post", url: "https://user:password@example.test/api/instruments/?key=secret#fragment",
        data: { model: "private instrument" }, headers: { Authorization: "Bearer secret" } },
      response: { status: 409, headers: { "X-Request-Id": "case_123", "set-cookie": "cookie=secret" },
        data: { detail: "The submission changed.", review: { model: "private instrument" } } },
    });
    expect(formatInstrumentSyncError(error)).toBe("The submission changed.\nPOST /api/instruments/\nHTTP 409\nRequest ID case_123");
  });

  it("preserves a local or offline error when there is no server detail", () => {
    expect(formatInstrumentSyncError(new Error("Library removal is unavailable"))).toBe("Library removal is unavailable");
    expect(formatInstrumentSyncError({ code: "ERR_NETWORK", message: "Network Error" }))
      .toBe("Network Error\nNo HTTP response received.");
  });

  it("omits query values and URL credentials from paths embedded in error text", () => {
    expect(formatInstrumentSyncError(new Error("GET /_api/list?token=secret failed. See https://me:pw@host/errors?id=secret")))
      .toBe("GET /_api/list failed. See https://host/errors");
  });

  it("ignores HTML sign-in pages and diagnoses missing exception detail", () => {
    expect(formatInstrumentSyncError({ message: "Authentication required.", response: { status: 401, data: "<html>Sign in</html>" } }))
      .toBe("Authentication required.\nHTTP 401");
    expect(formatInstrumentSyncError(null)).toBe("No error message was provided.");
  });
});
