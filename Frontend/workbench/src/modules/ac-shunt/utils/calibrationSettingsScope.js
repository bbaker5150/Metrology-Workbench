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

const F8508_POINT_SETTING_KEY_SET = new Set(F8508_POINT_SETTING_KEYS);

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
      ([key]) => !F8508_POINT_SETTING_KEY_SET.has(key)
    )
  );
}
