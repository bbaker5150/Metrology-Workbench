import SymbolButton from "../common/SymbolButton";
import React, { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faExpand,
  faImages,
  faMinus,
  faPlus,
  faTrashAlt,
} from "@fortawesome/free-solid-svg-icons";
import { v4 as uuidv4 } from "uuid";

const FloatingImagesPanel = ({
  isOpen,
  onClose,
  sessionData,
  sessionImageCache,
  onSessionSave,
  onImageCacheChange,
  onLoadImages,
  onDeleteImage,
}) => {
  const [position, setPosition] = useState({ x: 340, y: 120 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isMinimized, setIsMinimized] = useState(false);
  const [viewingImageSrc, setViewingImageSrc] = useState(null);
  const panelRef = useRef(null);

  const sessionId = sessionData?.id;
  const images = sessionData?.noteImages || [];
  const imageCache = sessionId ? sessionImageCache.get(sessionId) : null;

  useEffect(() => {
    if (!isOpen || !sessionId || !onLoadImages || imageCache?.size > 0) return;

    let cancelled = false;
    onLoadImages(sessionId).then((loadedImages) => {
      if (cancelled || !loadedImages?.length) return;
      onImageCacheChange((prev) => {
        const next = new Map(prev);
        const sessionMap = new Map(next.get(sessionId) || []);
        loadedImages.forEach((img) => sessionMap.set(img.id, img.data));
        next.set(sessionId, sessionMap);
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [imageCache, isOpen, onImageCacheChange, onLoadImages, sessionId]);

  const handleMouseDown = (e) => {
    if (e.target.closest(".notepad-controls") || e.target.closest("button") || e.target.closest("label")) {
      return;
    }
    setIsDragging(true);
    const rect = panelRef.current.getBoundingClientRect();
    setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      setPosition({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
    };
    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragOffset, isDragging]);

  const getImageSrc = (imageRef) => imageCache?.get(imageRef.id) || null;

  const handleUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length || !sessionData) return;

    const newRefs = [];
    const newFiles = [];

    for (const file of files) {
      const id = uuidv4();
      const fileObject = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });

      newRefs.push({ id, fileName: file.name });
      newFiles.push({ id, fileName: file.name, fileObject });
    }

    onImageCacheChange((prev) => {
      const next = new Map(prev);
      const sessionMap = new Map(next.get(sessionData.id) || []);
      newFiles.forEach((img) => sessionMap.set(img.id, img.fileObject));
      next.set(sessionData.id, sessionMap);
      return next;
    });

    onSessionSave(
      {
        ...sessionData,
        noteImages: [...(sessionData.noteImages || []), ...newRefs],
      },
      newFiles,
    );

    event.target.value = "";
  };

  const handleDelete = (event, imageRef) => {
    event.stopPropagation();
    if (!sessionData) return;

    onImageCacheChange((prev) => {
      const next = new Map(prev);
      const sessionMap = new Map(next.get(sessionData.id) || []);
      sessionMap.delete(imageRef.id);
      next.set(sessionData.id, sessionMap);
      return next;
    });

    onSessionSave({
      ...sessionData,
      noteImages: (sessionData.noteImages || []).filter((img) => img.id !== imageRef.id),
    });
    onDeleteImage?.(sessionData.id, imageRef.id);
  };

  if (!isOpen) return null;

  if (isMinimized) {
    return (
      <div
        ref={panelRef}
        className="notepad-minimized image-tool-minimized"
        style={{ left: position.x, top: position.y }}
        onMouseDown={handleMouseDown}
      >
        <div className="notepad-header-min">
          <FontAwesomeIcon icon={faImages} className="notepad-icon" />
          <span className="notepad-title">Images</span>
          <div className="notepad-controls">
            <button onClick={() => setIsMinimized(false)} title="Expand">
              <FontAwesomeIcon icon={faExpand} />
            </button>
            <SymbolButton onClick={onClose} title="Close" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {viewingImageSrc && (
        <div className="image-viewer-overlay" onClick={() => setViewingImageSrc(null)}>
          <SymbolButton className="image-viewer-close" onClick={() => setViewingImageSrc(null)} />
          <img src={viewingImageSrc} alt="Full-size preview" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      <div
        ref={panelRef}
        className="floating-notepad floating-images-panel"
        style={{ left: position.x, top: position.y, width: 360, height: 420 }}
      >
        <div className="notepad-header" onMouseDown={handleMouseDown}>
          <div className="header-left">
            <FontAwesomeIcon icon={faImages} className="notepad-icon" />
            <span className="notepad-title">Session Images</span>
            {images.length > 0 && (
              <span className="floating-images-count">{images.length}</span>
            )}
          </div>
          <div className="notepad-controls">
            <button onClick={() => setIsMinimized(true)} title="Minimize">
              <FontAwesomeIcon icon={faMinus} />
            </button>
            <SymbolButton onClick={onClose} title="Close" />
          </div>
        </div>

        <div className="floating-images-body">
          {images.length === 0 && (
            <div className="floating-images-empty">
              <FontAwesomeIcon icon={faImages} />
              <p>No images yet</p>
              <span>Add screenshots or reference photos for this session.</span>
            </div>
          )}
          <div className="floating-images-grid">
            {images.map((imageRef) => {
              const src = getImageSrc(imageRef);
              return (
                <button
                  key={imageRef.id}
                  type="button"
                  className="floating-image-thumb"
                  onClick={() => src && setViewingImageSrc(src)}
                  title={imageRef.fileName}
                >
                  {src ? <img src={src} alt={imageRef.fileName} /> : <span>Loading</span>}
                  <span className="floating-image-name">{imageRef.fileName}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="floating-image-delete"
                    onClick={(e) => handleDelete(e, imageRef)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") handleDelete(e, imageRef);
                    }}
                    title="Remove image"
                  >
                    <FontAwesomeIcon icon={faTrashAlt} />
                  </span>
                </button>
              );
            })}

            <label className="floating-image-add" title="Add images">
              <FontAwesomeIcon icon={faPlus} />
              <span>Add</span>
              <input type="file" accept="image/png, image/jpeg" multiple onChange={handleUpload} />
            </label>
          </div>
        </div>
      </div>
    </>
  );
};

export default FloatingImagesPanel;
