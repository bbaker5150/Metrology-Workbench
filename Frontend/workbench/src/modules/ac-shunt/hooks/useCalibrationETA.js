import { useMemo } from 'react';

const SOURCE_OUTPUT_SETTLING_SECONDS = 1.5;
const SWITCH_DRIVER_SETTLING_SECONDS = 1;
const SAMPLE_LOOP_OVERHEAD_SECONDS = 0.05;

const finiteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const get8508AcConversionDelay = (settings = {}) => {
  const resolution = Number(settings.f8508_ac_resolution) === 5 ? 5 : 6;
  const configuredFilter = Number(settings.f8508_ac_filter_hz);
  const frequency = Math.abs(finiteNumber(settings.frequency, 0));
  const smartFilter = frequency < 40 ? 10 : frequency < 100 ? 40 : 100;
  const filter = [10, 40, 100].includes(configuredFilter)
    ? configuredFilter
    : smartFilter;
  const delays = {
    5: { 100: 0.25, 40: 0.6, 10: 2.0 },
    6: { 100: 0.3, 40: 0.75, 10: 2.5 },
  };
  return delays[resolution][filter];
};

export const get8508DcConversionDelay = (settings = {}) => {
  const configuredResolution = Number(settings.f8508_dc_resolution);
  const resolution = [5, 6, 7, 8].includes(configuredResolution)
    ? configuredResolution
    : 7;
  const filterEnabled = settings.f8508_dc_filter_enabled !== false;
  const delays = {
    5: { on: 0.8, off: 0.08 },
    6: { on: 1.0, off: 0.1 },
    7: { on: 5.0, off: 1.0 },
    8: { on: 10.0, off: 5.0 },
  };
  return delays[resolution][filterEnabled ? 'on' : 'off'];
};

const estimate8508SearchSeconds = ({
  conversionDelay,
  switchDelay,
  windowSize,
}) => {
  // A profile change invalidates the first same-terminal conversion. If the
  // selected terminal also changes, the explicit FRONT/REAR delay replaces
  // that purge. Use the longer path because the UI cannot know which terminal
  // the preceding alternating pair finished on.
  const firstReading = Math.max(2 * conversionDelay, switchDelay);
  return firstReading
    + ((windowSize - 1) * conversionDelay)
    + (windowSize * SAMPLE_LOOP_OVERHEAD_SECONDS);
};

const estimate8508PairCollectionSeconds = ({
  conversionDelay,
  switchDelay,
  numSamples,
  windowSize,
  includesSearch,
}) => {
  const normalPair = conversionDelay + switchDelay;
  let firstPair;

  if (includesSearch) {
    // Stability uses one terminal only. With an even search-window count the
    // alternating pair starts on that terminal; with an odd count it starts
    // on the other terminal and therefore makes two physical switches.
    firstPair = windowSize % 2 === 0
      ? normalPair
      : 2 * switchDelay;
  } else {
    // No search consumed the newly configured profile. Conservatively cover
    // either a same-terminal purge or two terminal changes.
    firstPair = Math.max(
      (2 * conversionDelay) + switchDelay,
      2 * switchDelay,
    );
  }

  return firstPair
    + ((numSamples - 1) * normalPair)
    + (numSamples * SAMPLE_LOOP_OVERHEAD_SECONDS);
};

export const estimate8508StageSeconds = ({
  isAc,
  settings = {},
  cycleIndex = 1,
}) => {
  const numSamples = positiveInteger(settings.num_samples, 10);
  const switchDelay = Math.max(
    0,
    finiteNumber(settings.input_switch_settling_time, 1),
  );
  const settling = Math.max(0, finiteNumber(settings.settling_time, 0));
  const windowSize = positiveInteger(
    settings.stability_window ?? settings.window,
    30,
  );
  const stabilityMethod = settings.stability_check_method || 'sliding_window';
  const ignoreAfterLock = Boolean(settings.ignore_instability_after_lock);
  const includesSearch = stabilityMethod === 'sliding_window'
    && !(ignoreAfterLock && cycleIndex > 1);
  const conversionDelay = isAc
    ? get8508AcConversionDelay(settings)
    : get8508DcConversionDelay(settings);

  const sourceAndRoutingDelay = SOURCE_OUTPUT_SETTLING_SECONDS
    + (settings.has_switch_driver ? SWITCH_DRIVER_SETTLING_SECONDS : 0);
  const searchSeconds = includesSearch
    ? estimate8508SearchSeconds({ conversionDelay, switchDelay, windowSize })
    : 0;
  const collectionSeconds = estimate8508PairCollectionSeconds({
    conversionDelay,
    switchDelay,
    numSamples,
    windowSize,
    includesSearch,
  });

  return sourceAndRoutingDelay + settling + searchSeconds + collectionSeconds;
};

