import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { PDFDocument } from "pdf-lib";
import { createSessionPdfBytes, parseSessionPdf, parseSessionFile, saveSessionToJson, saveSessionToPdf } from "./fileIo";

describe("session PDF round trip", () => {
  it("restores the complete embedded session from the generated report", async () => {
    const session = {
      id: "session-1",
      name: "Round Trip Session",
      qualifierColumnNames: {uut:['Frequency','Calibration interval'],tmde:['Operating mode']},
      analyst: "Test Analyst",
      measurementAreas: [{ id: "area-1", name: "Area One" }],
      uuts: [],
      tmdes: [],
      testPoints: [],
      uncReq: {
        reliability: 95,
        reqPFA: 2,
        neededTUR: 4,
        uncertaintyConfidence: 95,
      },
      noteImages: [{ id: "image-1", fileName: "note.png" }],
    };
    const imageData =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const images = new Map([["image-1", imageData]]);

    const { pdfBytes } = await createSessionPdfBytes(session, images);
    const fileLike = {
      arrayBuffer: async () =>
        pdfBytes.buffer.slice(
          pdfBytes.byteOffset,
          pdfBytes.byteOffset + pdfBytes.byteLength,
        ),
    };
    const result = await parseSessionFile({ ...fileLike, name: "legacy.pdf" });

    expect(result.session).toEqual(session);
    expect(result.images.get("image-1")).toBe(imageData);
  });

  it("explains how to restore when a reconstructed PDF no longer has attachments", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    await expect(parseSessionPdf({ arrayBuffer: async () => bytes })).rejects.toThrow("session JSON backup");
  });
});

describe("portable session JSON backups", () => {
  const png = "data:image/png;base64,AQID";
  const jsonFile = value => ({ name: "session.json", text: async () => JSON.stringify(value) });
  const backup = (session, images = []) => ({ format: "uncertalytics-session", version: 1, session, images });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("Blob", NodeBlob);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:session-backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("round-trips complete session values, embedded DOCX notes and legacy image bytes", async () => {
    const session = {
      id: "session-1", name: "Meter / input.exe", notes: "docx:UEsDBAoAAAAAAA==",
      testPoints: [{ id: "point-1", measured: 12.3, custom: { keep: true } }],
      qualifierColumnNames: { uut: ["Frequency"] },
      noteImages: [{ id: 7, fileName: "setup.png" }],
    };
    const append = vi.spyOn(document.body, "appendChild");
    await saveSessionToJson(session, new Map([["7", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })]]));
    const blob = URL.createObjectURL.mock.calls[0][0];
    const result = await parseSessionFile({ name: "session.JSON", text: () => blob.text() });
    expect(result.session).toEqual(session);
    expect(result.images.get(7)).toBe(png);
    expect(blob.type).toBe("application/json");
    expect(append.mock.calls[0][0].download).toMatch(/^Uncertalytics_Meter _ input_exe_.*\.json$/);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:session-backup");
  });

  it("preserves stored data-URI images without a loaded cache", async () => {
    const session = { id: 0, testPoints: [], noteImages: [{ id: "photo", fileName: "setup.png", fileObject: png }] };
    await saveSessionToJson(session);
    const result = await parseSessionFile({ name: "backup.json", text: () => URL.createObjectURL.mock.calls[0][0].text() });
    expect(result.session).toEqual(session);
    expect(result.images.get("photo")).toBe(png);
  });

  it("refuses an incomplete export instead of dropping a note image", async () => {
    await expect(saveSessionToJson({ id: 1, testPoints: [], noteImages: [{ id: "photo" }] })).rejects.toThrow("unavailable");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects unsupported formats, malformed sessions and incomplete image data", async () => {
    const session = { id: 1, testPoints: [], noteImages: [{ id: "photo" }] };
    await expect(parseSessionFile(jsonFile({ ...backup(session), version: 2 }))).rejects.toThrow("supported");
    await expect(parseSessionFile(jsonFile(backup({ id: 1, testPoints: {} })))).rejects.toThrow("valid Uncertalytics session");
    await expect(parseSessionFile(jsonFile(backup(session)))).rejects.toThrow("missing");
    await expect(parseSessionFile(jsonFile(backup(session, [{ id: "photo", dataUrl: "https://example.com/photo.png" }])))).rejects.toThrow("PNG or JPEG");
    await expect(parseSessionFile(jsonFile(backup(session, [{ id: "photo", dataUrl: png }, { id: "photo", dataUrl: png }])))).rejects.toThrow("duplicate");
    await expect(parseSessionFile({ name: "broken.json", text: async () => "{" })).rejects.toThrow("could not be read");
    await expect(parseSessionFile({ name: "session.txt" })).rejects.toThrow("JSON backup or a legacy session PDF");
  });

  it("keeps PDF report download bytes available for asynchronous host inspection", async () => {
    await saveSessionToPdf({ id: 1, name: "Report", testPoints: [] }, new Map());
    expect(URL.createObjectURL.mock.calls[0][0].type).toBe("application/pdf");
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60000);
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
});
