// Table editors fill their cells, so the assigned width is not a content minimum.
// Share the same intrinsic measurement between instrument and budget tables.
export function measureDynamicTableEditorWidth(editor) {
  const lookup = editor.querySelector('.dynamic-lookup-table');
  if (!lookup) return null;
  // The nested lookup is intrinsically sized. Its headings, expanded unit
  // pickers, signs and inputs all contribute their actual rendered widths.
  const scroll = lookup.closest('.dynamic-table-scroll');
  const gutter = scroll && parseFloat(getComputedStyle(scroll).paddingLeft);
  let width = lookup.offsetWidth + (gutter || 0);
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
