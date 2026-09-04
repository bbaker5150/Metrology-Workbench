import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { getAnchoredMenuPlacement } from "../../utils/anchoredMenuPosition";

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
  autoOpen = false,
  showOptionMeta = true,
  onOpenChange,
  getDisplayLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const [menuAccentColor, setMenuAccentColor] = useState("");
  const rootRef = useRef(null);
  const selectedRef = useRef(null);

  const selectedOption = options.find(
    (option) => String(option.value) === String(value),
  );
  const customDisplayValue = getDisplayLabel?.(selectedOption);
  const displayValue =
    customDisplayValue ||
    selectedOption?.shortLabel ||
    selectedOption?.label ||
    value ||
    "Select";

  const closeMenu = () => {
    setIsOpen(false);
    onOpenChange?.(false);
  };
  const openMenu = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    const accentColor = rootRef.current
      ? window
          .getComputedStyle(rootRef.current)
          .getPropertyValue("--function-input-accent")
          .trim()
      : "";
    setMenuAccentColor(accentColor);
    if (rect) {
      const visualViewport = window.visualViewport;
      setMenuRect(getAnchoredMenuPlacement({
        anchorRect: rect,
        viewportWidth: visualViewport?.width || window.innerWidth,
        viewportHeight: visualViewport?.height || window.innerHeight,
        preferredWidth: Math.max(rect.width, menuWidth),
        preferredMaxHeight: Math.min(320, Math.max(48, options.length * 34 + 12)),
        gap: 4,
      }));
    }
    setIsOpen(true);
    onOpenChange?.(true);
  };

  useEffect(() => {
    if (!autoOpen) return undefined;
    const frame = requestAnimationFrame(openMenu);
    return () => cancelAnimationFrame(frame);
    // Mount-time handoff from a parent read view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

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
    requestAnimationFrame(() => {
      if (typeof selectedRef.current?.scrollIntoView === "function") {
        selectedRef.current.scrollIntoView({ block: "nearest" });
      }
    });
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
              bottom: menuRect.bottom,
              left: menuRect.left,
              width: menuRect.width,
              maxHeight: menuRect.maxHeight,
              ...(menuAccentColor
                ? { "--function-input-accent": menuAccentColor }
                : {}),
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              role="listbox"
              aria-label={ariaLabel}
              className="inline-unit-options"
              style={{ maxHeight: Math.max(1, menuRect.maxHeight - 12) }}
            >
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
                    {showOptionMeta &&
                      (option.shortLabel || option.value !== option.label) && (
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
