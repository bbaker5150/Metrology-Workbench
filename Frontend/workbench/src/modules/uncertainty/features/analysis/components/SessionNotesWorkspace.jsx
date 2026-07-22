import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faExclamationCircle,
  faFolderOpen,
  faSave,
  faSpinner,
} from "@fortawesome/free-solid-svg-icons";
import {
  DocxEditor,
  createDocumentWithText,
  createEmptyDocument,
} from "@heyirisai/docx-editor-react";
import { insertImageFromFile } from "@heyirisai/docx-editor-core/prosemirror/commands";
import "@heyirisai/docx-editor-react/styles.css";

export const DOCX_NOTE_PREFIX = "uncertainty-docx:v1;base64,";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const BLOCK_TAGS = new Set([
  "ADDRESS",
  "BLOCKQUOTE",
  "DIV",
  "FIGCAPTION",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "P",
  "PRE",
]);

const bytesToBase64 = (bytes) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
};

const base64ToBytes = (value) => {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const isDocxNotePayload = (value) =>
  String(value || "").startsWith(DOCX_NOTE_PREFIX);

export const encodeDocxNotePayload = (buffer) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return `${DOCX_NOTE_PREFIX}${bytesToBase64(bytes)}`;
};

export const decodeDocxNotePayload = (value) => {
  if (!isDocxNotePayload(value)) return null;
  return base64ToBytes(String(value).slice(DOCX_NOTE_PREFIX.length));
};

/**
 * Converts notes saved by the former HTML editor into readable DOCX seed text.
 * The original HTML is left untouched until the first successful DOCX save.
 */
export const legacyNotesToText = (value = "") => {
  const source = String(value || "");
  if (!source.trim()) return "";
  if (!/<[a-z][\s\S]*>/i.test(source)) return source;

  const holder = document.createElement("div");
  holder.innerHTML = source;
  holder.querySelectorAll("script, style, iframe, object, embed").forEach((node) => node.remove());

  const readNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName;
    if (tag === "BR") return "\n";
    if (tag === "IMG") {
      const label = node.getAttribute("alt") || "reference image";
      return `[Image: ${label}]`;
    }
    if (tag === "TR") {
      const cells = [...node.children]
        .filter((child) => child.matches("th, td"))
        .map((child) => readNode(child).trim());
      return `${cells.join("\t")}\n`;
    }

    const content = [...node.childNodes].map(readNode).join("");
    return BLOCK_TAGS.has(tag) ? `${content}\n` : content;
  };

  return [...holder.childNodes]
    .map(readNode)
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const sanitizeFileName = (value) =>
  String(value || "Notes")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "Notes";

