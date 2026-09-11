export const F8508_POINT_SETTING_KEYS = Object.freeze([
  "input_switch_settling_time",
  "f8508_dc_filter_enabled",
  "f8508_dc_resolution",
  "f8508_dc_fast_enabled",
  "f8508_ac_filter_hz",
  "f8508_ac_resolution",
  "f8508_ac_transfer_enabled",
  "f8508_ac_dc_coupled",
]);

export const F5790_POINT_SETTING_KEYS = Object.freeze([
  "f5790_filter_mode",
  "f5790_filter_restart",
  "f5790_hires_enabled",
  "f5790_range_mode",
  "f5790_input_switch_settling_time",
]);

const F8508_POINT_SETTING_KEY_SET = new Set(F8508_POINT_SETTING_KEYS);
const READER_POINT_SETTING_KEY_SET = new Set([
  ...F8508_POINT_SETTING_KEYS,
  ...F5790_POINT_SETTING_KEYS,
]);

export function select8508PointSettings(settings = {}) {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) =>
      F8508_POINT_SETTING_KEY_SET.has(key)
    )
  );
}

export function exclude8508PointSettings(settings = {}) {
  return Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) => !READER_POINT_SETTING_KEY_SET.has(key)
    )
  );
}

export function select5790PointSettings(settings = {}) {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) =>
      F5790_POINT_SETTING_KEYS.includes(key)
    )
  );
}


export const SETTING_SECTION_LABELS = { general: "General", stability: "Stability", characterization: "Characterization", "8508": "8508A", "5790": "5790", low_frequency: "Low Frequency AC" };
export const SETTINGS_CATEGORY_KEYS = {
  general: ["n_cycles"],
  stability: ["initial_warm_up_time", "settling_time", "nplc", "num_samples", "stability_check_method", "stability_window", "stability_threshold_ppm", "stability_max_attempts", "iqr_filter_ppm_threshold", "ignore_instability_after_lock"],
  characterization: ["characterization_source", "characterize_std_first", "characterize_test_first"],
  "8508": F8508_POINT_SETTING_KEYS,
  "5790": F5790_POINT_SETTING_KEYS,
  low_frequency: ["enable_low_frequency_settings", "enable_11hz_filter", "min_low_freq_settling_time", "lf_harmonic_projection", "lf_harmonics"],
};
export function selectSettingsSection(settings, section) {
  if (!SETTINGS_CATEGORY_KEYS[section]) throw new Error("Unknown settings category");
  return Object.fromEntries(SETTINGS_CATEGORY_KEYS[section].filter(key => key in settings).map(key => [key, settings[key]]));
}

export function settingNumber(value, fallback) {
  return value !== "" && value != null && Number.isFinite(Number(value)) ? Number(value) : fallback;
}

// Keep local edits when readings/settings refresh for the same point.
export function reconcileSettingsDraft(previous, incoming, baseline) {
  if (!baseline) return incoming;
  const next = { ...incoming };
  for (const key of Object.keys(incoming)) {
    if (Object.hasOwn(previous, key) && previous[key] !== baseline[key]) next[key] = previous[key];
  }
  return Object.keys(next).every(key => next[key] === previous[key]) ? previous : next;
}
