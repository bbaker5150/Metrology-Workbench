import * as PDFLib from "pdf-lib";
import { generateOverviewReport } from "./pdfGenerator"; 
import { 
  getToleranceErrorSummary,
  getAbsoluteLimits, 
  getTmdeAbsoluteLimits,
} from "./uncertaintyMath";
import { computeRiskMetricsMap } from "./riskCompute";

const {
  PDFDocument,
  StandardFonts,
  PDFName,
  PDFDict,
  PDFArray,
  PDFHexString,
  PDFString,
  PDFStream,
  decodePDFRawStream,
  PDFRawStream,
} = PDFLib;

const GUARDBAND_REPORT_COLUMNS = [
  "gbPfa",
  "gbPfr",
  "gbMult",
  "gbLow",
  "gbHigh",
  "gbCalInt",
  "gbMeasRel",
  "noGbPfa",
  "noGbPfr",
  "noGbCalInt",
  "noGbMeasRel",
];

const SESSION_BACKUP_FORMAT = "uncertalytics-session";
const SESSION_BACKUP_VERSION = 1;

const sessionFileName = (session, extension) => {
  // A single extension also avoids Firepit rejecting names such as meter.exe.json.
  const name = String(session.name || session.uutDescription || "Session")
    .normalize("NFKC").replace(/[^\p{L}\p{N} _-]/gu, "_").trim().slice(0, 100) || "Session";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `Uncertalytics_${name}_${stamp}.${extension}`;
};

const downloadBlob = (blob, fileName) => {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Firepit reads and inspects the bytes asynchronously after the click.
    window.setTimeout(() => URL.revokeObjectURL(href), 60000);
  }
};

const validId = (id) => (typeof id === "string" && id.length > 0) ||
  (typeof id === "number" && Number.isFinite(id));

const validateSession = (session) => {
  if (!session || typeof session !== "object" || Array.isArray(session) ||
      !validId(session.id) || !Array.isArray(session.testPoints) ||
      (session.noteImages !== undefined && !Array.isArray(session.noteImages))) {
    throw new Error("This file does not contain a valid Uncertalytics session.");
  }
  const ids = new Set();
  for (const image of session.noteImages || []) {
    if (!image || !validId(image.id) || ids.has(String(image.id))) {
      throw new Error("The session contains invalid or duplicate note image references.");
    }
    ids.add(String(image.id));
  }
};

const validateImageDataUrl = (value) => {
  if (typeof value !== "string" || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Session note images must contain PNG or JPEG image data.");
  }
  try {
    window.atob(value.slice(value.indexOf(",") + 1));
  } catch {
    throw new Error("A session note image contains invalid encoded data.");
  }
  return value;
};

// Firepit reconstructs PDF reports without their embedded attachments. A JSON
// backup keeps the editable session and its legacy note images together.
export const saveSessionToJson = async (session, sessionImagesMap = new Map()) => {
  validateSession(session);
  const images = [];
  for (const reference of session.noteImages || []) {
    const image = sessionImagesMap?.get(reference.id) ??
      sessionImagesMap?.get(String(reference.id)) ?? reference.fileObject;
    let dataUrl = image;
    if (image instanceof Blob) {
      dataUrl = `data:${image.type};base64,${uint8ArrayToBase64(await image.arrayBuffer())}`;
    }
    if (!dataUrl) {
      throw new Error(`The note image "${reference.fileName || reference.id}" is unavailable. Load or reattach it before exporting a complete session backup.`);
    }
    images.push({ id: reference.id, dataUrl: validateImageDataUrl(dataUrl) });
  }
  const backup = { format: SESSION_BACKUP_FORMAT, version: SESSION_BACKUP_VERSION, session, images };
  downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }), sessionFileName(session, "json"));
};

export const parseSessionFile = async (file) => {
  if (/\.pdf$/i.test(file.name || "")) return parseSessionPdf(file);
  if (!/\.json$/i.test(file.name || "")) throw new Error("Choose a session JSON backup or a legacy session PDF.");
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error("The session JSON backup could not be read.");
  }
  if (backup?.format !== SESSION_BACKUP_FORMAT || backup.version !== SESSION_BACKUP_VERSION || !Array.isArray(backup.images)) {
    throw new Error("This is not a supported Uncertalytics session backup.");
  }
  validateSession(backup.session);
  const referenced = new Set((backup.session.noteImages || []).map(image => image.id));
  const images = new Map();
  for (const image of backup.images) {
    if (!image || !referenced.has(image.id) || images.has(image.id)) {
      throw new Error("The session backup contains invalid or duplicate image data.");
    }
    images.set(image.id, validateImageDataUrl(image.dataUrl));
  }
  if (images.size !== referenced.size) throw new Error("The session backup is missing note image data.");
  return { session: backup.session, images };
};

