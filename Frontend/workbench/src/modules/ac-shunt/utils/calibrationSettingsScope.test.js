import { describe, expect, it } from "vitest";
import {
  exclude8508PointSettings,
  F5790_POINT_SETTING_KEYS,
  F8508_POINT_SETTING_KEYS,
  select5790PointSettings,
  select8508PointSettings,
} from "./calibrationSettingsScope";

describe("calibration settings scopes", () => {
  const settings = {
    n_cycles: 15,
    settling_time: 5,
    input_switch_settling_time: 12.5,
    f8508_dc_filter_enabled: true,
    f8508_dc_resolution: 7,
    f8508_dc_fast_enabled: false,
    f8508_ac_filter_hz: 40,
    f8508_ac_resolution: 6,
    f8508_ac_transfer_enabled: true,
    f8508_ac_dc_coupled: false,
    f5790_filter_mode: "FAST",
    f5790_filter_restart: "COARSE",
    f5790_hires_enabled: false,
    f5790_range_mode: "0.22",
    f5790_input_switch_settling_time: 1,
  };

  it("isolates every point-specific 8508A setting", () => {
    expect(select8508PointSettings(settings)).toEqual({
      input_switch_settling_time: 12.5,
      f8508_dc_filter_enabled: true,
      f8508_dc_resolution: 7,
      f8508_dc_fast_enabled: false,
      f8508_ac_filter_hz: 40,
      f8508_ac_resolution: 6,
      f8508_ac_transfer_enabled: true,
      f8508_ac_dc_coupled: false,
    });
    expect(Object.keys(select8508PointSettings(settings))).toHaveLength(
      F8508_POINT_SETTING_KEYS.length
    );
  });

  it("isolates every point-specific 5790A/B setting", () => {
    expect(select5790PointSettings(settings)).toEqual({
      f5790_filter_mode: "FAST",
      f5790_filter_restart: "COARSE",
      f5790_hires_enabled: false,
      f5790_range_mode: "0.22",
      f5790_input_switch_settling_time: 1,
    });
    expect(Object.keys(select5790PointSettings(settings))).toHaveLength(
      F5790_POINT_SETTING_KEYS.length
    );
  });

  it("keeps Apply All payloads free of point-specific reader values", () => {
    expect(exclude8508PointSettings(settings)).toEqual({
      n_cycles: 15,
      settling_time: 5,
    });
  });
});

import { SETTINGS_CATEGORY_KEYS, selectSettingsSection, settingNumber, reconcileSettingsDraft } from './calibrationSettingsScope';

it.each(Object.keys(SETTINGS_CATEGORY_KEYS))('saves every %s field without another category', category => {
  const settings = Object.fromEntries(Object.values(SETTINGS_CATEGORY_KEYS).flat().map((key, index) => [key, index]));
  expect(Object.keys(selectSettingsSection(settings, category))).toEqual([...SETTINGS_CATEGORY_KEYS[category]]);
});
it('keeps valid zero values and falls back only for invalid numbers', () => {
  expect(settingNumber('0', 45)).toBe(0);
  expect(settingNumber('0.5', 45)).toBe(0.5);
  expect(settingNumber('', 45)).toBe(45);
  expect(settingNumber(undefined, 45)).toBe(45);
});
it('preserves unsaved categories while accepting a server refresh', () => {
  const baseline = { n_cycles: 7, settling_time: 45, f5790_filter_mode: 'MEDIUM' };
  const draft = { ...baseline, settling_time: 0 };
  expect(reconcileSettingsDraft(draft, { ...baseline, f5790_filter_mode: 'FAST' }, baseline))
    .toEqual({ ...draft, f5790_filter_mode: 'FAST' });
});
it('loads another point without carrying over the previous point edits', () => {
  expect(reconcileSettingsDraft({ n_cycles: 7 }, { n_cycles: 12 }, null)).toEqual({ n_cycles: 12 });
});
