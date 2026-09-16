// Fill spare panel space with one trailing column, never by scaling its peers.
// This is a live layout adjustment; saved widths remain the user's minimums.
export function fillTrailingColumn(widths, minimum, index = widths.length - 1) {
  const result = [...widths];
  if (index >= 0 && index < result.length) {
    result[index] += Math.max(0, minimum - result.reduce((sum, width) => sum + width, 0));
  }
  return result;
}
