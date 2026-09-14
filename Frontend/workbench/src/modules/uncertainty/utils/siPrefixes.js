// Prefix multipliers apply to the complete selected unit. Parentheses keep
// scaled compound units distinct from powers, e.g. m(m²) is not mm².
export const SI_PREFIX_OPTIONS = [
  ["Y", "Yotta", 24], ["Z", "Zetta", 21], ["E", "Exa", 18],
  ["P", "Peta", 15], ["T", "Tera", 12], ["G", "Giga", 9],
  ["M", "Mega", 6], ["k", "Kilo", 3], ["h", "Hecto", 2],
  ["da", "Deca", 1], ["", "Base", 0], ["d", "Deci", -1],
  ["c", "Centi", -2], ["m", "Milli", -3], ["u", "Micro", -6],
  ["n", "Nano", -9], ["p", "Pico", -12], ["f", "Femto", -15],
  ["a", "Atto", -18], ["z", "Zepto", -21], ["y", "Yocto", -24],
].map(([key, label, power]) => ({ key, label, power, shortLabel: key === "u" ? "µ" : key || "Base" }));

export const prefixedUnitKey = (base, prefix = "") => !prefix ? base
  : /[^a-zA-Z]/.test(base) ? `${prefix}(${base})` : `${prefix}${base}`;

export function registerUnitPrefixes(units) {
  const original = Object.entries(units);
  const family = new Map();
  for (const [unit, definition] of original) {
    const match = SI_PREFIX_OPTIONS.find(prefix => prefix.key && unit.startsWith(prefix.key)
      && units[unit.slice(prefix.key.length)]?.quantity === definition.quantity
      && Math.abs(definition.to_si / units[unit.slice(prefix.key.length)].to_si / 10 ** prefix.power - 1) < 1e-10);
    family.set(unit, match ? { base: unit.slice(match.key.length), prefix: match.key } : { base: unit, prefix: "" });
  }
  // Resolve nested legacy spellings to their existing root without changing any factors.
  const roots = [...new Set([...family.values()].map(value => value.base))];
  for (const base of roots) {
    const definition = units[base];
    for (const prefix of SI_PREFIX_OPTIONS) {
      let key = prefixedUnitKey(base, prefix.key);
      const factor = definition.to_si * 10 ** prefix.power;
      if (units[key] && (units[key].quantity !== definition.quantity || Math.abs(units[key].to_si / factor - 1) > 1e-10)) {
        key = `${prefix.key}(${base})`;
      }
      if (!units[key]) units[key] = { ...definition, to_si: factor };
      family.set(key, { base, prefix: prefix.key });
    }
  }
  for (const [unit, model] of family) {
    Object.defineProperties(units[unit], {
      prefixBase: { value: model.base, configurable: true },
      prefixKey: { value: model.prefix, configurable: true },
    });
  }
  return family;
}
