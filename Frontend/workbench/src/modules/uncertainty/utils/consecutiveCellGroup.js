// Shared by instrument custom fields and qualifiers: adjacent, non-empty
// equal values occupy one cell. Empty inputs remain independently editable.
export function consecutiveCellGroup(rows, index, valueAt) {
  const value = valueAt(index);
  const merge = value !== "" && value != null;
  if (merge && index > 0 && valueAt(index - 1) === value) return null;
  let end = index + 1;
  while (merge && end < rows.length && valueAt(end) === value) end++;
  return { value, start: index, end, rows: rows.slice(index, end) };
}