// --- Helper: Convert Uint8Array to Base64 (For Loading) ---
const uint8ArrayToBase64 = (buffer) => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

// --- Helper: Get Bytes from Blob or Base64 (For Saving) ---
const getImageBytes = async (fileObject) => {
  if (typeof fileObject === 'string') {
    // Handle Base64 Data URI (e.g., "data:image/png;base64,iVBOR...")
    const base64Data = fileObject.split(',')[1];
    if (!base64Data) return new Uint8Array(); 
    
    const binaryString = window.atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } else if (fileObject instanceof Blob) {
    return await fileObject.arrayBuffer();
  }
  return new Uint8Array();
};

const encodeUtf8 = (value) => {
  const encoded = unescape(encodeURIComponent(value));
  return Uint8Array.from(encoded, (character) => character.charCodeAt(0));
};

// --- Helper: Extract Attachments ---
const extractRawAttachments = (pdfDoc) => {
  if (!pdfDoc.catalog.has(PDFName.of("Names"))) return [];
  const Names = pdfDoc.catalog.lookup(PDFName.of("Names"), PDFDict);
  if (!Names.has(PDFName.of("EmbeddedFiles"))) return [];
  const EmbeddedFiles = Names.lookup(PDFName.of("EmbeddedFiles"), PDFDict);
  if (!EmbeddedFiles.has(PDFName.of("Names"))) return [];
  const EFNames = EmbeddedFiles.lookup(PDFName.of("Names"), PDFArray);

  const rawAttachments = [];
  for (let idx = 0, len = EFNames.size(); idx < len; idx += 2) {
    const fileName = EFNames.lookup(idx);
    const fileSpec = EFNames.lookup(idx + 1, PDFDict);
    rawAttachments.push({ fileName, fileSpec });
  }
  return rawAttachments;
};

const extractAttachments = (pdfDoc) => {
  const rawAttachments = extractRawAttachments(pdfDoc);

  return rawAttachments.map(({ fileName, fileSpec }) => {
    const EF = fileSpec.lookup(PDFName.of("EF"), PDFDict);
    const stream = EF.lookup(PDFName.of("F"), PDFStream);

    const subtype = EF.lookup(PDFName.of("Subtype"));
    let mimeType = "application/octet-stream"; 
    if (subtype instanceof PDFName) {
      mimeType = subtype.decodeText();
    }

    let name;
    if (fileName instanceof PDFHexString) {
      name = fileName.decodeText();
    } else if (fileName instanceof PDFString) {
      name = fileName.decodeText();
    } else {
      name = "unknown_attachment";
    }

    // --- FIX: Force correct MIME type if generic based on extension ---
    // This ensures browsers can render the data URI (e.g. data:image/png...)
    if (mimeType === "application/octet-stream" && name) {
        const lowerName = name.toLowerCase();
        if (lowerName.endsWith(".png")) mimeType = "image/png";
        else if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) mimeType = "image/jpeg";
    }

    let data;
    // pdf-lib can be bundled through more than one module path, which makes
    // instanceof unreliable even when the object is a PDFRawStream.
    if (
      stream instanceof PDFRawStream ||
      stream?.constructor?.name === "PDFRawStream"
    ) {
      // Decode raw stream to Uint8Array directly
      data = decodePDFRawStream(stream).decode();
    } else {
      data = stream.contents; // This is already Uint8Array
    }

    return { name, data, mimeType };
  });
};

