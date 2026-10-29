// Table editors fill their cells, so the assigned width is not a content minimum.
// Share the same intrinsic measurement between instrument and budget tables.
export function measureDynamicTableEditorWidth(editor) {
  const lookup = editor.querySelector('.dynamic-lookup-table');
  if (!lookup) return null;
  // A full-width editor follows its assigned cell. Measuring that width
  // and adding cell padding would grow the column on every observer pass.
  // Resolve its authored content requirement outside the observed table.
  const lookupStyle = getComputedStyle(lookup);
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
  probe.style.font = lookupStyle.font;
  probe.style.setProperty('--dynamic-data-width', lookupStyle.getPropertyValue('--dynamic-data-width'));
  probe.style.setProperty('--dynamic-table-width', lookupStyle.getPropertyValue('--dynamic-table-width'));
  probe.style.width = 'calc(var(--dynamic-table-width) + 48px)';
  document.body.appendChild(probe);
  let width = probe.offsetWidth;
  probe.remove();
  // Header controls grow when either unit summary opens. Measure their
  // intrinsic inline content, not the assigned table/column width.
  const headings = [...lookup.querySelectorAll('.dynamic-column-heading')];
  const headingWidth = Math.max(0, ...headings.map(heading => {
    const cellStyle = getComputedStyle(heading.closest('th'));
    return Math.max(heading.scrollWidth, heading.offsetWidth)
      + (parseFloat(cellStyle.paddingLeft) || 0) + (parseFloat(cellStyle.paddingRight) || 0) + 2;
  }));
  width = Math.max(width, headingWidth * headings.length + 96);
  const toolbar = editor.querySelector('.instrument-tolerance-toolbar');
  if (toolbar) {
    const toolbarStyle = getComputedStyle(toolbar);
    const children = [...toolbar.children].filter(node => node.getClientRects().length);
    const toolbarWidth = children.reduce((sum, node) => sum + Math.max(node.scrollWidth, node.offsetWidth), 0)
      + Math.max(0, children.length - 1) * (parseFloat(toolbarStyle.columnGap) || 0)
      + (parseFloat(toolbarStyle.paddingLeft) || 0) + (parseFloat(toolbarStyle.paddingRight) || 0);
    width = Math.max(width, toolbarWidth);
  }
  const editorStyle = getComputedStyle(editor);
  width += (parseFloat(editorStyle.paddingLeft) || 0) + (parseFloat(editorStyle.paddingRight) || 0);
  return Math.ceil(width);
}
