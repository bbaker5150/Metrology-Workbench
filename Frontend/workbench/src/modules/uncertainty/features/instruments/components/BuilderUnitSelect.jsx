import useExclusiveMenu from "../../../hooks/useExclusiveMenu";
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { getUnitDisplayLabel, unitSystem } from "../../../utils/uncertaintyMath";
import { SI_PREFIX_OPTIONS, prefixedUnitKey } from "../../../utils/siPrefixes";
import InlineMenuSelect from "../../../components/common/InlineMenuSelect";
import { getAnchoredMenuPlacement } from "../../../utils/anchoredMenuPosition";
import {
  flattenUnitGroups,
  rankUnitOptions,
} from "../../../utils/unitSearch";

/**
 * Compact, searchable unit picker shared by the universal builder's function
 * and Type B editors. The menu is portaled so it can never be clipped by a
 * builder card or table, while the trigger stays at the same fixed width as
 * the inline unit controls.
 */
const BuilderUnitSelect = ({
  value = "",
  onChange,
  options = [],
  ariaLabel = "Unit",
  width = "72px",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuRect, setMenuRect] = useState(null);
  const [activeValue, setActiveValue] = useState(value || "");
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const selectedRef = useRef(null);
  const activeRef = useRef(null);
  const baseOptions = useMemo(() => {
    const seen = new Set();
    return [{value: "", label: "Unitless"}, ...flattenUnitGroups(options)].flatMap(option => {
      const base = unitSystem.units[option.value]?.prefixBase || option.value;
      if (seen.has(base)) return [];
      seen.add(base);
      return [{ ...option, value: base, label: base ? getUnitDisplayLabel(base) : "Unitless" }];
    });
  }, [options]);
  const flatOptions = baseOptions;
  const model = unitSystem.units[value];
  const baseValue = model?.prefixBase || value;
  const prefix = model?.prefixKey || "";
  const selectedOption =
    flatOptions.find((option) => option.value === baseValue) ||
    (value ? { value, label: getUnitDisplayLabel(value) || value } : null);
  // One ranked list rather than a stack of function groups: a search puts the
  // units that answer it at the top, and each row names its own function.
  const visibleOptions = useMemo(
    () => rankUnitOptions(baseOptions, query),
    [baseOptions, query],
  );

  const closeMenu = () => setIsOpen(false);
  useExclusiveMenu(isOpen, closeMenu);
  const openMenu = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const visualViewport = window.visualViewport;
      setMenuRect(getAnchoredMenuPlacement({
        anchorRect: rect,
        viewportWidth: visualViewport?.width || window.innerWidth,
        viewportHeight: visualViewport?.height || window.innerHeight,
        preferredWidth: Math.max(rect.width, 240),
        preferredMaxHeight: 320,
        gap: 4,
      }));
    }
    setQuery("");
    setActiveValue(baseValue || flatOptions[0]?.value || "");
    setIsOpen(true);
  };

  const chooseUnit = (option) => {
    onChange(option?.value || "");
    closeMenu();
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
    if (
      visibleOptions.length > 0 &&
      !visibleOptions.some((option) => option.value === activeValue)
    ) {
      setActiveValue(visibleOptions[0].value);
    }
  }, [activeValue, isOpen, visibleOptions]);

  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      const scrollTarget = activeRef.current || selectedRef.current;
      if (typeof scrollTarget?.scrollIntoView === "function") {
        scrollTarget.scrollIntoView({ block: "nearest" });
      }
    });
  }, [activeValue, isOpen, query]);

  return (
    <div
      ref={rootRef}
      className={`inline-unit-select builder-unit-select${model ? " inline-unit-split-select" : ""}`}
      onMouseDown={(event) => event.stopPropagation()}
      aria-label={ariaLabel}
      style={{ "--inline-unit-width": width }}
    >
      <button
        type="button"
        className={`inline-unit-combobox inline-unit-base-button${
          isOpen ? " is-open" : ""
        }`}
        aria-label={`${ariaLabel} base unit`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={selectedOption?.label || value || "Unit"}
        onClick={(event) => {
          event.stopPropagation();
          if (isOpen) closeMenu();
          else openMenu();
        }}
      >
        <span>{selectedOption?.label || value || "Unit"}</span>
        <FontAwesomeIcon icon={faChevronDown} size="xs" />
      </button>
      {model && <InlineMenuSelect ariaLabel={`${ariaLabel} prefix`} value={prefix}
        width="58px" prefixTable options={SI_PREFIX_OPTIONS.map(item => ({ value: item.key, label: item.label, shortLabel: item.shortLabel }))}
        onChange={nextPrefix => {
          const key = prefixedUnitKey(baseValue, nextPrefix);
          onChange(unitSystem.units[key]?.prefixBase === baseValue ? key : `${nextPrefix}(${baseValue})`);
        }} />}
      {isOpen &&
        menuRect &&
        ReactDOM.createPortal(
          <div
            className="inline-unit-menu"
            style={{
              top: menuRect.top,
              bottom: menuRect.bottom,
              left: menuRect.left,
              width: menuRect.width,
              maxHeight: menuRect.maxHeight,
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <input
              ref={searchRef}
              className="inline-unit-search"
              value={query}
              placeholder="Search units..."
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  closeMenu();
                  return;
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (visibleOptions.length === 0) return;
                  const currentIndex = Math.max(
                    0,
                    visibleOptions.findIndex(
                      (option) => option.value === activeValue,
                    ),
                  );
                  const offset = event.key === "ArrowDown" ? 1 : -1;
                  const nextIndex =
                    (currentIndex + offset + visibleOptions.length) %
                    visibleOptions.length;
                  setActiveValue(visibleOptions[nextIndex].value);
                  return;
                }
                if (event.key === "Enter") {
                  const activeOption =
                    visibleOptions.find(
                      (option) => option.value === activeValue,
                    ) || visibleOptions[0];
                  if (activeOption) chooseUnit(activeOption);
                }
              }}
            />
            <div
              className="inline-unit-options"
              role="listbox"
              aria-label={ariaLabel}
              style={{ maxHeight: Math.max(1, menuRect.maxHeight - 50) }}
            >
              {visibleOptions.length === 0 ? (
                <div className="inline-unit-empty">No matching units</div>
              ) : (
                visibleOptions.map((option) => {
                  const isSelected = option.value === baseValue;
                  const isActive = option.value === activeValue;
                  return (
                    <button
                      key={option.value}
                      ref={
                        isActive ? activeRef : isSelected ? selectedRef : null
                      }
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`inline-unit-option${
                        isSelected ? " is-selected" : ""
                      }${isActive ? " is-active" : ""}`}
                      onMouseEnter={() => setActiveValue(option.value)}
                      onClick={() => chooseUnit(option)}
                    >
                      <span>{option.label}</span>
                      {/* The unit key used to sit here, which just repeated the
                          label. Its function is the useful thing to know. */}
                      <small>{option.functionName}</small>
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default BuilderUnitSelect;
