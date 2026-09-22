import { getDeviceKey } from "./deviceKey";
import { UNCERTAINTY_API } from "../constants/constants";
export function recoveryNamespace() {
  let site = "";
  try { site = window._spPageContextInfo?.webAbsoluteUrl || window.parent?._spPageContextInfo?.webAbsoluteUrl || window.location.pathname; } catch { site = window.location.pathname; }
  return `${UNCERTAINTY_API}:${site}:${getDeviceKey()}`;
}
