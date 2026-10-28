// Shared display format for instrument tables, measurement points and exports.
// Earlier AC-shunt imports left the UUT's row description empty while keeping
// the library description on its nested instrument definition.
export const getUutDescription = (source = {}) => source.description || source.instrument?.description || '';

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
  if (prefix) {
    // Older imports put the complete identity in Name, sometimes more than
    // once. Display its make/model only once without rewriting saved labels.
    let description = name;
    while (description.toLowerCase() === prefix.toLowerCase() ||
           description.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) {
      description = description.slice(prefix.length).trim();
    }
    identity = [prefix, description].filter(Boolean).join(' ');
  }
  const tag = String(source.nickname || source.tag || instrument.nickname || instrument.tag || "").trim();
  return [tag ? `(${tag})` : "", identity].filter(Boolean).join(" ") || fallback;
};

// Budget labels match the complete identity shown in the instrument table.
export const formatErrorSourceDescription = (source = {}, fallback = "TMDE") =>
  formatInstrumentIdentity({ ...source, description: source.name || source.description || source.instrument?.description }, fallback);

export const formatErrorSourceKind = kind => String(kind || "TMDE Error")
  .replace(/^(Accuracy|Tolerance|Error Limit|dB.*)$/i, "TMDE Error")
  .replace(/^Set tolerance$/i, "Set error limit");

export const instrumentDeleteTarget = (ids, instruments = []) => ids.length > 1
  ? `${ids.length} selected instruments`
  : `“${formatInstrumentIdentity(instruments.find(item => String(item.id) === String(ids[0])) || {})}”`;
