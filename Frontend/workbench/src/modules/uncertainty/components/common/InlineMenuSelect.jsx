import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons";

// Compact, portaled selector used by inline instrument editors. It intentionally
// shares the UnitSelect menu classes so unit prefixes and resolution
// distributions have the same keyboard, focus, and visual behavior.
const InlineMenuSelect = ({
  value = "",
  options = [],
  onChange,
  onTab,
  ariaLabel = "Select",
  title,
  width = "72px",
  menuWidth = 220,
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const rootRef = useRef(null);
  const selectedRef = useRef(null);

  const selectedOption = options.find(
    (option) => String(option.value) === String(value),
  );
  const displayValue = selectedOption?.shortLabel || selectedOption?.label || value || "Select";

  const closeMenu = () => setIsOpen(false);
  const openMenu = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const desiredWidth = Math.max(rect.width, menuWidth);
      const estimatedHeight = Math.min(320, Math.max(48, options.length * 34 + 12));
      const roomBelow = window.innerHeight - rect.bottom - 8;
      const openAbove = roomBelow < estimatedHeight && rect.top > roomBelow;
      setMenuRect({
        top: openAbove
          ? Math.max(8, rect.top - Math.min(estimatedHeight, rect.top - 8) - 4)
          : rect.bottom + 4,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - desiredWidth - 8)),
        width: desiredWidth,
      });
    }
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (
        rootRef.current?.contains(target) ||
        target?.closest?.(".inline-unit-menu")
      ) {
        return;
      }
      closeMenu();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => selectedRef.current?.scrollIntoView({ block: "nearest" }));
  }, [isOpen, value]);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === "Tab" && !event.shiftKey && onTab) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      onTab(event);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`inline-unit-select inline-menu-select ${className}`.trim()}
      style={{ "--inline-unit-width": width }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={`inline-unit-combobox inline-menu-select-trigger${isOpen ? " is-open" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={title || selectedOption?.label || displayValue}
        onClick={(event) => {
          event.stopPropagation();
          if (isOpen) closeMenu();
          else openMenu();
        }}
        onKeyDown={handleKeyDown}
      >
        <span>{displayValue}</span>
        <FontAwesomeIcon icon={faChevronDown} size="xs" />
      </button>
      {isOpen &&
        menuRect &&
        ReactDOM.createPortal(
          <div
            className="inline-unit-menu inline-menu-select-menu"
            style={{
              top: menuRect.top,
              left: menuRect.left,
              width: menuRect.width,
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div role="listbox" aria-label={ariaLabel} className="inline-unit-options">
              {options.map((option) => {
                const isSelected = String(option.value) === String(value);
                return (
                  <button
                    key={String(option.value)}
                    ref={isSelected ? selectedRef : null}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`inline-unit-option${isSelected ? " is-selected" : ""}`}
                    onClick={() => {
                      onChange?.(option.value);
                      closeMenu();
                    }}
                  >
                    <span>{option.label}</span>
                    {(option.shortLabel || option.value !== option.label) && (
                      <small>{option.shortLabel || option.value}</small>
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default InlineMenuSelect;
