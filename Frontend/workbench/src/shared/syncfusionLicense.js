import { registerLicense } from "@syncfusion/ej2-base";

// Syncfusion validates licenses locally at runtime. Keep the key outside the
// repository and inject it through Vite for both browser and Electron builds.
// An unconfigured development checkout still runs (with Syncfusion's license
// notice), while licensed deployments remain fully offline-capable.
const licenseKey = String(
  import.meta.env.VITE_SYNCFUSION_LICENSE_KEY ||
    globalThis.__SYNCFUSION_LICENSE_KEY__ ||
    "",
).trim();

if (licenseKey) {
  registerLicense(licenseKey);
}

export const isSyncfusionLicenseConfigured = Boolean(licenseKey);
