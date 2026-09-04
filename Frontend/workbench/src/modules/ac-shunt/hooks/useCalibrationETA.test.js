import { describe, expect, it } from 'vitest';
import {
  calculateCalibrationEtaSeconds,
  estimate8508PassSeconds,
  estimate8508StageSeconds,
  get8508AcConversionDelay,
  get8508DcConversionDelay,
} from './useCalibrationETA';

const base8508Settings = {
  num_samples: 6,
  settling_time: 1,
  input_switch_settling_time: 12.5,
  n_cycles: 2,
  stability_check_method: 'sliding_window',
  stability_window: 6,
  ignore_instability_after_lock: true,
  f8508_ac_filter_hz: 100,
  f8508_ac_resolution: 6,
  f8508_dc_filter_enabled: true,
  f8508_dc_resolution: 7,
};

describe('8508A calibration ETA', () => {
  it('uses the same AC/DC conversion delay tables as the 8508A driver', () => {
    expect(get8508AcConversionDelay({
      f8508_ac_filter_hz: 40,
      f8508_ac_resolution: 5,
    })).toBe(0.6);
    expect(get8508DcConversionDelay({
      f8508_dc_filter_enabled: false,
      f8508_dc_resolution: 8,
    })).toBe(5);
  });

  it('accounts for all four stages and skips only later-cycle stability searches', () => {
    expect(estimate8508PassSeconds(base8508Settings)).toBeCloseTo(893.2, 6);

    const firstCycleAc = estimate8508StageSeconds({
      isAc: true,
      settings: base8508Settings,
      cycleIndex: 1,
    });
    const laterCycleAc = estimate8508StageSeconds({
      isAc: true,
      settings: base8508Settings,
      cycleIndex: 2,
    });
    expect(firstCycleAc).toBeGreaterThan(laterCycleAc);
  });

  it('responds to slower filters, higher resolution, and switch-driver routing', () => {
    const fast = estimate8508PassSeconds(base8508Settings);
    const slow = estimate8508PassSeconds({
      ...base8508Settings,
      f8508_ac_filter_hz: 10,
      f8508_dc_resolution: 8,
      has_switch_driver: true,
    });
    expect(slow).toBeGreaterThan(fast);
  });

  it('adds warm-up once and applies the active profile to remaining batch points', () => {
    const onePass = estimate8508PassSeconds(base8508Settings);
    const total = calculateCalibrationEtaSeconds({
      settings: { ...base8508Settings, initial_warm_up_time: 30 },
      is8508Only: true,
      isBulkRunning: true,
      bulkRunProgress: { current: 1, total: 3 },
    });
    expect(total).toBeCloseTo(30 + (3 * onePass), 6);
  });

  it('preserves the existing 34420A/TVC timing model', () => {
    const total = calculateCalibrationEtaSeconds({
      settings: {
        nplc: 60,
        num_samples: 2,
        settling_time: 1,
        n_cycles: 2,
      },
      is8508Only: false,
    });
    expect(total).toBeCloseTo(29.16, 6);
  });
});
