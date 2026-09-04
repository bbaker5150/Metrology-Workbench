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