// --- Exported: Save Session ---
export const createSessionPdfBytes = async (
  currentSession,
  sessionImagesMap,
  reportOptions = {},
) => {
  let now = new Date();

  const fileName = sessionFileName(currentSession, "pdf");

  // 1. Prepare JSON Data
  const jsonData = JSON.stringify(currentSession, null, 2);
  const jsonDataBytes = encodeUtf8(jsonData);

  // 2. Prepare Images
  const imagesToSave = [];
  if (sessionImagesMap && currentSession.noteImages) {
    currentSession.noteImages.forEach((imageRef) => {
      if (sessionImagesMap.has(imageRef.id)) {
        imagesToSave.push({
          fileName: imageRef.fileName,
          fileObject: sessionImagesMap.get(imageRef.id), 
        });
      }
    });
  }

  // 3. Initialize PDF
  const pdfDoc = await PDFDocument.create();
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular: helveticaFont, bold: helveticaBoldFont };

  pdfDoc.setTitle(fileName);
  pdfDoc.setSubject("Uncertalytics session report and restorable session data");
  pdfDoc.setProducer("Uncertalytics");
  pdfDoc.setCreationDate(now);
  pdfDoc.setModificationDate(now);

  // 4. Generate Overview Pages
  const helpers = { getToleranceErrorSummary, getAbsoluteLimits, getTmdeAbsoluteLimits };
  // The calling view can provide its live risk map so the exported numbers
  // are exactly the ones behind the active column filters. Standalone callers
  // still get a fresh calculation, with guardband work limited to reports that
  // actually display guardband or interval-mitigation columns.
  const includeGuardband = reportOptions.includeGuardband ??
    GUARDBAND_REPORT_COLUMNS.some(
      (columnKey) => reportOptions.visibleColumns?.[columnKey],
    );
  const freshlyComputedRisk = reportOptions.riskMetricsMap ||
    computeRiskMetricsMap(
      currentSession.testPoints || [],
      currentSession,
      includeGuardband,
    );
  // Some workbook-parity fields (for example REOP and interval projections)
  // are persisted by the detailed risk calculation, while the lightweight
  // bulk calculator refreshes PFA/PFR/TUR and guardband fields. Merge both so
  // a filtered report mirrors every value visible in the point list.
  const riskMetricsMap = Object.fromEntries(
    (currentSession.testPoints || []).map((point) => [
      point.id,
      { ...(point.riskMetrics || {}), ...(freshlyComputedRisk[point.id] || {}) },
    ]),
  );
  
  await generateOverviewReport(
    pdfDoc,
    currentSession,
    fonts,
    helpers,
    riskMetricsMap,
    reportOptions.visibleColumns,
  );

  // 5. Attach JSON
  await pdfDoc.attach(jsonDataBytes, "sessionData.json", {
    mimeType: "application/json",
    description: "Full MUA session data",
  });

  // 6. Attach Images
  for (const image of imagesToSave) {
    try {
      const imageBytes = await getImageBytes(image.fileObject);
      
      // Determine proper MIME type for saving
      let mimeType = "application/octet-stream";
      if (typeof image.fileObject === 'string') {
        const match = image.fileObject.match(/^data:(.*?);base64,/);
        if (match) mimeType = match[1];
      } else if (image.fileObject.type) {
        mimeType = image.fileObject.type;
      }

      await pdfDoc.attach(imageBytes, image.fileName, {
        mimeType: mimeType,
        description: "User-uploaded note image",
      });
    } catch (err) {
      console.error(`Failed to attach image ${image.fileName}:`, err);
    }
  }

  // 7. Save
  return { pdfBytes: await pdfDoc.save(), fileName };
};

// --- Exported: Save Session ---
export const saveSessionToPdf = async (currentSession, sessionImagesMap, reportOptions = {}) => {
  const { pdfBytes, fileName } = await createSessionPdfBytes(
    currentSession,
    sessionImagesMap,
    reportOptions,
  );
  downloadBlob(new Blob([pdfBytes], { type: "application/pdf" }), fileName);
};

// --- Exported: Load Session ---
export const parseSessionPdf = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(arrayBuffer);
  } catch (error) {
    throw new Error("Failed to load: This does not appear to be a valid PDF file.");
  }

  const attachments = extractAttachments(pdfDoc);
  if (attachments.length === 0) {
    throw new Error("This PDF does not contain any session data attachments. Firepit removes attachments from exported reports; restore the session JSON backup instead.");
  }

  const sessionAttachment = attachments.find((a) => a.name === "sessionData.json");
  if (!sessionAttachment) {
    throw new Error('Error: Could not find the required "sessionData.json" attachment.');
  }

  let jsonData;
  try {
    const textDecoder = new TextDecoder();
    jsonData = textDecoder.decode(sessionAttachment.data);
  } catch (error) {
    throw new Error("Failed to decode session data. The attachment may be corrupt.");
  }

  let loadedSession;
  try {
    loadedSession = JSON.parse(jsonData);
  } catch (error) {
    throw new Error("Failed to parse session data. The JSON data is corrupt.");
  }

  if (
    !loadedSession ||
    loadedSession.id === undefined ||
    !Array.isArray(loadedSession.testPoints)
  ) {
    throw new Error("Error: Attached data is not a valid session object.");
  }

  // 5. Extract Images and Convert to Base64
  const newSessionImagesMap = new Map();
  if (loadedSession.noteImages && loadedSession.noteImages.length > 0) {
    loadedSession.noteImages.forEach((imageRef) => {
      const imageAttachment = attachments.find((a) => a.name === imageRef.fileName);
      if (imageAttachment) {
        const base64String = uint8ArrayToBase64(imageAttachment.data);
        const dataUri = `data:${imageAttachment.mimeType};base64,${base64String}`;
        newSessionImagesMap.set(imageRef.id, dataUri);
      }
    });
  }

  return { session: loadedSession, images: newSessionImagesMap };
};
