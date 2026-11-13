import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faChevronDown, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import useExclusiveMenu from "../../hooks/useExclusiveMenu";
import { getAnchoredMenuPlacement, getDocumentZoom } from "../../utils/anchoredMenuPosition";
import { samePointRange } from "../../utils/pointUutRange";
import {
  applyPointQualifierChoice, formatPointQualifierSelection, normalizeSelectedQualifier,
  validatePointQualifierChoice,
} from "../../utils/pointQualifierSelection";

function buildTree(choices) {
  const roots = [];
  const rangeGroups = new Set(choices.map(choice => JSON.stringify([choice.functionName, choice.rangeLabel]))).size > 1;
  for (const choice of choices) {
    const path = [...(choice.path || [])];
    if (rangeGroups) path.unshift({ id: JSON.stringify([choice.functionName, choice.rangeLabel]), label: [choice.functionName, choice.rangeLabel].filter(Boolean).join(" · ") });
    if (!path.length) path.push({ label: choice.rangeLabel || "Qualifier" });
    let siblings = roots, parentId = "";
    path.forEach((part, index) => {
      if (index === path.length - 1) {
        siblings.push({ id: `choice:${choice.key}`, parentId, label: part.label, choice, children: [] });
        return;
      }
      const id = `${parentId}/${JSON.stringify([part.id ?? part.name, part.label])}`;
      let branch = siblings.find(node => node.id === id);
      if (!branch) { branch = { id, parentId, label: part.label, children: [] }; siblings.push(branch); }
      parentId = id;
      siblings = branch.children;
    });
  }
  return roots;
}
const allBranches = nodes => nodes.flatMap(node => node.children.length ? [node.id, ...allBranches(node.children)] : []);
const visibleNodes = (nodes, expanded, depth = 1) => nodes.flatMap(node => [
  { ...node, depth }, ...(expanded.has(node.id) ? visibleNodes(node.children, expanded, depth + 1) : []),
]);
const choiceLabel = choice => (choice.path || []).map(part => part.label).join(" › ");
const pendingFields = qualifier => {
  const fields = [];
  for (let node = qualifier, depth = 0; node; node = node.qualifier, depth++) {
    if (node.value == null || String(node.value).trim() === "") fields.push({ ...node, depth });
  }
  return fields;
};
function updateQualifierValue(qualifier, depth, value) {
  return depth === 0 ? { ...qualifier, value } : { ...qualifier, qualifier: updateQualifierValue(qualifier.qualifier, depth - 1, value) };
}

