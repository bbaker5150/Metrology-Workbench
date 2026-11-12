import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDownAZ, faArrowUpAZ, faChevronDown, faChevronRight, faFilter } from "@fortawesome/free-solid-svg-icons";
import SymbolButton from "../../../components/common/SymbolButton";
import useExclusiveMenu from "../../../hooks/useExclusiveMenu";
import { getAnchoredMenuPlacement } from "../../../utils/anchoredMenuPosition";

const descriptionFields = [
  { key: "manufacturer", label: "Manufacturer" },
  { key: "model", label: "Model" },
  { key: "name", label: "Name" },
  { key: "tag", label: "Tag" },
];
const statuses = [
  { value: "local", label: "Local" },
  { value: "pending", label: "Awaiting validation" },
  { value: "shared", label: "Shared" },
];
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const valueKey = value => String(value ?? "").trim().toLocaleLowerCase();

export function libraryColumnValue(instrument, field) {
  if (field === "status") return ["shared", "validated"].includes(instrument.scope) ? "shared" : instrument.scope || "local";
  if (field === "name") return String(instrument.description || instrument.name || "").trim();
  if (field === "tag") return String(instrument.nickname || instrument.tag || "").trim();
  return String(instrument[field] ?? "").trim();
}

export const matchesLibraryFilters = (instrument, filters) => Object.entries(filters).every(([field, selected]) =>
  selected.includes(valueKey(libraryColumnValue(instrument, field))));

export function compareLibraryRows(a, b, sort) {
  const first = libraryColumnValue(a, sort.field);
  const second = libraryColumnValue(b, sort.field);
  const order = sort.field === "status"
    ? ["session", "local", "pending", "shared"].indexOf(first) - ["session", "local", "pending", "shared"].indexOf(second)
    : collator.compare(first, second);
  return sort.direction === "desc" ? -order : order;
}

function FilterValues({ field, instruments, filters, onChange, sort, onSort }) {
  const [query, setQuery] = useState("");
  const selectAll = useRef(null);
  const distinct = new Map();
  for (const instrument of instruments) {
    const label = libraryColumnValue(instrument, field.key);
    const value = valueKey(label);
    const existing = distinct.get(value);
    distinct.set(value, { value, label: existing?.label || label || "(Not set)", count: (existing?.count || 0) + 1 });
  }
  const values = field.key === "status"
    ? [...statuses, ...(distinct.has("session") ? [{ value: "session", label: "Session only" }] : [])].map(value => ({ ...value, count: distinct.get(value.value)?.count || 0 }))
    : [...distinct.values()].sort((a, b) => collator.compare(a.label, b.label));
  const visible = values.filter(value => !query || value.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = filters[field.key] ?? values.map(value => value.value);
  const checked = visible.length > 0 && visible.every(value => selected.includes(value.value));
  useLayoutEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = !checked && visible.some(value => selected.includes(value.value));
  }, [checked, selected, visible]);
  const change = next => onChange(field.key, values.every(value => next.includes(value.value)) ? null : next);
  const toggleAll = () => {
    const visibleKeys = new Set(visible.map(value => value.value));
    change(checked ? selected.filter(value => !visibleKeys.has(value)) : [...new Set([...selected, ...visibleKeys])]);
  };
  return <div className="instrument-library-filter-values">
    <div className="instrument-library-filter-sort" role="group" aria-label={`Sort ${field.label}`}>
      {["asc", "desc"].map(direction => <button key={direction} type="button"
        aria-label={`Sort ${field.label} ${direction === "asc" ? "ascending" : "descending"}`}
        aria-pressed={sort.field === field.key && sort.direction === direction}
        onClick={() => onSort({ field: field.key, direction })}>
        <FontAwesomeIcon icon={direction === "asc" ? faArrowDownAZ : faArrowUpAZ} />
        <span>{direction === "asc" ? "Ascending" : "Descending"}</span>
      </button>)}
    </div>
    {field.key !== "status" && <input className="instrument-library-filter-search" type="search"
      aria-label={`Search ${field.label} values`} placeholder={`Search ${field.label.toLowerCase()}`} value={query} onChange={event => setQuery(event.target.value)} />}
    <label className="instrument-library-filter-value instrument-library-filter-select-all">
      <input ref={selectAll} type="checkbox" aria-label={`Select all ${field.label} values`} checked={checked} disabled={!visible.length} onChange={toggleAll} />
      <span>{query ? "Select search results" : "Select all"}</span>
    </label>
    <div className="instrument-library-filter-options" role="group" aria-label={`${field.label} values`}>
      {visible.map(value => <label className="instrument-library-filter-value" key={value.value}>
        <input type="checkbox" aria-label={value.label} checked={selected.includes(value.value)}
          onChange={() => change(selected.includes(value.value) ? selected.filter(key => key !== value.value) : [...selected, value.value])} />
        <span>{value.label}</span><span className="instrument-library-filter-count" aria-hidden="true">{value.count}</span>
      </label>)}
      {!visible.length && <p className="instrument-library-filter-empty">No matching values.</p>}
    </div>
  </div>;
}

