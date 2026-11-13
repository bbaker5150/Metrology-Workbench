# Metrology Workbench

Metrology Workbench combines AC-shunt calibration, **Uncertalytics** measurement
uncertainty and decision risk, and Report of Calibration authoring. The full
application runs in a browser or Electron with a Django backend. Uncertalytics
also ships as a standalone SharePoint application from the same source tree.

## Start here

- [Codebase guide](documentation.md): architecture, data flow and implementation locations.
- [Documentation index](docs/README.md): current operating and development guides.
- [Uncertalytics mathematical audit](Frontend/workbench/src/modules/uncertainty/utils/risk8/FINAL_V8_AUDIT.md): final V8.00 reference, code crosswalk, evidence and limitations.
- [Frontend commands](Frontend/workbench/README.md): development, builds and Notes editor.
- [Contribution workflow](AGENTS.md): focused checks, push, hands-on testing and release validation order.

## Local setup

Use Node.js 22 (the CI version), Python 3 with a virtual environment, and Git LFS
for the desktop application's 3D asset. The application dependency manifest is
`Frontend/workbench/package.json`; install its committed lockfile rather than the
unrelated root package manifest.

On Windows, from the repository root:

```powershell
py -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r Backend/ac_shunt/requirements.txt
python -m pip install -e Backend/ac_shunt/api/NPSL_Tools
git lfs pull
Set-Location Frontend/workbench
npm ci
npm run dev:mock
```

`dev:mock` runs the frontend and backend without lab instruments. For the desktop
shell, use `npm run electron:dev:mock`. Live acquisition additionally requires the
appropriate VISA runtime, instrument access, and lab configuration.

The npm backend scripts use the Windows virtual-environment path. On Linux or
macOS, run the backend and frontend in separate terminals with the active Python
environment:

```sh
# From Backend/ac_shunt
python manage.py bootstrap
python manage.py runserver 0.0.0.0:8000
```

```sh
# From Frontend/workbench
npm ci
npm start
```

Set `MOCK_INSTRUMENTS=1` in the backend environment when using mock instruments.
For proxy-restricted installations, configure the organization's trusted CA and
approved package access. Preserve the lockfile and TLS verification. When only
working on the browser build, `ELECTRON_SKIP_BINARY_DOWNLOAD=1` can skip the Electron
binary download during installation; Electron launch still requires that binary.

## Build and deploy

See [build targets](docs/build-targets.md) for the desktop, standalone and
single-file outputs, and [SharePoint deployment](docs/uncertainty-sharepoint-standalone.md)
for hosting and storage configuration. Build availability and deployment validation
are separate: follow [AGENTS.md](AGENTS.md) before running release gates or claiming
that a particular commit has been published.
