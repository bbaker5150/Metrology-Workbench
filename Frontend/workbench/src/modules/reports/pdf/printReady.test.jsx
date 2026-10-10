// @vitest-environment node
import { describe, expect, test } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument, PrintScaling } from "pdf-lib";
import CalibrationPDF, { PAGE_MARGIN } from "./CalibrationPDF";
import { markPrintActualSize } from "./printReady";

const LETTER_WIDTH = 612;

describe("ROC PDF print layout", () => {
  test("uses the SOP 0.5in page margin", () => {
    expect(PAGE_MARGIN / 72).toBe(0.5);
  });

  test("downloads marked to print at actual size so the 0.5in margins survive printing", async () => {
    const rendered = await renderToBuffer(<CalibrationPDF data={{
      roc_number: "2026-1",
      nomenclature: "Current Shunt",
      statements: [{ kind: "technical", text: "Technical statement." }],
      tables: [{ title: "Data", columns: [{ header: "A" }, { header: "B" }], rows: [[1, 2]] }],
    }} />);
    const doc = await PDFDocument.load(await markPrintActualSize(rendered));

    expect(doc.catalog.getViewerPreferences().getPrintScaling()).toBe(PrintScaling.None);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBe(LETTER_WIDTH);
    }
  });
});
