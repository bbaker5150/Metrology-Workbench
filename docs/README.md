# Documentation

Use the [repository overview](../README.md) to get started and the
[codebase guide](../documentation.md) for architecture and implementation locations.
This index lists maintained guidance. Superseded task logs and completion reports
are recoverable from Git history rather than kept alongside current instructions.

## Uncertalytics

- [Final V8.00 mathematical audit](../Frontend/workbench/src/modules/uncertainty/utils/risk8/FINAL_V8_AUDIT.md) — Excel procedure mapping, numerical rules, independent evidence, known differences and verification commands. Detailed rationale also lives beside the calculations in code comments.
- [Bias settings](uncertainty-bias.md) — units, ownership, net overrides and persistence.
- [Performance](uncertalytics-performance.md) — cache ownership, invalidation and large-session checks.
- [AC-shunt import](ac-shunt-uncertalytics-import.md) — source snapshots and budget construction.
- [Reference library](../Backend/ac_shunt/uncertainty/AC_SHUNT_LIBRARY.md) — bundled instrument data.

## Development and deployment

- [Frontend setup](../Frontend/workbench/README.md)
- [Build targets](build-targets.md)
- [Testing and coverage](testing-coverage.md)
- [Adding a module](adding-a-module.md)
- [Standalone SharePoint architecture](uncertainty-sharepoint-standalone.md)
- [SharePoint deployment](../Frontend/workbench/SHAREPOINT_DEPLOYMENT.md)
- [Agent workflow](../AGENTS.md)

## Calibration and reporting

- [8508A integration](8508a-ac-shunt-integration.md)
- [Correction authorization](ac-shunt-corrections-authorization.md)
- [Cycle stability](ac-shunt-cycle-stability.md)
- [Shared 5790 stability](ac-shunt-shared-5790-stability.md)
- [Calibration settings saves](ac-shunt-settings-saves.md)
- [Disconnect and renderer diagnostics](calibration-disconnect-diagnostics.md)
- [Session latency diagnostics](session-latency-diagnostics.md)
- [Report customer directory](report-customer-directory.md)

## Assets and third-party provenance

- [Shared fonts](../Frontend/workbench/src/shared/fonts/README.md)
- [Forge runtime](../Frontend/workbench/vendor/forge/README.md)
- [Icon builder](../Frontend/icon_builder/README.md)
- [Emblem generation](../Frontend/workbench/scripts/EMBLEM.md)