/** Choose an authored UUT qualifier leaf without inventing a measurement value. */
export default function PointQualifierSelect({ choices = [], point, onChange, autoOpen = false, onClose, summary }) {
  const tree = useMemo(() => buildTree(choices), [choices]);
  const [expanded, setExpanded] = useState(() => new Set(allBranches(tree)));
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState(null);
  const [accent, setAccent] = useState("");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(null);
  const [error, setError] = useState("");
  const triggerRef = useRef(null), menuRef = useRef(null), openRef = useRef(false);
  const nodeRefs = useRef(new Map());
  const [focusedId, setFocusedId] = useState("");
  const selected = choices.find(choice => samePointRange(choice.range, point?.uutTolerance));
  const currentLabel = formatPointQualifierSelection(point?.testPointInfo?.qualifier);
  const filteredTree = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? buildTree(choices.filter(choice => [choiceLabel(choice), choice.summary, choice.functionName, choice.rangeLabel].join(" ").toLowerCase().includes(query))) : tree;
  }, [choices, search, tree]);
  const rows = visibleNodes(filteredTree, expanded);
  useLayoutEffect(() => { if (search.trim()) setExpanded(new Set(allBranches(filteredTree))); }, [search]);
  const close = (restoreFocus = false) => {
    if (!openRef.current) return;
    openRef.current = false;
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
    setOpen(false); setPending(null); setError("");
    onClose?.({ restoreFocus });
  };
  useExclusiveMenu(open, close);

  const position = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect(), zoom = getDocumentZoom();
    const viewport = window.visualViewport;
    setPlacement(getAnchoredMenuPlacement({
      anchorRect: Object.fromEntries(["left", "right", "top", "bottom"].map(key => [key, rect[key] / zoom])),
      viewportWidth: (viewport?.width || window.innerWidth) / zoom,
      viewportHeight: (viewport?.height || window.innerHeight) / zoom,
      preferredWidth: 400, preferredMaxHeight: 420, gap: 4,
    }));
    setAccent(getComputedStyle(triggerRef.current).getPropertyValue("--function-input-accent").trim());
  };
  const openMenu = () => {
    position(); setSearch(""); setPending(null); setError("");
    setExpanded(new Set(allBranches(tree)));
    setFocusedId(selected ? `choice:${selected.key}` : visibleNodes(tree, new Set(allBranches(tree)))[0]?.id || "");
    openRef.current = true; setOpen(true);
  };
  useLayoutEffect(() => { if (autoOpen) openMenu(); }, [autoOpen]); // Mount-time handoff from the point cell.
  useLayoutEffect(() => {
    if (!open) return;
    const selectedNode = nodeRefs.current.get(focusedId);
    (selectedNode || menuRef.current)?.focus({ preventScroll: true });
    selectedNode?.scrollIntoView?.({ block: "nearest" });
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return undefined;
    let frame;
    const reposition = event => {
      if (event?.type === "scroll" && menuRef.current?.contains(event.target)) return;
      cancelAnimationFrame(frame); frame = requestAnimationFrame(position);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    observer?.observe(triggerRef.current);
    const table = triggerRef.current?.closest("table");
    if (table) observer?.observe(table);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect();
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("resize", reposition);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) close(); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  useLayoutEffect(() => {
    if (pending) menuRef.current?.querySelector("input[data-qualifier-value]")?.focus();
  }, [pending?.choice.key]);

  const apply = (choice, qualifier) => {
    const result = validatePointQualifierChoice(choice, qualifier);
    if (!result.compatible) { setError(result.reason || "Enter a value within the selected qualifier range."); return; }
    onChange?.(applyPointQualifierChoice(point, choice, qualifier));
    close(true);
  };
  const choose = choice => {
    const qualifier = normalizeSelectedQualifier(choice.range.qualifier, point?.testPointInfo?.qualifier);
    const fields = pendingFields(qualifier);
    if (fields.length) { setError(""); setPending({ choice, qualifier, fields }); return; }
    apply(choice, qualifier);
  };
  const focusNode = id => { setFocusedId(id); nodeRefs.current.get(id)?.focus(); };
  const toggle = id => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const treeKey = (event, node) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const index = rows.findIndex(row => row.id === node.id);
    if (event.key === "Home") focusNode(rows[0]?.id);
    else if (event.key === "End") focusNode(rows.at(-1)?.id);
    else if (event.key === "ArrowUp" || event.key === "ArrowDown") focusNode(rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)))]?.id);
    else if (event.key === "ArrowRight" && node.children.length) {
      if (!expanded.has(node.id)) toggle(node.id); else focusNode(node.children[0].id);
    } else if (event.key === "ArrowLeft") {
      if (node.children.length && expanded.has(node.id)) toggle(node.id); else if (node.parentId) focusNode(node.parentId);
    } else if (event.key === "Enter" || event.key === " ") { if (node.choice) choose(node.choice); else toggle(node.id); }
  };
  const cancelPending = () => { const id = `choice:${pending.choice.key}`; setPending(null); setError(""); requestAnimationFrame(() => focusNode(id)); };
  return <span className="point-qualifier-select" onMouseDown={event => event.stopPropagation()}>
    <button ref={triggerRef} type="button" className="point-qualifier-trigger" aria-label="Choose measurement point qualifier" aria-haspopup="tree" aria-expanded={open}
      title={currentLabel || "Qualifier"} onClick={event => { event.stopPropagation(); if (open) close(true); else openMenu(); }}
      onKeyDown={event => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); openMenu(); }
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); }
      }}>
      {(summary || currentLabel) && <span>{summary || currentLabel}</span>}<FontAwesomeIcon icon={faChevronDown} />
    </button>
    {open && placement && createPortal(<div ref={menuRef} tabIndex={-1} className="inline-unit-menu point-qualifier-menu"
      style={{ top: placement.top, bottom: placement.bottom, left: placement.left, width: placement.width, maxHeight: placement.maxHeight,
        ...(accent ? { "--function-input-accent": accent } : {}) }}
      onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
        else if (event.key === "Tab" && !pending) { event.stopPropagation(); close(true); }
      }} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && !triggerRef.current?.contains(event.relatedTarget)) close(); }}>
      {pending ? <form className="point-qualifier-values" onSubmit={event => { event.preventDefault(); apply(pending.choice, pending.qualifier); }}
        onKeyDown={event => { if (event.key !== "Escape") event.stopPropagation(); }}>
        <p>{choiceLabel(pending.choice)}</p><small>{pending.choice.summary}</small>
        <p>Enter the measurement value within each selected range.</p>
        {pending.fields.map(field => {
          let node = pending.qualifier; for (let depth = 0; depth < field.depth; depth++) node = node.qualifier;
          const label = pending.choice.path?.[field.depth]?.name || field.name || `Qualifier ${field.depth + 1}`;
          return <label key={field.depth}>{label}<span className="point-qualifier-value-input"><input data-qualifier-value inputMode="decimal" autoComplete="off"
            aria-label={`${label} value`} value={node.value ?? ""} placeholder="Value" aria-invalid={!!error}
            onChange={event => { setError(""); setPending(previous => ({ ...previous, qualifier: updateQualifierValue(previous.qualifier, field.depth, event.target.value) })); }} />
            <span>{field.unit}</span></span><small>{[field.min, field.max].filter(value => value != null && value !== "").join(" – ")} {field.unit}</small></label>;
        })}
        {error && <p role="alert" className="point-qualifier-error">{error}</p>}
        <div className="point-qualifier-actions"><button type="button" onClick={cancelPending}>Back</button><button type="submit">Apply qualifier</button></div>
      </form> : <>
        {choices.length > 8 && <input className="inline-unit-search" type="search" aria-label="Search qualifiers" placeholder="Search qualifiers" value={search}
          onChange={event => { setSearch(event.target.value); setError(""); }}
          onKeyDown={event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); focusNode(event.key === "ArrowDown" ? rows[0]?.id : rows.at(-1)?.id); } }} />}
        <div role="tree" aria-label="Instrument qualifiers" className="point-qualifier-tree">
          {rows.map(node => <button key={node.id} ref={element => { if (element) nodeRefs.current.set(node.id, element); else nodeRefs.current.delete(node.id); }}
            type="button" role="treeitem" aria-level={node.depth} aria-expanded={node.children.length ? expanded.has(node.id) : undefined}
            aria-selected={node.choice ? node.choice === selected : undefined} tabIndex={focusedId === node.id ? 0 : -1}
            aria-label={node.choice ? [choiceLabel(node.choice), node.choice.summary, node.choice.rangeLabel].filter(Boolean).join(" · ") : node.label}
            data-choice-key={node.choice?.key} data-range-id={node.choice ? node.choice.range.rangeId ?? node.choice.range.id : undefined}
            className={`point-qualifier-item${node.choice && node.choice === selected ? " is-selected" : ""}`} style={{ "--qualifier-depth": node.depth - 1 }}
            onFocus={() => setFocusedId(node.id)} onKeyDown={event => treeKey(event, node)}
            onClick={() => { if (node.choice) choose(node.choice); else toggle(node.id); }}>
            {node.children.length ? <FontAwesomeIcon className="point-qualifier-chevron" icon={expanded.has(node.id) ? faChevronDown : faChevronRight} />
              : <span className="budget-tmde-picker-range-mark point-qualifier-range-mark" aria-hidden="true" />}
            <span className="point-qualifier-item-text"><span>{node.label}</span>{node.choice && <small>{node.choice.summary || "Specification not set"}</small>}</span>
            {node.choice && node.choice === selected && <FontAwesomeIcon icon={faCheck} className="point-qualifier-check" aria-label="Selected qualifier" />}
          </button>)}
        </div>
        {!rows.length && <p className="point-qualifier-empty">{choices.length ? "No matching qualifiers." : "No qualifier ranges match this measurement point. Check its value and unit."}</p>}
        {error && <p role="alert" className="point-qualifier-error">{error}</p>}
      </>}
    </div>, document.body)}
  </span>;
}
