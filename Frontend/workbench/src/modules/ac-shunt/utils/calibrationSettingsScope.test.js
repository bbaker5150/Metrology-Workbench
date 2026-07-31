import { describe, expect, it } from "vitest";
import {
  exclude8508PointSettings,
  F8508_POINT_SETTING_KEYS,
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

  it("keeps Apply All payloads free of point-specific 8508A values", () => {
    expect(exclude8508PointSettings(settings)).toEqual({
      n_cycles: 15,
      settling_time: 5,
    });
  });
});
