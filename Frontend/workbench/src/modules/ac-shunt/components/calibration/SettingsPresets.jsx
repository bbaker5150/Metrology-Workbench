import React, { useState } from "react";

export const PRESET_KEY = "ac-shunt.settings-presets.v1";
export const readSettingsPresets = () => {
  try { const value = JSON.parse(localStorage.getItem(PRESET_KEY) || "{}"); return { presets: Array.isArray(value.presets) ? value.presets : [], defaultId: value.defaultId || "" }; }
  catch { return { presets: [], defaultId: "" }; }
};
export const readDefaultSettingsPreset = () => {
  const saved = readSettingsPresets();
  return saved.presets.find(p => p.id === saved.defaultId)?.settings || {};
};
export default function SettingsPresets({ settings, keys, onApply, disabled }) {
  const [saved, setSaved] = useState(readSettingsPresets);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const persist = next => { try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); setSaved(next); setMessage(""); return true; } catch { setMessage("This browser could not save the setup."); return false; } };
  return <details className="cal-settings-presets"><summary>Saved setups</summary>
    <p>Save reusable settings on this device. Load a setup, review it, then save it to the point. The default fills settings for new points.</p>
    <div className="cal-settings-preset-row">
      <select aria-label="Saved settings setup" value={selected} disabled={disabled} onChange={event => setSelected(event.target.value)}>
        <option value="">Choose setup</option>{saved.presets.map(p => <option key={p.id} value={p.id}>{p.name}{saved.defaultId === p.id ? " (default)" : ""}</option>)}
      </select>
      <button type="button" disabled={disabled || !selected} onClick={() => { const preset = saved.presets.find(p => p.id === selected); if (preset) onApply(Object.fromEntries(keys.filter(key => Object.hasOwn(preset.settings, key)).map(key => [key, preset.settings[key]]))); }}>Load</button>
      <button type="button" disabled={disabled || !selected} onClick={() => persist({ ...saved, defaultId: selected })}>Use as default</button>
      <button type="button" disabled={disabled || !selected} onClick={() => { if (persist({ presets: saved.presets.filter(p => p.id !== selected), defaultId: saved.defaultId === selected ? "" : saved.defaultId })) setSelected(""); }}>Delete setup</button>
    </div>
    <div className="cal-settings-preset-row"><input aria-label="New setup name" value={name} placeholder="Setup name" disabled={disabled} onChange={event => setName(event.target.value)} />
      <button type="button" disabled={disabled || !name.trim()} onClick={() => { const id = crypto.randomUUID(); const preset = { id, name: name.trim(), settings: Object.fromEntries(keys.filter(key => Object.hasOwn(settings, key)).map(key => [key, settings[key]])) }; if (persist({ ...saved, presets: [...saved.presets, preset] })) { setSelected(id); setName(""); } }}>Save as new setup</button>
      {saved.defaultId && <button type="button" disabled={disabled} onClick={() => persist({ ...saved, defaultId: "" })}>Use system defaults</button>}
    </div>{message && <p role="alert">{message}</p>}
  </details>;
}
