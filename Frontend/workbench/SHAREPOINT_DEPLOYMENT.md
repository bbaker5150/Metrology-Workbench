# SharePoint standalone deployment

The standalone and single-file builds use the Microsoft 365 identity that is
already signed in to SharePoint. They do not collect or store a second app
password. On startup, the app calls SharePoint's `/_api/web/currentuser`
endpoint with the current same-origin session; if SharePoint cannot identify a
user, the storage gate stops before any session data is loaded.

## Data ownership

- Sessions and their attached images are private workspaces in the app. The
  sessions query is filtered to the item's SharePoint `AuthorId`, and new file
  names include the signed-in user's numeric SharePoint id. Different users can
  therefore use the same per-user session ids without overwriting one another.
- Existing `session-<id>.json` and `image-<session>-<image>.json` files remain
  available to their original SharePoint author. When saved again, their
  existing filename is preserved.
- Instruments, equations, and bug reports remain shared site lists. They are
  deliberately not filtered by user, so every app user sees the same library
  and issue history.
- The normal local/Electron build is unchanged; user scoping exists only in the
  SharePoint storage adapter.

## Hosting requirements

Upload either `build-standalone` or the generated
`build-singlefile/uncertainty-budget.html` into the SharePoint site that owns
the app's lists. The page must be opened from SharePoint (or embedded in a
same-origin SharePoint page) so the Microsoft 365 login cookies and page
context are available. A downloaded HTML file opened from disk cannot use
SharePoint authentication.

If the file is hosted under a different web than the storage lists, set the
existing `webUrl` configuration override to that web and make sure the hosting
context is allowed to call it.

### Embedded mutation confirmations

The app does not use SharePoint's tunneled `MERGE` or `DELETE` method overrides.
Those override headers cause some embedded single-file hosts to interrupt users
with a mutation confirmation even though the operation is already constrained
and validated by the app. Existing list rows are updated with
`ValidateUpdateListItem`, and removals use SharePoint's recoverable `recycle()`
endpoint; both are ordinary authenticated POST requests.

Normal budget edits still avoid redundant metadata writes. The session JSON is
updated, but its picker columns are only posted when the session name, analyst,
organization, document, or document date actually changes. Standard,
standalone, and single-file builds use the same storage behavior.

## Permission boundary

The app's user filter prevents one analyst's sessions from appearing or being
addressed through the app. A SharePoint document library inherits its parent
permissions by default, however, so this filter alone is not a confidentiality
boundary for users who browse the library directly or call SharePoint REST
outside the app.

When session contents require strict isolation, a SharePoint administrator
should apply unique permissions to each user's session files or user folder
(normally with site automation), while leaving the Instruments, Equations, and
Bug Reports lists inherited and shared. SharePoint documents support unique
permission scopes, but ordinary contributors often cannot create those scopes
themselves; keeping that policy in site administration avoids making app saves
depend on elevated permission-management rights.

Microsoft guidance: [Manage Permission Scopes in SharePoint](https://learn.microsoft.com/en-us/sharepoint/manage-permission-scope).
