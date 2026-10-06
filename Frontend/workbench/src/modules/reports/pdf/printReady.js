import { PDFDocument, PrintScaling } from "pdf-lib";

/** Mark a rendered ROC PDF to print at actual size.
 *
 * Print dialogs (Chromium/Electron's PDF viewer, Acrobat) default to
 * "fit to printable area", which shrinks the whole page toward the center
 * and pushes the SOP 0.5in side margins out to roughly 0.7in on paper.
 * The PDF ViewerPreferences /PrintScaling /None entry tells them to
 * default to 100% instead. react-pdf has no option for it, so it is set
 * here on the finished bytes. */
export async function markPrintActualSize(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  return doc.save();
}
