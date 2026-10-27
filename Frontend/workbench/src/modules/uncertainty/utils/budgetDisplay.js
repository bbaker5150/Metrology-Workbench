import { unitSystem } from './uncertaintyMath';

const unitInfo = unit => unitSystem.units[unit] || unitSystem.units[unit?.replace(/^[µμ]/, 'u')];

// Display-only scaling. Uncertainty magnitudes use scale factors, never offsets.
export function canDisplayRelativeUncertainty(point) {
  const value = point?.value;
  return value != null && value !== '' && Number.isFinite(Number(value)) &&
    Number(value) !== 0 && Boolean(unitInfo(point?.unit)?.to_si);
}

export function budgetUncertaintyDisplay(magnitude, point, mode) {
  if (!mode) return magnitude;
  const targetUnit = mode === 'ppm' ? 'ppm' : point?.unit;
  const missing = { value: null, unit: targetUnit };
  if (magnitude.value == null || magnitude.value === '' || !Number.isFinite(Number(magnitude.value))) return missing;
  const source = unitInfo(magnitude.unit);
  const target = unitInfo(point?.unit);
  if (!source || !target) return missing;
  const relativeScale = { ppm: 1e-6, ppb: 1e-9, '%': 0.01 }[magnitude.unit];
  if ((mode === 'ppm' || relativeScale) && !canDisplayRelativeUncertainty(point)) return missing;
  const nominalBase = Math.abs(Number(point.value) * target.to_si);
  if (!relativeScale && source.quantity !== target.quantity) return missing;
  const absoluteBase = relativeScale
    ? Number(magnitude.value) * relativeScale * nominalBase
    : Number(magnitude.value) * source.to_si;
  return { value: mode === 'ppm' ? absoluteBase / nominalBase * 1e6 : absoluteBase / target.to_si, unit: targetUnit };
}