export default function InstrumentLibraryColumnFilter({ columnKey, label, instruments, filters, onFiltersChange, sort, onSort }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState("manufacturer");
  const [placement, setPlacement] = useState(null);
  const trigger = useRef(null);
  const menu = useRef(null);
  const fields = columnKey === "sync" ? [{ key: "status", label: "Status" }] : descriptionFields;
  const filtered = fields.some(field => filters[field.key] !== undefined);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useExclusiveMenu(open, () => setOpen(false));
  useLayoutEffect(() => {
    if (!open) return;
    setPlacement(getAnchoredMenuPlacement({ anchorRect: trigger.current?.getBoundingClientRect(),
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, preferredWidth: 292, preferredMaxHeight: 460, gap: 4 }));
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !placement) return;
    (menu.current?.querySelector('input[type="search"]') || menu.current?.querySelector('.instrument-library-filter-sort button'))?.focus();
  }, [open, placement]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = event => {
      if (!trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    const keyDown = event => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation(); close();
    };
    const closeOnScroll = event => { if (!menu.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("resize", closeOnScroll);
    document.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("resize", closeOnScroll);
      document.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);
  const changeFilter = (key, values) => onFiltersChange(previous => {
    const next = { ...previous };
    if (values == null) delete next[key]; else next[key] = values;
    return next;
  });
  const clear = () => onFiltersChange(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !fields.some(field => field.key === key))));
  return <span className="instrument-library-column-heading">
    <span>{label}</span>
    <button ref={trigger} type="button" className={`instrument-library-filter-trigger${filtered ? " is-filtered" : ""}`}
      aria-label={`Filter and sort ${label}`} aria-haspopup="dialog" aria-expanded={open}
      title={filtered ? `${label} filter active` : `Filter and sort ${label}`} onPointerDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); setOpen(true); } }}
      onClick={event => { event.stopPropagation(); setOpen(value => !value); }}>
      <FontAwesomeIcon icon={filtered ? faFilter : faChevronDown} />
    </button>
    {open && placement && ReactDOM.createPortal(<div ref={menu} role="dialog" aria-label={`${label} filter and sort`}
      onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
      className="instrument-library-filter-menu" style={{ left: placement.left, top: placement.top, bottom: placement.bottom, width: placement.width, maxHeight: placement.maxHeight }}>
      <div className="instrument-library-filter-title"><strong>{label}</strong><SymbolButton aria-label={`Close ${label} filter`} onClick={close} /></div>
      <div className="instrument-library-filter-sections">
        {fields.map(field => <section key={field.key}>
          {columnKey !== "sync" && <button type="button" className="instrument-library-filter-section" aria-expanded={section === field.key}
            onClick={() => setSection(value => value === field.key ? null : field.key)}>
            <FontAwesomeIcon icon={section === field.key ? faChevronDown : faChevronRight} /><span>{field.label}</span>
            {filters[field.key] !== undefined && <FontAwesomeIcon className="instrument-library-filter-active" icon={faFilter} />}
          </button>}
          {(columnKey === "sync" || section === field.key) && <FilterValues key={field.key} field={field} instruments={instruments}
            filters={filters} onChange={changeFilter} sort={sort} onSort={onSort} />}
        </section>)}
      </div>
      <div className="instrument-library-filter-footer"><button type="button" disabled={!filtered} onClick={clear}>Clear filter</button><button type="button" onClick={close}>Done</button></div>
    </div>, document.body)}
  </span>;
}
