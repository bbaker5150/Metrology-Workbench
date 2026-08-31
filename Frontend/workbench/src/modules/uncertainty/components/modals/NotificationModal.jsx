import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { useFloatingWindow } from "../../hooks/useFloatingWindow";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { 
  faInfoCircle, 
  faExclamationTriangle, 
  faCheck, 
  faTimes
} from "@fortawesome/free-solid-svg-icons";

const NotificationModal = ({ 
  isOpen, 
  onClose, 
  title = "Notification", 
  message, 
  onConfirm,
  confirmText = "OK",
  isIconConfirm = false,
  secondaryText,
  onSecondary,
  secondaryIsPrimary = false,
  inputLabel,
  inputPlaceholder = "",
  initialInputValue = "",
  validateInput,
}) => {
  const [inputValue, setInputValue] = useState(initialInputValue);
  const [inputError, setInputError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setInputValue(initialInputValue);
    setInputError("");
  }, [isOpen, initialInputValue, title]);

  const windowWidth = Math.min(420, window.innerWidth - 32);
  const safeInitialPosition = {
    x: Math.max(16, (window.innerWidth - windowWidth) / 2),
    y: Math.max(88, Math.min(window.innerHeight / 3, window.innerHeight - 280)),
  };

  const { position, handleMouseDown } = useFloatingWindow({
    isOpen,
    defaultWidth: windowWidth,
    defaultHeight: "auto",
    initialPosition: safeInitialPosition,
  });

  const handleConfirm = () => {
    if (inputLabel) {
      const error = validateInput?.(inputValue) || "";
      setInputError(error);
      if (error) return;
    }
    onConfirm?.(inputLabel ? inputValue.trim() : undefined);
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleDialogKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (onConfirm) handleConfirm();
        else onClose?.();
      }
    };
    window.addEventListener("keydown", handleDialogKey);
    return () => window.removeEventListener("keydown", handleDialogKey);
  });

  if (!isOpen) return null;

  // Determine Icon & Color based on Title keywords
  let icon = faInfoCircle;
  let tone = "info";
  
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes("delete") || lowerTitle.includes("warning") || lowerTitle.includes("error")) {
    icon = faExclamationTriangle;
    tone = "danger";
  } else if (lowerTitle.includes("success") || lowerTitle.includes("saved")) {
    icon = faCheck;
    tone = "success";
  }

  return ReactDOM.createPortal(
    <div
      className={`notification-window floating-window-content notification-window--${tone}`}
      style={{
        position: "fixed",
        top: position.y,
        left: position.x,
        zIndex: 3001,
      }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="notification-modal-title"
    >
      <div
        className="window-header"
        onMouseDown={handleMouseDown}
      >
        <div className="notification-window-heading">
          <span className="notification-window-icon">
            <FontAwesomeIcon icon={icon} />
          </span>
          <div>
            <span className="notification-window-eyebrow">
              {tone === "danger" ? "Confirmation required" : "Notification"}
            </span>
            <h3 id="notification-modal-title">{title}</h3>
          </div>
        </div>
        <button
          onClick={onClose}
          className="modal-close-button"
          title="Close"
          aria-label="Close"
        >
          <FontAwesomeIcon icon={faTimes} />
        </button>
      </div>

      <div className="window-body">
        <p>{message}</p>

        {inputLabel && (
          <label className="notification-window-field">
            <span>{inputLabel}</span>
            <input
              autoFocus
              type="text"
              value={inputValue}
              placeholder={inputPlaceholder}
              onChange={(event) => {
                setInputValue(event.target.value);
                if (inputError) setInputError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  handleConfirm();
                }
              }}
              aria-invalid={Boolean(inputError)}
            />
            {inputError && (
              <span className="notification-window-field-error">
                {inputError}
              </span>
            )}
          </label>
        )}

        <div className="notification-window-actions">
          {onConfirm && (
            <button
              className={`notification-window-confirm notification-window-confirm--${tone}`}
              onClick={handleConfirm}
            >
              {confirmText}
              {isIconConfirm && <FontAwesomeIcon icon={faCheck} />}
            </button>
          )}

          {onSecondary && (
            <button
              className={`notification-window-confirm${
                secondaryIsPrimary ? "" : " notification-window-confirm--secondary"
              }`}
              onClick={() => onSecondary?.()}
            >
              {secondaryText || "Apply to Session"}
            </button>
          )}

          {!onConfirm && (
            <button className="notification-window-confirm" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default NotificationModal;
