// A drag starts at the visible border, but only the target width is saved.
// Do not bake another column's temporarily expanded editor into storage.
export function resizeTableColumn(saved, rendered, key, delta, minimum) {
  return { ...(saved || rendered), [key]: Math.max(minimum, rendered[key] + delta) };
}
