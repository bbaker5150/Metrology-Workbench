// A native scrollbar press targets its scroll container, not an editor cell.
export function isBudgetEditorScrollTarget(target, editor) {
  const viewport = editor?.closest('.budget-section-table-wrap');
  return Boolean(viewport && (target === viewport ||
    (target?.matches?.('.dynamic-table-scroll') && viewport.contains(target))));
}

export function revealBudgetEditor(editor, viewport) {
  if (!editor?.isConnected || !viewport?.clientWidth) return;
  const bounds = viewport.getBoundingClientRect();
  const rect = editor.getBoundingClientRect();
  const scale = viewport.offsetWidth ? bounds.width / viewport.offsetWidth : 1;
  const left = bounds.left + (viewport.clientLeft + 8) * scale;
  const right = bounds.left + (viewport.clientLeft + viewport.clientWidth - 40) * scale;
  // Oversized editors keep their beginning accessible; smaller editors fit in
  // full without moving the page vertically or fighting subsequent user scrolls.
  const delta = rect.width > right - left || rect.left < left ? rect.left - left
    : rect.right > right ? rect.right - right : 0;
  if (delta) viewport.scrollLeft += delta / (scale || 1);
}
