// Table editors fill their cells, so the assigned width is not a content minimum.
// Share the same intrinsic measurement between instrument and budget tables.
export function measureDynamicTableEditorWidth(editor) {
  const lookup = editor.querySelector('.dynamic-lookup-table');
  if (!lookup) return null;
  // The nested lookup is intrinsically sized. Its headings, expanded unit
  // pickers, signs and inputs all contribute their actual rendered widths.
  const horizontalInsets = node => {
    const style = getComputedStyle(node);
    return ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
      .reduce((sum, name) => sum + (parseFloat(style[name]) || 0), 0);
  };
  // Include every wrapper between the intrinsic grid and the outer editor.
  // In particular, the dynamic editor has its own padding in addition to the
  // scroll area's balancing gutter; omitting it clips the right-hand actions.
  const enclosingInsets = node => {
    let total = 0;
    for (let parent = node.parentElement; parent && editor.contains(parent); parent = parent.parentElement) {
      total += horizontalInsets(parent);
      if (parent === editor) break;
    }
    return total;
  };
  let width = lookup.offsetWidth + enclosingInsets(lookup);
  const toolbar = editor.querySelector('.instrument-tolerance-toolbar');
  if (toolbar) {
    const toolbarStyle = getComputedStyle(toolbar);
    const children = [...toolbar.children].filter(node => node.getClientRects().length);
    const toolbarWidth = children.reduce((sum, node) => sum + Math.max(node.scrollWidth, node.offsetWidth), 0)
      + Math.max(0, children.length - 1) * (parseFloat(toolbarStyle.columnGap) || 0)
      + horizontalInsets(toolbar) + enclosingInsets(toolbar);
    width = Math.max(width, toolbarWidth);
  }
  return Math.ceil(width);
}
