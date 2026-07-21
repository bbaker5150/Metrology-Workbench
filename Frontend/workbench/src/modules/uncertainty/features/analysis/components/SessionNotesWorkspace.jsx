import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faAlignCenter,
  faAlignLeft,
  faAlignRight,
  faBold,
  faCheckCircle,
  faHeading,
  faImage,
  faItalic,
  faLink,
  faListOl,
  faListUl,
  faQuoteRight,
  faRedo,
  faRemoveFormat,
  faTrashAlt,
  faUnderline,
  faUndo,
} from "@fortawesome/free-solid-svg-icons";

const ALLOWED_TAGS = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "CODE", "DIV", "EM", "FIGCAPTION",
  "FIGURE", "H1", "H2", "H3", "HR", "I", "IMG", "LI", "OL", "P",
  "PRE", "S", "SPAN", "STRONG", "U", "UL",
]);
const FIGURE_ATTRIBUTES = new Set([
  "data-note-image-id",
  "data-note-width",
  "data-note-align",
  "data-note-wrap",
]);
const MIN_IMAGE_WIDTH = 15;
const DEFAULT_IMAGE_WIDTH = 70;

const clampImageWidth = (value) =>
  Math.min(100, Math.max(MIN_IMAGE_WIDTH, Number(value) || DEFAULT_IMAGE_WIDTH));

export const normalizeNoteHtml = (value = "") => {
  const text = String(value || "");
  if (!text.trim()) return "";
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  const holder = document.createElement("div");
  holder.textContent = text;
  return holder.innerHTML.replace(/\r?\n/g, "<br>");
};

export const sanitizeNoteHtml = (value = "", { stripImageSources = false } = {}) => {
  const container = document.createElement("div");
  container.innerHTML = String(value || "");

  [...container.querySelectorAll("script, style, iframe, object, embed, form")]
    .forEach((node) => node.remove());

  [...container.querySelectorAll("*")].forEach((node) => {
    if (!ALLOWED_TAGS.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }

    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const allowed =
        (node.tagName === "A" && ["href", "target", "rel"].includes(name)) ||
        (node.tagName === "IMG" && ["src", "alt", "data-note-image-id"].includes(name)) ||
        (node.tagName === "FIGURE" && FIGURE_ATTRIBUTES.has(name));
      if (!allowed) node.removeAttribute(attribute.name);
    });

    if (node.tagName === "A") {
      const href = node.getAttribute("href") || "";
      if (!/^(https?:|mailto:)/i.test(href)) node.removeAttribute("href");
      node.setAttribute("rel", "noopener noreferrer");
      node.setAttribute("target", "_blank");
    }

    if (node.tagName === "FIGURE") {
      node.dataset.noteWidth = String(clampImageWidth(node.dataset.noteWidth));
      if (!new Set(["left", "center", "right"]).has(node.dataset.noteAlign)) {
        node.dataset.noteAlign = "center";
      }
      if (!new Set(["none", "left", "right"]).has(node.dataset.noteWrap)) {
        node.dataset.noteWrap = "none";
      }
    }

    if (node.tagName === "IMG") {
      const imageId = node.getAttribute("data-note-image-id");
      const src = node.getAttribute("src") || "";
      if (!imageId) {
        node.remove();
      } else if (stripImageSources || !src.startsWith("data:image/")) {
        node.removeAttribute("src");
      }
    }
  });

  return container.innerHTML;
};

export const applyStoredImageLayouts = (root) => {
  root?.querySelectorAll("figure[data-note-image-id]").forEach((figure) => {
    figure.style.width = `${clampImageWidth(figure.dataset.noteWidth)}%`;
    figure.draggable = true;
  });
};

export const serializeNoteDocument = (editor) =>
  sanitizeNoteHtml(editor?.innerHTML || "", { stripImageSources: true });

const readFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const SessionNotesWorkspace = ({
  sessionData,
  sessionImageCache,
  onSessionImageCacheChange,
  onLoadSessionImages,
  onSessionSave,
  onNotesSave,
}) => {
  const shellRef = useRef(null);
  const editorRef = useRef(null);
  const uploadRef = useRef(null);
  const replaceRef = useRef(null);
  const saveTimerRef = useRef(null);
  const selectionRef = useRef(null);
  const draggedImageIdRef = useRef(null);
  const lastSavedRef = useRef(sessionData?.notes || "");
  const loadedSessionIdRef = useRef(null);
  const sessionRef = useRef(sessionData);
  const [saveState, setSaveState] = useState("saved");
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [selectedLayout, setSelectedLayout] = useState(null);
  const [overlayRect, setOverlayRect] = useState(null);
  const sessionId = sessionData?.id;
  const imageRefs = sessionData?.noteImages || [];
  const imageCache = sessionId ? sessionImageCache?.get(sessionId) : null;

  useEffect(() => {
    sessionRef.current = sessionData;
  }, [sessionData]);

  const getFigure = useCallback((imageId = selectedImageId) => {
    if (!imageId || !editorRef.current) return null;
    return [...editorRef.current.querySelectorAll("figure[data-note-image-id]")]
      .find((figure) => String(figure.dataset.noteImageId) === String(imageId)) || null;
  }, [selectedImageId]);

  const readFigureLayout = useCallback((figure) => {
    if (!figure) return null;
    return {
      width: clampImageWidth(figure.dataset.noteWidth),
      align: figure.dataset.noteAlign || "center",
      wrap: figure.dataset.noteWrap || "none",
      caption: figure.querySelector("figcaption")?.textContent || "",
    };
  }, []);

  const refreshSelectionOverlay = useCallback(() => {
    const figure = getFigure();
    const shell = shellRef.current;
    if (!figure || !shell) {
      setOverlayRect(null);
      return;
    }
    const figureRect = figure.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    setOverlayRect({
      left: figureRect.left - shellRect.left,
      top: figureRect.top - shellRect.top,
      width: figureRect.width,
      height: figureRect.height,
    });
    setSelectedLayout(readFigureLayout(figure));
  }, [getFigure, readFigureLayout]);

  const selectImage = useCallback((imageId) => {
    editorRef.current?.querySelectorAll("figure[data-note-selected]")
      .forEach((figure) => figure.removeAttribute("data-note-selected"));
    const figure = imageId
      ? [...(editorRef.current?.querySelectorAll("figure[data-note-image-id]") || [])]
        .find((item) => String(item.dataset.noteImageId) === String(imageId))
      : null;
    if (figure) figure.dataset.noteSelected = "true";
    setSelectedImageId(figure ? imageId : null);
    setSelectedLayout(readFigureLayout(figure));
    if (!figure) setOverlayRect(null);
  }, [readFigureLayout]);

  const hydratedHtml = useMemo(() => {
    const holder = document.createElement("div");
    holder.innerHTML = sanitizeNoteHtml(normalizeNoteHtml(sessionData?.notes || ""));
    holder.querySelectorAll("img[data-note-image-id]").forEach((image) => {
      const source = imageCache?.get(image.dataset.noteImageId);
      if (source) image.setAttribute("src", source);
    });
    applyStoredImageLayouts(holder);
    return holder.innerHTML;
  }, [imageCache, sessionData?.notes]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    const isCurrentDocument =
      loadedSessionIdRef.current === sessionId &&
      (sessionData?.notes || "") === lastSavedRef.current;
    if (isCurrentDocument) {
      editor.querySelectorAll("img[data-note-image-id]").forEach((image) => {
        const source = imageCache?.get(image.dataset.noteImageId);
        if (source && image.getAttribute("src") !== source) image.setAttribute("src", source);
      });
      applyStoredImageLayouts(editor);
      return;
    }
    if (editor.innerHTML !== hydratedHtml) editor.innerHTML = hydratedHtml;
    applyStoredImageLayouts(editor);
    lastSavedRef.current = sessionData?.notes || "";
    loadedSessionIdRef.current = sessionId;
    selectImage(null);
  }, [hydratedHtml, imageCache, selectImage, sessionData?.notes, sessionId]);

  useEffect(() => {
    if (!sessionId || !imageRefs.length || imageCache?.size || !onLoadSessionImages) return;
    let cancelled = false;
    onLoadSessionImages(sessionId).then((loaded) => {
      if (cancelled || !loaded?.length) return;
      onSessionImageCacheChange((previous) => {
        const next = new Map(previous);
        const sessionMap = new Map(next.get(sessionId) || []);
        loaded.forEach((image) => sessionMap.set(image.id, image.data));
        next.set(sessionId, sessionMap);
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [imageCache?.size, imageRefs.length, onLoadSessionImages, onSessionImageCacheChange, sessionId]);

  const saveDocument = useCallback(async () => {
    if (!editorRef.current || !sessionId) return;
    const notes = serializeNoteDocument(editorRef.current);
    if (notes === lastSavedRef.current) {
      setSaveState("saved");
      return;
    }
    lastSavedRef.current = notes;
    setSaveState("saving");
    try {
      await onNotesSave?.(sessionId, notes);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [onNotesSave, sessionId]);

  const queueSave = useCallback(() => {
    setSaveState("pending");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(saveDocument, 500);
  }, [saveDocument]);

  useEffect(() => () => {
    clearTimeout(saveTimerRef.current);
    if (editorRef.current) saveDocument();
  }, [saveDocument]);

  useEffect(() => {
    if (!selectedImageId) return undefined;
    const handleLayoutChange = () => refreshSelectionOverlay();
    const resizeObserver = new ResizeObserver(handleLayoutChange);
    const figure = getFigure();
    if (figure) resizeObserver.observe(figure);
    window.addEventListener("resize", handleLayoutChange);
    document.addEventListener("scroll", handleLayoutChange, true);
    requestAnimationFrame(handleLayoutChange);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleLayoutChange);
      document.removeEventListener("scroll", handleLayoutChange, true);
    };
  }, [getFigure, refreshSelectionOverlay, selectedImageId]);

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editorRef.current?.contains(selection.anchorNode)) {
      selectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    const selection = window.getSelection();
    if (!selectionRef.current || !selection) return;
    selection.removeAllRanges();
    selection.addRange(selectionRef.current);
  };

  const runCommand = (command, value = null) => {
    selectImage(null);
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand(command, false, value);
    rememberSelection();
    queueSave();
  };

  const createImageFigure = useCallback((id, fileName, source) => {
    const safeName = document.createElement("span");
    safeName.textContent = fileName || "Reference image";
    const wrapper = document.createElement("div");
    wrapper.innerHTML = (
      `<figure data-note-image-id="${id}" data-note-width="${DEFAULT_IMAGE_WIDTH}" ` +
      `data-note-align="center" data-note-wrap="none"><img src="${source}" ` +
      `data-note-image-id="${id}" alt="${safeName.innerHTML}">` +
      `<figcaption>${safeName.innerHTML}</figcaption></figure><p><br></p>`
    );
    applyStoredImageLayouts(wrapper);
    return wrapper;
  }, []);

  const insertImageMarkup = useCallback((id, fileName, source) => {
    editorRef.current?.focus();
    restoreSelection();
    const wrapper = createImageFigure(id, fileName, source);
    document.execCommand("insertHTML", false, wrapper.innerHTML);
    applyStoredImageLayouts(editorRef.current);
    selectImage(id);
    rememberSelection();
  }, [createImageFigure, selectImage]);

  const addFiles = useCallback(async (files) => {
    const images = [...files].filter((file) => file.type.startsWith("image/"));
    if (!images.length || !sessionRef.current) return;
    const newFiles = await Promise.all(images.map(async (file) => ({
      id: uuidv4(),
      fileName: file.name || "Pasted image",
      fileObject: await readFile(file),
    })));
    const newRefs = newFiles.map(({ id, fileName }) => ({ id, fileName }));

    onSessionImageCacheChange((previous) => {
      const next = new Map(previous);
      const sessionMap = new Map(next.get(sessionId) || []);
      newFiles.forEach((image) => sessionMap.set(image.id, image.fileObject));
      next.set(sessionId, sessionMap);
      return next;
    });
    newFiles.forEach((image) => insertImageMarkup(image.id, image.fileName, image.fileObject));

    const notes = serializeNoteDocument(editorRef.current);
    lastSavedRef.current = notes;
    const updatedSession = {
      ...sessionRef.current,
      notes,
      noteImages: [...(sessionRef.current.noteImages || []), ...newRefs],
    };
    sessionRef.current = updatedSession;
    setSaveState("saving");
    await onSessionSave(updatedSession, newFiles);
    setSaveState("saved");
  }, [insertImageMarkup, onSessionImageCacheChange, onSessionSave, sessionId]);

  const updateSelectedLayout = useCallback((updates, persist = true) => {
    const figure = getFigure();
    if (!figure) return;
    if (updates.width != null) {
      figure.dataset.noteWidth = String(clampImageWidth(updates.width));
      figure.style.width = `${clampImageWidth(updates.width)}%`;
    }
    if (updates.align) {
      figure.dataset.noteAlign = updates.align;
      figure.dataset.noteWrap = "none";
    }
    if (updates.wrap) {
      figure.dataset.noteWrap = updates.wrap;
      if (updates.wrap !== "none") figure.dataset.noteAlign = updates.wrap;
    }
    if (updates.caption != null) {
      let caption = figure.querySelector("figcaption");
      if (!caption) {
        caption = document.createElement("figcaption");
        figure.appendChild(caption);
      }
      caption.textContent = updates.caption;
    }
    setSelectedLayout(readFigureLayout(figure));
    requestAnimationFrame(refreshSelectionOverlay);
    if (persist) queueSave();
  }, [getFigure, queueSave, readFigureLayout, refreshSelectionOverlay]);

  const removeSelectedImage = useCallback(async () => {
    const figure = getFigure();
    const imageId = figure?.dataset.noteImageId;
    if (!figure || !imageId) return;
    figure.remove();
    selectImage(null);
    onSessionImageCacheChange((previous) => {
      const next = new Map(previous);
      const sessionMap = new Map(next.get(sessionId) || []);
      sessionMap.delete(imageId);
      next.set(sessionId, sessionMap);
      return next;
    });
    const notes = serializeNoteDocument(editorRef.current);
    lastSavedRef.current = notes;
    const updatedSession = {
      ...sessionRef.current,
      notes,
      noteImages: (sessionRef.current.noteImages || [])
        .filter((image) => String(image.id) !== String(imageId)),
    };
    sessionRef.current = updatedSession;
    setSaveState("saving");
    await onSessionSave(updatedSession);
    setSaveState("saved");
  }, [getFigure, onSessionImageCacheChange, onSessionSave, selectImage, sessionId]);

  const replaceSelectedImage = useCallback(async (file) => {
    const figure = getFigure();
    const imageId = figure?.dataset.noteImageId;
    if (!file?.type.startsWith("image/") || !figure || !imageId) return;
    const fileObject = await readFile(file);
    figure.querySelector("img")?.setAttribute("src", fileObject);
    figure.querySelector("img")?.setAttribute("alt", file.name || "Reference image");
    updateSelectedLayout({ caption: file.name || selectedLayout?.caption || "Reference image" }, false);
    onSessionImageCacheChange((previous) => {
      const next = new Map(previous);
      const sessionMap = new Map(next.get(sessionId) || []);
      sessionMap.set(imageId, fileObject);
      next.set(sessionId, sessionMap);
      return next;
    });
    const notes = serializeNoteDocument(editorRef.current);
    lastSavedRef.current = notes;
    const updatedSession = {
      ...sessionRef.current,
      notes,
      noteImages: (sessionRef.current.noteImages || []).map((image) =>
        String(image.id) === String(imageId)
          ? { ...image, fileName: file.name || image.fileName }
          : image),
    };
    sessionRef.current = updatedSession;
    setSaveState("saving");
    await onSessionSave(updatedSession, [{ imageId, id: imageId, fileName: file.name, fileObject }]);
    setSaveState("saved");
  }, [getFigure, onSessionImageCacheChange, onSessionSave, selectedLayout?.caption, sessionId, updateSelectedLayout]);

  const startResize = useCallback((event, handle) => {
    event.preventDefault();
    event.stopPropagation();
    const figure = getFigure();
    const editor = editorRef.current;
    if (!figure || !editor) return;
    const startX = event.clientX;
    const startWidth = figure.getBoundingClientRect().width;
    const editorWidth = editor.getBoundingClientRect().width;
    const direction = handle.includes("w") ? -1 : 1;

    const move = (moveEvent) => {
      const nextPixels = startWidth + ((moveEvent.clientX - startX) * direction);
      const nextPercent = (nextPixels / editorWidth) * 100;
      updateSelectedLayout({ width: nextPercent }, false);
      setSaveState("pending");
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      queueSave();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }, [getFigure, queueSave, updateSelectedLayout]);

  const reorderSelectedImage = useCallback((event) => {
    const draggedId = draggedImageIdRef.current;
    if (!draggedId) return false;
    event.preventDefault();
    const figure = [...editorRef.current.querySelectorAll("figure[data-note-image-id]")]
      .find((item) => String(item.dataset.noteImageId) === String(draggedId));
    if (!figure) return false;
    const target = event.target.closest("figure, p, h1, h2, h3, blockquote, ul, ol, div");
    if (target === figure) {
      draggedImageIdRef.current = null;
      return true;
    }
    if (
      target &&
      target !== figure &&
      target !== editorRef.current &&
      editorRef.current.contains(target)
    ) {
      const targetRect = target.getBoundingClientRect();
      target.parentNode.insertBefore(
        figure,
        event.clientY > targetRect.top + (targetRect.height / 2)
          ? target.nextSibling
          : target,
      );
    } else {
      editorRef.current.appendChild(figure);
    }
    draggedImageIdRef.current = null;
    selectImage(draggedId);
    queueSave();
    return true;
  }, [queueSave, selectImage]);

  const promptForLink = () => {
    const href = window.prompt("Link address (https:// or mailto:)");
    if (href && /^(https?:|mailto:)/i.test(href)) runCommand("createLink", href);
  };

  const tools = [
    [faHeading, "Heading", () => runCommand("formatBlock", "H2")],
    [faBold, "Bold", () => runCommand("bold")],
    [faItalic, "Italic", () => runCommand("italic")],
    [faUnderline, "Underline", () => runCommand("underline")],
    [faListUl, "Bulleted list", () => runCommand("insertUnorderedList")],
    [faListOl, "Numbered list", () => runCommand("insertOrderedList")],
    [faQuoteRight, "Quote", () => runCommand("formatBlock", "BLOCKQUOTE")],
    [faLink, "Insert link", promptForLink],
    [faRemoveFormat, "Clear formatting", () => runCommand("removeFormat")],
    [faUndo, "Undo", () => runCommand("undo")],
    [faRedo, "Redo", () => runCommand("redo")],
  ];

  return (
    <section className="session-notes-workspace" aria-label="Session notes">
      <div ref={shellRef} className="session-notes-document-shell">
        <div className="session-notes-toolbar" role="toolbar" aria-label="Note formatting">
          {tools.map(([icon, label, action]) => (
            <button key={label} type="button" title={label} aria-label={label}
              onMouseDown={(event) => event.preventDefault()} onClick={action}>
              <FontAwesomeIcon icon={icon} />
            </button>
          ))}
          <span className="session-notes-toolbar-spacer" />
          <span className={`session-notes-save-state is-${saveState}`}>
            {saveState === "saved" && <FontAwesomeIcon icon={faCheckCircle} />}
            {saveState === "error" ? "Save failed" : saveState === "saved" ? "Saved" : "Saving…"}
          </span>
          <button type="button" title="Add images" aria-label="Add images"
            onClick={() => uploadRef.current?.click()}>
            <FontAwesomeIcon icon={faImage} />
            <span>Image</span>
          </button>
          <input ref={uploadRef} className="session-notes-file-input" type="file"
            accept="image/*" multiple onChange={(event) => {
              addFiles(event.target.files || []);
              event.target.value = "";
            }} />
        </div>

        {selectedImageId && selectedLayout && (
          <div className="session-notes-image-toolbar" role="toolbar" aria-label="Selected image controls">
            <span className="session-notes-image-toolbar-label">Image</span>
            <div className="session-notes-image-tool-group" aria-label="Image alignment">
              {[
                ["left", faAlignLeft, "Align left"],
                ["center", faAlignCenter, "Align center"],
                ["right", faAlignRight, "Align right"],
              ].map(([value, icon, label]) => (
                <button key={value} type="button" title={label} aria-label={label}
                  className={selectedLayout.wrap === "none" && selectedLayout.align === value ? "is-active" : ""}
                  onClick={() => updateSelectedLayout({ align: value })}>
                  <FontAwesomeIcon icon={icon} />
                </button>
              ))}
            </div>
            <div className="session-notes-image-wrap-controls" aria-label="Image text wrapping">
              <button type="button" className={selectedLayout.wrap === "none" ? "is-active" : ""}
                onClick={() => updateSelectedLayout({ wrap: "none" })}>Inline</button>
              <button type="button" className={selectedLayout.wrap === "left" ? "is-active" : ""}
                onClick={() => updateSelectedLayout({ wrap: "left" })}>Wrap left</button>
              <button type="button" className={selectedLayout.wrap === "right" ? "is-active" : ""}
                onClick={() => updateSelectedLayout({ wrap: "right" })}>Wrap right</button>
            </div>
            <label className="session-notes-image-width-control">
              <span>Width</span>
              <input type="range" min={MIN_IMAGE_WIDTH} max="100" step="1"
                value={selectedLayout.width}
                onChange={(event) => updateSelectedLayout({ width: event.target.value })} />
              <output>{Math.round(selectedLayout.width)}%</output>
            </label>
            <label className="session-notes-image-caption-control">
              <span>Caption / notation</span>
              <input type="text" value={selectedLayout.caption}
                placeholder="Add a caption or notation"
                onChange={(event) => updateSelectedLayout({ caption: event.target.value })} />
            </label>
            <button type="button" className="session-notes-image-replace"
              onClick={() => replaceRef.current?.click()}>Replace</button>
            <input ref={replaceRef} className="session-notes-file-input" type="file" accept="image/*"
              onChange={(event) => {
                replaceSelectedImage(event.target.files?.[0]);
                event.target.value = "";
              }} />
            <button type="button" className="session-notes-image-delete"
              onClick={removeSelectedImage} title="Delete image" aria-label="Delete selected image">
              <FontAwesomeIcon icon={faTrashAlt} />
            </button>
          </div>
        )}

        <div
          ref={editorRef}
          className="session-notes-editor"
          contentEditable
          suppressContentEditableWarning
          onInput={() => {
            queueSave();
            if (selectedImageId) refreshSelectionOverlay();
          }}
          onClick={(event) => {
            const figure = event.target.closest("figure[data-note-image-id]");
            if (figure) {
              selectImage(figure.dataset.noteImageId);
              requestAnimationFrame(refreshSelectionOverlay);
            } else {
              selectImage(null);
            }
          }}
          onKeyDown={(event) => {
            if (!selectedImageId || !["Delete", "Backspace"].includes(event.key)) return;
            const anchor = window.getSelection()?.anchorNode;
            if (anchor?.parentElement?.closest("figcaption")) return;
            event.preventDefault();
            removeSelectedImage();
          }}
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
          onPaste={(event) => {
            const files = [...(event.clipboardData?.files || [])];
            if (files.some((file) => file.type.startsWith("image/"))) {
              event.preventDefault();
              addFiles(files);
            }
          }}
          onDragStart={(event) => {
            const figure = event.target.closest("figure[data-note-image-id]");
            if (!figure) return;
            draggedImageIdRef.current = figure.dataset.noteImageId;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", figure.dataset.noteImageId);
            selectImage(figure.dataset.noteImageId);
          }}
          onDragEnd={() => {
            draggedImageIdRef.current = null;
          }}
          onDragOver={(event) => {
            if (draggedImageIdRef.current || [...(event.dataTransfer?.files || [])]
              .some((file) => file.type.startsWith("image/"))) event.preventDefault();
          }}
          onDrop={(event) => {
            if (reorderSelectedImage(event)) return;
            const files = [...(event.dataTransfer?.files || [])];
            if (files.some((file) => file.type.startsWith("image/"))) {
              event.preventDefault();
              addFiles(files);
            }
          }}
        />

        {selectedImageId && overlayRect && (
          <div className="session-notes-image-selection" aria-hidden="true" style={overlayRect}>
            {["nw", "ne", "sw", "se"].map((handle) => (
              <button key={handle} type="button" tabIndex="-1"
                className={`session-notes-image-resize-handle is-${handle}`}
                onPointerDown={(event) => startResize(event, handle)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default SessionNotesWorkspace;
