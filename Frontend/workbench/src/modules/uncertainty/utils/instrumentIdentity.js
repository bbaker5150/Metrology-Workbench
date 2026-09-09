// Shared display format for instrument tables, measurement points and exports.
export const formatInstrumentIdentity = (source = {}, fallback = "Instrument") => {
  const instrument = source.instrument || source;
  const parts = [];
  [instrument.manufacturer || source.manufacturer,
   instrument.model || source.model,
   source.description || source.name || instrument.description || instrument.name]
    .forEach(part => {
      const value = String(part || "").trim();
      if (value && !parts.some(existing => existing.toLowerCase() === value.toLowerCase())) parts.push(value);
    });
  let identity = parts.join(" ");
  const name = parts.at(-1) || "";
  const prefix = parts.slice(0, -1).join(" ");
  if (prefix && name.toLowerCase().startsWith(prefix.toLowerCase())) identity = name;
  const tag = String(source.nickname || "").trim();
  return [tag ? `(${tag})` : "", identity].filter(Boolean).join(" ") || fallback;
};
