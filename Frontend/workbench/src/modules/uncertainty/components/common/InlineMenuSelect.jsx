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
  menuTitle,
  prefixTable = false,
  headerAction,
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
  const menuRef = useRef(null);

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
  const positionMenu = () => {
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
      setMenuRect(
        getAnchoredMenuPlacement({
          anchorRect: rect,
          viewportWidth: visualViewport?.width || window.innerWidth,
          viewportHeight: visualViewport?.height || window.innerHeight,
          preferredWidth: Math.max(rect.width, menuWidth),
          preferredMaxHeight: Math.min(
            prefixTable ? 360 : 320,
            Math.max(48, options.length * 34 + 12 + (menuTitle || prefixTable ? 38 : 0)),
          ),
          gap: 4,
        }),
      );
    }
  };
  const openMenu = () => {
    positionMenu();
    setIsOpen(true);
    onOpenChange?.(true);
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    // Opening this selector may collapse another column and change the
    // trigger's position. Keep the portal anchored after that reflow too.
    let frame;
    const reposition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(positionMenu);
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(reposition);
    if (rootRef.current) observer?.observe(rootRef.current);
    const table = rootRef.current?.closest("table");
    if (table) observer?.observe(table);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    reposition();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
    // Geometry does not depend on the selected value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, menuWidth, options.length]);

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
    const frame = requestAnimationFrame(() => {
      const menu = menuRef.current;
      const list = menu?.querySelector('[role="listbox"]');
      const selected = selectedRef.current || list?.querySelector('[role="option"]');
      selected?.focus({ preventScroll: true });
      const target = prefixTable ? menu?.querySelector('.is-base-unit') : selected;
      if (list && target) {
        const row = target.getBoundingClientRect(), bounds = list.getBoundingClientRect();
        list.scrollTop += row.top - bounds.top - (list.clientHeight - row.height) / 2;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  const handleKeyDown = (event) => {
    if (!isOpen && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); openMenu(); return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      rootRef.current?.querySelector("button")?.focus({ preventScroll: true });
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
            ref={menuRef}
            className={`inline-unit-menu inline-menu-select-menu${prefixTable ? " unit-prefix-menu" : ""}`}
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
            onKeyDown={(event) => {
              handleKeyDown(event);
              if (event.key === "Enter" && event.target.getAttribute("role") === "option") { event.preventDefault(); event.target.click(); return; }
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                return;
              event.preventDefault();
              const items = [
                ...event.currentTarget.querySelectorAll('[role="option"]'),
              ];
              const current = items.indexOf(document.activeElement);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (current +
                        (event.key === "ArrowUp" ? -1 : 1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            }}
          >
            {prefixTable && <div className="unit-prefix-heading"><span>Prefix</span><span>Symbol</span><span>Multiplier</span></div>}
            {menuTitle && (
              <div className="instrument-menu-heading">
                <span>{menuTitle}</span>
                {headerAction && <button type="button" className="instrument-menu-header-action" title={headerAction.label} aria-label={headerAction.label} onClick={() => { headerAction.onClick(); closeMenu(); }}>{headerAction.icon}</button>}
              </div>
            )}
            <div
              role="listbox"
              aria-label={ariaLabel}
              className="inline-unit-options"
              style={{
                maxHeight: Math.max(
                  1,
                  menuRect.maxHeight - 12 - (menuTitle || prefixTable ? 38 : 0),
                ),
              }}
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
                    className={`inline-unit-option${isSelected ? " is-selected" : ""}${prefixTable && option.value === "" ? " is-base-unit" : ""}`}
                    onClick={() => {
                      onChange?.(option.value);
                      closeMenu();
                    }}
                  >
                    <span>{option.label}</span>
                    {prefixTable && <><span>{option.value === "" ? "—" : option.shortLabel}</span><span>10<sup>{option.power}</sup></span></>}
                    {!prefixTable && showOptionMeta &&
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