export const estimate8508PassSeconds = (settings = {}) => {
  const nCycles = positiveInteger(settings.n_cycles, 1);
  let total = 0;
  for (let cycleIndex = 1; cycleIndex <= nCycles; cycleIndex += 1) {
    // AC Open -> DC+ -> DC- -> AC Close is the backend's exact cycle order.
    total += 2 * estimate8508StageSeconds({ isAc: true, settings, cycleIndex });
    total += 2 * estimate8508StageSeconds({ isAc: false, settings, cycleIndex });
  }
  return total;
};

const estimateLegacyPassSeconds = (settings = {}) => {
  const nplc = finiteNumber(settings.nplc, 10) || 10;
  const numSamples = positiveInteger(settings.num_samples, 10);
  const settling = Math.max(0, finiteNumber(settings.settling_time, 0));
  const nCycles = positiveInteger(settings.n_cycles, 1);
  const oneReaderSample = (nplc / 60) + 0.12;
  const readerSwitchDelay = Math.max(
    0,
    finiteNumber(settings.reader_switch_settling_time, 0),
  );
  const timePerSample = settings.has_reader_switch
    ? (2 * oneReaderSample) + (2 * readerSwitchDelay)
    : oneReaderSample;
  const timePerStage = settling + (timePerSample * numSamples);

  // Preserve the established 34420A/TVC characterization estimate. The
  // direct 8508A/Y5020 workflow intentionally has no characterization stages.
  let characterizationStages = 1;
  if (settings.use_char_minus_readings) characterizationStages += 1;
  if (settings.use_char_plus2_readings) characterizationStages += 1;
  return (characterizationStages + (4 * nCycles)) * timePerStage;
};

export const calculateCalibrationEtaSeconds = ({
  settings = {},
  is8508Only = false,
  isBulkRunning = false,
  bulkRunProgress = null,
  selectedTPCount = 0,
}) => {
  let warmup = Math.max(0, finiteNumber(settings.initial_warm_up_time, 0));
  const singlePassSeconds = is8508Only
    ? estimate8508PassSeconds(settings)
    : estimateLegacyPassSeconds(settings);
  let remainingPasses = 1;

  if (settings.command === 'tvc_characterization' && settings.is_pre_batch) {
    remainingPasses = 1 + selectedTPCount;
  } else if (isBulkRunning && bulkRunProgress?.total > 0) {
    remainingPasses = Math.max(
      1,
      (bulkRunProgress.total - bulkRunProgress.current) + 1,
    );
    if (bulkRunProgress.current > 1) warmup = 0;
  }

  return warmup + (remainingPasses * singlePassSeconds);
};

export default function useCalibrationETA({
  isCollecting,
  isBulkRunning,
  bulkRunProgress,
  calibrationSettings,
  selectedTPCount,
  readerModels = [],
}) {
  return useMemo(() => {
    if (!isCollecting || !calibrationSettings) return null;

    const normalizedModels = readerModels
      .filter(Boolean)
      .map((model) => String(model).toUpperCase());
    const has8508 = normalizedModels.some((model) => model.includes('8508'));
    const has34420 = normalizedModels.some((model) => model.includes('34420'));
    const totalRemainingSeconds = calculateCalibrationEtaSeconds({
      settings: calibrationSettings,
      is8508Only: has8508 && !has34420,
      isBulkRunning,
      bulkRunProgress,
      selectedTPCount,
    });

    const completionDate = new Date(Date.now() + (totalRemainingSeconds * 1000));
    const hours = Math.floor(totalRemainingSeconds / 3600);
    const minutes = Math.floor((totalRemainingSeconds % 3600) / 60);
    const seconds = Math.floor(totalRemainingSeconds % 60);

    let textString = `~${seconds}s remaining`;
    if (hours > 0) {
      textString = `~${hours}h ${minutes}m remaining`;
    } else if (minutes > 0) {
      textString = `~${minutes}m ${seconds}s remaining`;
    }

    return {
      text: textString,
      targetDate: completionDate,
      totalSeconds: totalRemainingSeconds,
    };
  }, [
    isCollecting,
    isBulkRunning,
    bulkRunProgress,
    calibrationSettings,
    selectedTPCount,
    readerModels,
  ]);
}
