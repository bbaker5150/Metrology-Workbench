import { useMemo } from 'react';

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
    const nplc = parseFloat(calibrationSettings.nplc) || 10;
    const numSamples = parseInt(calibrationSettings.num_samples, 10) || 10;
    let warmup = parseFloat(calibrationSettings.initial_warm_up_time) || 0;
    const settling = parseFloat(calibrationSettings.settling_time) || 0;
    const nCycles = parseInt(calibrationSettings.n_cycles, 10) || 1;

    // 34420A integration is specified in power-line cycles. The 8508A has no
    // NPLC control in this workflow. It remains in filtered RESL6 DCV while
    // reading both TVC outputs, so its conversion and terminal-switch timing
    // are independent of the upstream source frequency.
    let timePerSample = (nplc / 60) + 0.12;
    if (has8508 && !has34420) {
      const terminalCount = 2;
      const configuredDelay = parseFloat(calibrationSettings.input_switch_settling_time);
      const dcTerminalDelay = Number.isFinite(configuredDelay)
        ? Math.max(0, configuredDelay)
        : 1.0;
      timePerSample = (terminalCount * dcTerminalDelay) + 0.24;
    }
    const samplingTimePerStage = timePerSample * numSamples;
    const timePerStage = settling + samplingTimePerStage;

    let charStages = 1; 
    if (calibrationSettings.use_char_minus_readings) charStages++;
    if (calibrationSettings.use_char_plus2_readings) charStages++;

    const cycleStages = 4 * nCycles;
    const totalStages = charStages + cycleStages;

    // Active measurement time per point (EXCLUDING warmup)
    const singlePassActiveTime = totalStages * timePerStage;

    let remainingPasses = 1;

    // 1. Are we in the automated pre-batch characterization phase?
    if (calibrationSettings.command === 'tvc_characterization' && calibrationSettings.is_pre_batch) {
      // Total remaining passes = 1 (the current char run) + all the impending batch points
      remainingPasses = 1 + selectedTPCount;
    } 
    // 2. Or are we actively inside the main batch?
    else if (isBulkRunning && bulkRunProgress?.total > 0) {
      remainingPasses = (bulkRunProgress.total - bulkRunProgress.current) + 1;
      
      // Warm-up only happens on the very first point of a batch. 
      // If we are on point 2 or later, zero it out so it isn't added to the time.
      if (bulkRunProgress.current > 1) {
          warmup = 0; 
      }
    }

    // CRITICAL FIX: Warmup is added ONCE as a flat chunk, not multiplied by the passes!
    const totalRemainingSeconds = warmup + (remainingPasses * singlePassActiveTime);

    const completionDate = new Date(Date.now() + (totalRemainingSeconds * 1000));

    // Format to a clean human-readable string
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
      targetDate: completionDate
    };

  }, [isCollecting, isBulkRunning, bulkRunProgress, calibrationSettings, selectedTPCount, readerModels]);
}
