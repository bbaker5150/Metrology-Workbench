// Fill spare panel space with one trailing column, never by scaling its peers.
// This is a live layout adjustment; saved widths remain the user's minimums.
export function fillTrailingColumn(widths, minimum, index = widths.length - 1) {
  const result = [...widths];
  if (index >= 0 && index < result.length) {
    result[index] += Math.max(0, minimum - result.reduce((sum, width) => sum + width, 0));
  }
  return result;
}

// A drag starts at the visible border, but only the target width is saved.
// Do not bake automatic fill or another column's expanded editor into storage.
export function resizeTableColumn(saved, rendered, key, delta, minimum) {
  return { ...(saved || rendered), [key]: Math.max(minimum, rendered[key] + delta) };
}
