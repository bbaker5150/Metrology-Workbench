import { unitSystem, errorDistributions, DISTRIBUTION_NOT_SET } from "./uncertaintyMath";
const present = value => value != null && String(value).trim() !== "";
const finite = value => present(value) && Number.isFinite(Number(value));
const validDistribution = value => !present(value) || String(value) === String(DISTRIBUTION_NOT_SET) || errorDistributions.some(d => String(d.value) === String(value));

// Blank specifications are intentional (e.g. all-values ranges or analogue
// instruments without resolution). Validate authored data without inventing it.
export function validateInstrumentSpecifications(instrument = {}) {
  const errors = [];
  (instrument.functions || []).forEach((fn, index) => {
    const label = `Function ${index + 1}`;
    if (!fn.name?.trim()) errors.push(`${label}: name is required`);
    if (!unitSystem.units[fn.unit || fn.units?.[0]]) errors.push(`${label}: select a unit`);
    (fn.ranges || []).forEach((range, rangeIndex) => {
      const at = `${fn.name || label}, range ${rangeIndex + 1}`;
      const unit = range.unit || range.functionUnit || fn.unit || fn.units?.[0];
      if (!unitSystem.units[unit]) errors.push(`${at}: select a range unit`);
      if (range.isSingleValue) {
        if (!finite(range.value ?? range.max ?? range.min)) errors.push(`${at}: enter a numeric single value`);
      } else if (present(range.min) || present(range.max)) {
        if (!finite(range.min) || !finite(range.max)) errors.push(`${at}: enter both numeric bounds`);
        else if (Number(range.min) > Number(range.max)) errors.push(`${at}: minimum must not exceed maximum`);
      }
      const resolution = range.resolution ?? range.measuringResolution;
      if (present(resolution) && (!finite(resolution) || Number(resolution) < 0)) errors.push(`${at}: resolution must be a non-negative number`);
      if (present(resolution) && !unitSystem.units[range.resolutionUnit || range.measuringResolutionUnit || unit]) errors.push(`${at}: select a resolution unit`);
      if (!validDistribution(range.resolutionDistribution ?? range.measuringResolutionDistribution)) errors.push(`${at}: select a resolution distribution`);
      const inspect = (value, path = "tolerance") => {
        if (!value || typeof value !== "object") return;
        Object.entries(value).forEach(([key, entry]) => {
          if (key.startsWith("_") || key === "infinite") return;
          if (entry && typeof entry === "object") inspect(entry, `${path} ${key}`);
          else if (["value", "valueHigh", "valueLow", "high", "low", "magnitude", "offset", "threshold", "limit", "fullScale", "fullScaleValue"].includes(key) && present(entry) && !finite(entry)) errors.push(`${at}: ${path} must be numeric`);
          else if (key.toLowerCase().includes("distribution") && !validDistribution(entry)) errors.push(`${at}: select a tolerance distribution`);
        });
      };
      inspect(range.tolerances);
    });
  });
  return [...new Set(errors)];
}
