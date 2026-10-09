# Workbench fonts

Inter (400, 600) and Roboto Mono (500, 700) match the Google Fonts stylesheet
previously imported by the AC-Shunt module. Both workbench/Electron and
standalone browser entries now load these assets through `src/index.css`.
Vite embeds the WOFF2 files in the SharePoint single-file build, so fonts also
work offline and in srcdoc frames. Keep all unicode subsets for measurement
symbols and non-English instrument descriptions.

Retrieved 2026-10-09 from:
https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Roboto+Mono:wght@500;700&display=swap

Licensed under the SIL Open Font License 1.1; see `inter-OFL.txt` and
`robotomono-OFL.txt` from https://github.com/google/fonts/tree/main/ofl.

## Asset provenance

- `inter-cyrillic-ext.woff2` — SHA-256 `ca157063339ac4ad418f214f3abfed119b0798ab4d377386ce5c9e5a7a435ebd`
  https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2JL7SUc.woff2
- `inter-cyrillic.woff2` — SHA-256 `71d5ee93cc1e9f1d520a3a8b66456de18c7879d8df09d57fcd2eaff75fef0075`
  https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa0ZL7SUc.woff2
- `inter-greek-ext.woff2` — SHA-256 `6e9e020a25f9b56d418f2c085b1d3c09725a4da23fe693a5b463064606732190`
  https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2ZL7SUc.woff2
- `inter-greek.woff2` — SHA-256 `1be3448e292fbf05ffe176fe1e43f135013d50b1e7d324ad1a558f623d3bb6f6`
  https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1pL7SUc.woff2
- `inter-vietnamese.woff2` — SHA-256 `5c66f9e07e90c6d4ac4922cc68d60de26c17b1858e677fb5e603fce3952b3ff2`
  https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2pL7SUc.woff2
- `inter-latin-ext.woff2` — SHA-256 `34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956`
  https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7SUc.woff2
- `inter-latin.woff2` — SHA-256 `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62`
  https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2
- `roboto-mono-cyrillic-ext.woff2` — SHA-256 `6d72c2150c28b5305e7bfd0290edcf6038e556a9dd11a6ef15a1652548a35693`
  https://fonts.gstatic.com/s/robotomono/v31/L0x5DF4xlVMF-BfR8bXMIjhGq3-OXg.woff2
- `roboto-mono-cyrillic.woff2` — SHA-256 `4052cc0b0f8b1b39da6cfaf90460f8b3c84dfc4b7562e9308ffa0998c3b9a005`
  https://fonts.gstatic.com/s/robotomono/v31/L0x5DF4xlVMF-BfR8bXMIjhPq3-OXg.woff2
- `roboto-mono-greek.woff2` — SHA-256 `308f763acd5f648b0556c1f79b848102f494d0450072cfd2fd8064ddf287f4f8`
  https://fonts.gstatic.com/s/robotomono/v31/L0x5DF4xlVMF-BfR8bXMIjhIq3-OXg.woff2
- `roboto-mono-vietnamese.woff2` — SHA-256 `a4f562a288609dcb8f13e2b52296f1f3360957f09060735d4f00b5886e5bc7e0`
  https://fonts.gstatic.com/s/robotomono/v31/L0x5DF4xlVMF-BfR8bXMIjhEq3-OXg.woff2
- `roboto-mono-latin-ext.woff2` — SHA-256 `4cc0d52e0fa37c28084e0cbce3589a8ab32dd21e6ea619489c5f7c6e8c43b922`
  https://fonts.gstatic.com/s/robotomono/v31/L0x5DF4xlVMF-BfR8bXMIjhFq3-OXg.woff2
- `roboto-mono-latin.woff2` — SHA-256 `b81cd55177300649be8f95b3b747d721ce607e8ed2856e25bd0c630cfd631faf`
  https://fonts.gstatic.com/s/robotomono/v31/L0x5DF4xlVMF-BfR8bXMIjhLq38.woff2
