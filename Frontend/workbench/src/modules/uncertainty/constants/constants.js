// src/modules/uncertainty/constants/constants.js
//
// Module-private constants for the Uncertainty Budget tool. Define the
// module's API root once here and import it internally rather than scattering
// the URL string. Phase 2 introduces the per-module /api/uncertainty
// namespace; until then this simply suffixes the shared API base.
import { API_BASE_URL } from "../../../shared/config";

export const UNCERTAINTY_API = `${API_BASE_URL}/uncertainty`;

export const RISK_INPUT_FIELDS = [
  {
    name: "uncertaintyConfidence",
    sidebarLabel: "Confidence (%)",
    label: "Uncertainty Confidence (%)",
    tooltip:
      "Probability level used to determine the coverage factor (k) that converts combined standard uncertainty into expanded uncertainty. A value of 95% is common.",
    placeholder: "e.g., 95",
  },
  {
    name: "measRelCalcAssumed",
    sidebarLabel: "Assumed R_REOP",
    label: "Assumed R_REOP",
    tooltip:
      "Estimated probability, expressed as a percent, that the unit remains within tolerance at the end of its current calibration interval. This is the starting reliability for risk and interval calculations.",
  },
  {
    name: "neededTUR",
    sidebarLabel: "TUR Needed",
    label: "TUR Needed",
    tooltip:
      "Minimum test uncertainty ratio used as the desired measurement-capability target. TUR compares the UUT tolerance span with the expanded measurement uncertainty.",
  },
];

export const MITIGATION_INPUT_FIELDS = [
  {
    name: "reqPFA",
    sidebarLabel: "PFA Required",
    label: "PFA Required",
    tooltip:
      "Maximum permitted probability of falsely accepting a unit whose true value is outside tolerance. The guardband calculation tightens acceptance limits to meet this target when possible.",
  },
  {
    name: "reliability",
    sidebarLabel: "R_REOP Required",
    label: "R_REOP Required",
    tooltip:
      "Minimum required probability, expressed as a percent, that the unit remains within tolerance at the end of the recommended calibration interval.",
  },
  {
    name: "calInt",
    sidebarLabel: "Cal Int for assumed R_REOP",
    label: "Cal Int for assumed R_REOP",
    tooltip:
      "Current calibration interval, in months, associated with the assumed end-of-period reliability. The selected reliability-decay model uses it as the time reference when recommending a new interval.",
  },
];

// Retain the aggregate export for the session editor and existing consumers.
export const UNCERTAINTY_REQUIREMENT_FIELDS = [
  ...RISK_INPUT_FIELDS,
  ...MITIGATION_INPUT_FIELDS,
];