const imageSourceToFile = async (source, fileName) => {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Unable to read ${fileName || "legacy image"}.`);
  const blob = await response.blob();
  return new File([blob], fileName || "reference-image.png", {
    type: blob.type || "image/png",
  });
};

const useApplicationColorMode = () => {
  const getMode = () =>
    document.body.classList.contains("dark-mode") ? "dark" : "light";
  const [mode, setMode] = useState(getMode);

  useEffect(() => {
    const observer = new MutationObserver(() => setMode(getMode()));
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return mode;
};

const SaveState = ({ state }) => {
  if (state === "saved") return null;

  const configuration = {
    pending: [faSpinner, "Saving", "is-saving"],
    saving: [faSpinner, "Saving", "is-saving"],
    error: [faExclamationCircle, "Save failed", "is-error"],
  }[state] || [faSpinner, "Saving", "is-saving"];

  return (
    <span className={`session-notes-save-state ${configuration[2]}`} role="status" aria-live="polite">
      <FontAwesomeIcon icon={configuration[0]} spin={configuration[2] === "is-saving"} />
      {configuration[1]}
    </span>
  );
};

const SessionDocxEditor = ({
  sessionData,
  sessionImageCache,
  onLoadSessionImages,
  onNotesSave,
}) => {
  const editorRef = useRef(null);
  const importInputRef = useRef(null);
  const saveTimerRef = useRef(null);
  const savingRef = useRef(null);
  const editorReadyRef = useRef(false);
  const dirtyRef = useRef(false);
  const changeVersionRef = useRef(0);
  const legacyImagesMigratedRef = useRef(false);
  const isLegacyDocumentRef = useRef(!isDocxNotePayload(sessionData?.notes));
  const lastSavedPayloadRef = useRef(sessionData?.notes || "");
  const [saveState, setSaveState] = useState("saved");
  const [documentRevision, setDocumentRevision] = useState(0);
  const [documentSource, setDocumentSource] = useState(() => {
    try {
      const buffer = decodeDocxNotePayload(sessionData?.notes);
      if (buffer) return { type: "buffer", value: buffer };
    } catch {
      // A damaged native payload falls back to readable text instead of
      // preventing the Notes workspace from opening.
    }
    const legacyText = legacyNotesToText(sessionData?.notes);
    return {
      type: "document",
      value: legacyText ? createDocumentWithText(legacyText) : createEmptyDocument(),
    };
  });
  const [editorError, setEditorError] = useState("");
  const colorMode = useApplicationColorMode();
  const sessionId = sessionData?.id;
  const documentName = sanitizeFileName(
    `${sessionData?.name || sessionData?.title || "Analysis Session"} Notes`,
  );
  const authorName = String(
    typeof sessionData?.analyst === "string"
      ? sessionData.analyst
      : sessionData?.analyst?.name || sessionData?.analyst?.username || "Analyst",
  );

  const persistBuffer = useCallback(async (buffer, savedChangeVersion = null) => {
    if (!buffer || !sessionId) return false;
    const payload = encodeDocxNotePayload(buffer);
    if (payload === lastSavedPayloadRef.current) {
      if (savedChangeVersion === null || savedChangeVersion === changeVersionRef.current) {
        dirtyRef.current = false;
      }
      setSaveState("saved");
      return true;
    }

    setSaveState("saving");
    try {
      await onNotesSave?.(sessionId, payload);
      lastSavedPayloadRef.current = payload;
      if (savedChangeVersion === null || savedChangeVersion === changeVersionRef.current) {
        dirtyRef.current = false;
      }
      setSaveState("saved");
      return true;
    } catch (error) {
      setEditorError(error?.message || "The document could not be saved.");
      setSaveState("error");
      return false;
    }
  }, [onNotesSave, sessionId]);

  const saveNow = useCallback(async ({ force = false } = {}) => {
    clearTimeout(saveTimerRef.current);
    if ((!dirtyRef.current && !force) || !editorRef.current) return null;
    if (savingRef.current) return savingRef.current;

    savingRef.current = (async () => {
      const savedChangeVersion = changeVersionRef.current;
      try {
        const buffer = await editorRef.current?.save({ selective: false });
        if (buffer) await persistBuffer(buffer, savedChangeVersion);
        if (savedChangeVersion !== changeVersionRef.current) {
          dirtyRef.current = true;
          setSaveState("pending");
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => saveNow(), 200);
        }
        return buffer;
      } catch (error) {
        setEditorError(error?.message || "The document could not be saved.");
        setSaveState("error");
        return null;
      } finally {
        savingRef.current = null;
      }
    })();
    return savingRef.current;
  }, [persistBuffer]);

  const queueSave = useCallback(() => {
    if (!editorReadyRef.current) return;
    changeVersionRef.current += 1;
    dirtyRef.current = true;
    setSaveState("pending");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveNow(), 700);
  }, [saveNow]);

  const migrateLegacyImages = useCallback(async () => {
    const imageRefs = sessionData?.noteImages || [];
    if (
      !isLegacyDocumentRef.current ||
      legacyImagesMigratedRef.current ||
      !imageRefs.length
    ) return;

    legacyImagesMigratedRef.current = true;
    try {
      let sources = sessionImageCache?.get(sessionId);
      if (!sources?.size && onLoadSessionImages) {
        const loaded = await onLoadSessionImages(sessionId);
        sources = new Map((loaded || []).map((image) => [String(image.id), image.data]));
      }

      const pagedEditor = editorRef.current?.getEditorRef();
      const view = pagedEditor?.getView();
      if (!view || !sources?.size) return;

      for (const imageRef of imageRefs) {
        const source = sources.get(imageRef.id) || sources.get(String(imageRef.id));
        if (!source) continue;
        const file = await imageSourceToFile(source, imageRef.fileName);
        pagedEditor.setSelection(view.state.doc.content.size);
        await new Promise((resolve, reject) => {
          insertImageFromFile(view, file, {
            onInserted: resolve,
            onError: reject,
          });
        });
      }
      queueSave();
    } catch (error) {
      setEditorError(
        `The note text was migrated, but one or more legacy images could not be embedded: ${error?.message || "unknown image error"}`,
      );
    }
  }, [onLoadSessionImages, queueSave, sessionData?.noteImages, sessionId, sessionImageCache]);

  useEffect(() => {
    const handlePageExit = () => {
      if (dirtyRef.current) void saveNow();
    };
    window.addEventListener("beforeunload", handlePageExit);
    return () => {
      window.removeEventListener("beforeunload", handlePageExit);
      clearTimeout(saveTimerRef.current);
      if (dirtyRef.current) void saveNow();
    };
  }, [saveNow]);

  const openDocument = useCallback(async (file) => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      await persistBuffer(buffer);
      setDocumentSource({ type: "buffer", value: new Uint8Array(buffer) });
      setDocumentRevision((value) => value + 1);
      setEditorError("");
    } catch (error) {
      setEditorError(error?.message || "This DOCX file could not be opened.");
      setSaveState("error");
    }
  }, [persistBuffer]);

  const downloadDocument = useCallback(async () => {
    const buffer = await saveNow({ force: true });
    if (!buffer) return;
    const blob = new Blob([buffer], { type: DOCX_MIME });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${documentName}.docx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [documentName, saveNow]);

  const titleActions = useCallback(() => (
    <div className="session-notes-docx-actions">
      <SaveState state={saveState} />
      <button
        type="button"
        onClick={() => importInputRef.current?.click()}
        title="Load DOCX"
        aria-label="Load DOCX"
      >
        <FontAwesomeIcon icon={faFolderOpen} />
      </button>
      <button
        type="button"
        onClick={downloadDocument}
        title="Save DOCX"
        aria-label="Save DOCX"
      >
        <FontAwesomeIcon icon={faSave} />
      </button>
    </div>
  ), [downloadDocument, saveState]);

  const sourceProps = documentSource.type === "buffer"
    ? { documentBuffer: documentSource.value }
    : { document: documentSource.value };

  return (
    <section className="session-notes-workspace" aria-label="Session notes">
      <input
        ref={importInputRef}
        className="session-notes-file-input"
        type="file"
        accept={`.docx,${DOCX_MIME}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void openDocument(file);
        }}
      />
      {editorError && (
        <div className="session-notes-docx-error" role="alert">
          <FontAwesomeIcon icon={faExclamationCircle} />
          <span>{editorError}</span>
          <button type="button" onClick={() => setEditorError("")} aria-label="Dismiss document error">×</button>
        </div>
      )}
      <div className="session-notes-docx-shell">
        <DocxEditor
          key={`${sessionId}-${documentRevision}`}
          ref={editorRef}
          {...sourceProps}
          mode="editing"
          author={authorName}
          colorMode={colorMode}
          className="session-notes-docx-editor"
          documentName={documentName}
          documentNameEditable={false}
          showToolbar
          showFileOpen={false}
          showHelpMenu={false}
          showRuler
          showOutline={false}
          showOutlineButton
          showZoomControl
          initialZoom={0.9}
          renderTitleBarRight={titleActions}
          onChange={queueSave}
          onEditorViewReady={() => {
            editorReadyRef.current = true;
            setEditorError("");
            void migrateLegacyImages();
          }}
          onError={(error) => {
            setEditorError(error?.message || "The DOCX editor encountered an error.");
            setSaveState("error");
          }}
          loadingIndicator={(
            <div className="session-notes-loading" role="status">
              <span className="session-notes-loading-mark" aria-hidden="true" />
              Opening document…
            </div>
          )}
        />
      </div>
    </section>
  );
};

const SessionNotesWorkspace = (props) => {
  if (!props.sessionData?.id) {
    return (
      <div className="session-notes-empty-state">
        Select or create an analysis session to begin a notes document.
      </div>
    );
  }

  // A keyed inner editor guarantees that switching sessions flushes the old
  // document and constructs a completely isolated DOCX workspace for the new one.
  return <SessionDocxEditor key={props.sessionData.id} {...props} />;
};

export default SessionNotesWorkspace;
