const NUMERIC_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

// Bounds are already serialized as strings. Retain the author's decimal or
// exponent spelling instead of inferring a display mode from its magnitude.
export const floorMagnitudeText = value => {
  if (value == null || value === "") return "";
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) return "";
  if (typeof value === "string" && NUMERIC_TEXT.test(value.trim())) {
    return value.trim().replace(/^[+-]/, "");
  }
  const text = String(Math.abs(parsed));
  if (!/[eE]/.test(text)) return text;
  const [coefficient, exponent] = text.split(/[eE]/);
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = whole + fraction;
  const decimal = whole.length + Number(exponent);
  if (decimal <= 0) return `0.${"0".repeat(-decimal)}${digits}`;
  if (decimal >= digits.length) return digits + "0".repeat(decimal - digits.length);
  return `${digits.slice(0, decimal)}.${digits.slice(decimal)}`;
};

export const floorBoundText = (value, negative = false) => {
  const magnitude = floorMagnitudeText(value);
  return negative && magnitude !== "" && Number(magnitude) !== 0 ? `-${magnitude}` : magnitude;
};

export const floorBoundsAreSymmetric = (high, low) =>
  Math.abs(high + low) <= Number.EPSILON * Math.max(Math.abs(high), Math.abs(low)) * 4;
