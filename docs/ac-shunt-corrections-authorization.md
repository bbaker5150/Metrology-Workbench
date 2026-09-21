# Imported-corrections authorization

The existing password prompt remains. Verification now runs on the Django
backend; no password or password hash is bundled into the frontend. Users can
keep using the same password **after an administrator configures it on each
backend serving the app**. It is not configured automatically by this PR.

## Deploy and configure

1. Deploy the updated full workbench frontend and Django backend together.
   The Uncertainty single-file HTML does not include the AC Shunt module.
2. Back up the database, then from `Backend/ac_shunt` run the normal migration:
   `python manage.py migrate api` (includes decimal TVC correction migration 0040).
3. Using the backend's Python environment and service account, run:

   ```sh
   python manage.py configure_corrections_password
   ```

4. Enter and confirm the desired password at the hidden prompts. Entering the
   existing password keeps the user experience unchanged. Do not put it in
   source control, command arguments, tickets, logs, or a CI configuration file.
5. The command stores a salted Django password hash in
   `CREDENTIALS_DIR/corrections-admin-password.hash`, outside the application
   bundle. Restrict this file and its directory to the backend service account
   and administrators; on Windows, configure the corresponding file ACLs.
6. Open Corrections, select an imported device, edit a report, and verify the
   prompt and save. A wrong password must not unlock edits. Manual devices and
   reading correction reports do not require this password.

Managed deployments may instead provide an encoded Django password hash through
the server-only `AC_SHUNT_CORRECTIONS_PASSWORD_HASH` environment variable. This
takes precedence over the file. The setup command refuses to write a file while
the override is set, so there is no misleading configuration change.

Re-run the setup command to rotate the password. Existing frontend credentials
were exposed to anyone with the old application bundle, and removing them here
does not erase old bundles or Git history. Keeping the same password supports
continuity, but an administrator should plan a rotation.

## Enforcement and deployment constraints

- Imported Shunt/TVC device and report create/edit/delete/pin API operations are
  protected on the backend, not just by hidden UI controls. Device creation via
  the public API is manual-only; imports remain server-side. API clients cannot
  switch a device's manual/imported classification or overwrite another report
  by submitting its ID.
- Successful verification returns an opaque, device-scoped authorization grant
  valid for ten minutes. It lives only in modal memory, is sent using the
  `Authorization: Corrections …` header, and is discarded when the modal closes.
  Expired grants prompt again without discarding the editor contents.
- Password changes invalidate existing grants. Restarting a backend with the
  default local-memory cache also invalidates grants. Multiple backend worker
  processes must use a shared, access-controlled Django cache for grants and
  throttling; the default cache is suitable for a single backend process.
- Verification is limited to five requests per minute per client IP. Configure
  trusted proxy handling correctly if deployed behind a proxy. Responses are
  marked `Cache-Control: no-store`; do not log request bodies or authorization
  headers at the proxy/application level.
- Missing or invalid configuration refuses imported-data changes with HTTP 503;
  it never falls back to a built-in password. Reads and manual-device editing
  continue to work.
- Use HTTPS for network access and disable Django debug pages in production.
  Loopback desktop deployments may use their existing local transport. This
  change protects imported correction data only; it does not add general user
  accounts, transport encryption, or authorization to unrelated workbench APIs.

## Validation

Backend tests cover protected endpoints, wrong passwords, throttling, scope,
expiry, rotation, manual-device behavior, report-ID isolation, and hidden-prompt
configuration. Frontend tests cover server verification, failed/cancelled
verification, grant headers, reauthorization, and manual editing.
