// src/modules/uncertainty/constants/constants.js
//
// Module-private constants for the Uncertainty Budget tool. Define the
// module's API root once here and import it internally rather than scattering
// the URL string. Phase 2 introduces the per-module /api/uncertainty
// namespace; until then this simply suffixes the shared API base.
import { API_BASE_URL } from "../../../shared/config";

export const UNCERTAINTY_API = `${API_BASE_URL}/uncertainty`;

export const UNCERTAINTY_REQUIREMENT_FIELDS = [
  {
    name: "uncertaintyConfidence",
    sidebarLabel: "Confidence (%)",
    label: "Uncertainty Confidence (%)",
    tooltip:
      "Confidence level used for uncertainty coverage calculations. Commonly 95% unless a procedure specifies another value.",
    placeholder: "e.g., 95",
  },
  {
    name: "reliability",
    sidebarLabel: "Meas. Rel. Target (%)",
    label: "Measurement Reliability Target (%)",
    tooltip:
      "Required end-of-period reliability target for the measurement or test item, expressed as a percent.",
  },
  {
    name: "calInt",
    sidebarLabel: "Cal Interval (months)",
    label: "Calibration Interval (months)",
    tooltip:
      "Scheduled calibration interval for the test item or measurement process, entered in months.",
  },
  {
    name: "measRelCalcAssumed",
    sidebarLabel: "Calc./Assumed Rel. (%)",
    label: "Calculated/Assumed Meas. Reliability (%)",
    tooltip:
      "Calculated/assumed end-of-period reliability of the test item. Use 85% for unsupported (new) test items, or the actual empirical reliability for in-service test items.",
  },
  {
    name: "neededTUR",
    sidebarLabel: "Required TUR",
    label: "Required TUR for Assumed Meas. Reliability",
    tooltip:
      "Test uncertainty ratio needed to support the calculated or assumed measurement reliability.",
  },
  {
    name: "reqPFA",
    sidebarLabel: "Required PFA (%)",
    label: "Required Probability of False Accept (%)",
    tooltip:
      "Maximum acceptable probability of falsely accepting an out-of-tolerance item, expressed as a percent.",
  },
];
