// Measure a hidden, unconstrained copy so fitting a column includes flex badges,
// merged cells and open editors without disturbing the visible table geometry.
export function measureTableColumnWidths(table, dataKey) {
  if (!table?.offsetWidth) return {};
  const clone = table.cloneNode(true);
  clone.inert = true;
  clone.setAttribute('aria-hidden', 'true');
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  clone.querySelectorAll('colgroup').forEach(node => node.remove());
  for (const [key, value] of Object.entries({ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', left: '0', top: '0', width: 'max-content', minWidth: '0', maxWidth: 'none', tableLayout: 'auto' })) clone.style[key] = value;
  clone.style.setProperty('width', 'max-content', 'important');
  clone.style.setProperty('--instrument-live-table-width', 'max-content');
  clone.style.setProperty('--budget-table-min-width', '0px');
  clone.querySelectorAll('th, td, .inline-desc-combined, .uut-description-content, .instrument-resizable-header-content, .budget-resizable-header-content').forEach(node => {
    node.style.setProperty('white-space', 'nowrap', 'important');
    node.style.setProperty('max-width', 'none', 'important');
    node.style.setProperty('width', 'max-content', 'important');
    node.style.setProperty('overflow', 'visible', 'important');
  });
  table.parentElement.append(clone);
  try {
    const scale = clone.getBoundingClientRect().width / clone.offsetWidth || 1;
    return Object.fromEntries([...clone.tHead.rows[0].cells].map(cell => [cell.dataset[dataKey], Math.ceil(cell.getBoundingClientRect().width / scale) + 2]));
  } finally { clone.remove(); }
}
