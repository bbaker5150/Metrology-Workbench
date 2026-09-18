import { RISK_INPUT_FIELDS, MITIGATION_INPUT_FIELDS } from "../constants/constants";

export const POINT_REQUIREMENT_FIELDS = [...RISK_INPUT_FIELDS, ...MITIGATION_INPUT_FIELDS];
export const DEFAULT_POINT_REQUIREMENTS = { uncertaintyConfidence: 95, measRelCalcAssumed: 85, neededTUR: 4, reqPFA: 2, reliability: 85, calInt: 12 };
export const requirementColumn = field => `input_${field.name}`;
export const getPointRequirements = (point, session) => ({ ...DEFAULT_POINT_REQUIREMENTS, ...session?.uncReq, ...point?.riskRequirements });
export const getPointRequirementOverrides = (point, session) => POINT_REQUIREMENT_FIELDS.filter(field =>
  Object.hasOwn(point?.riskRequirements || {}, field.name) &&
  String(point.riskRequirements[field.name]) !== String(session?.uncReq?.[field.name] ?? DEFAULT_POINT_REQUIREMENTS[field.name]));

// Point overrides affect calculations only. Never pass this projected session
// into a save handler: doing so would overwrite the defaults for every point.
// Unmodified points retain their original session object and legacy behavior.
export function sessionForPoint(point, session) {
  if (!point?.riskRequirements || !Object.keys(point.riskRequirements).length) return session;
  return { ...session, uncReq: { ...session?.uncReq, ...point.riskRequirements } };
}

export function setPointRequirement(point, session, key, text) {
  const next = { ...point.riskRequirements };
  const baseline = session?.uncReq?.[key] ?? DEFAULT_POINT_REQUIREMENTS[key];
  if (String(text).trim() === "" || Number(text) === Number(baseline)) delete next[key];
  else next[key] = text;
  return { ...point, riskRequirements: next };
}
