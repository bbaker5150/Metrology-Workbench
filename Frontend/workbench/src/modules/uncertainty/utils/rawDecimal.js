// Expand the numeric representation without rounding or locale formatting.
// String arithmetic preserves all available digits, including very small
// uncertainty terms for which Number.toFixed would silently display zero.
export function rawDecimal(value) {
  return String(value ?? "").replace(/([+-]?)(\d+(?:\.\d*)?|\.\d+)[eE]([+-]?\d+)/g, (token, sign, significand, exponent) => {
    const exp = Number(exponent);
    if (Math.abs(exp) > 400) return token;
    const [whole, fraction = ""] = significand.split(".");
    const digits = whole + fraction;
    const position = whole.length + exp;
    return sign + (position <= 0 ? `0.${"0".repeat(-position)}${digits}` : position >= digits.length ? digits + "0".repeat(position - digits.length) : `${digits.slice(0, position)}.${digits.slice(position)}`);
  });
}

// Covers auxiliary tables as well as the main grids. Explicit raw-value titles
// take precedence; rendered notation is a fallback for legacy cells. No React
// state or layout mutation is involved in a hover.
export function exposeDecimalOnHover(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest("table, .point-grid-item")) return;
  const cell = target.closest("[title], td, .point-grid-item > span");
  if (!cell) return;
  const source = cell.getAttribute("title") || cell.textContent || "";
  if (/\d[eE][+-]?\d/.test(source)) cell.setAttribute("title", rawDecimal(source));
  else if (/\d[eE][+-]?\d/.test(cell.textContent || "")) {
    const expanded = rawDecimal(cell.textContent.trim());
    if (!source.includes(expanded)) cell.setAttribute("title", `${source}\n${expanded}`);
  }
}
