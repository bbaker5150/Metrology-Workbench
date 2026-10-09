import { describe, expect, it } from "vitest";
import { createSessionPdfBytes, parseSessionPdf } from "./fileIo";

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
    const result = await parseSessionPdf(fileLike);

    expect(result.session).toEqual(session);
    expect(result.images.get("image-1")).toBe(imageData);
  });
});
