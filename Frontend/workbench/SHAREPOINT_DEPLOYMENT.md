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
- Validated instruments, equations and bug reports are shared. Local instruments and pending submissions use a private working list. SharePoint restricts ordinary contributors to their own rows. The Instrument Library inbox is available to members of the **Uncertalytics SME** site group.

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

The app ordinarily updates existing rows with `ValidateUpdateListItem`. Removals archive the original content with a timestamp and acting user. Provisioning and storage organization use scoped `MERGE` updates to list settings. Approval uses version-checked `MERGE` updates to publish the reviewed definition and archive the submitted version.

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

A site owner must run storage setup and grant the **Uncertalytics SME** group Manage Lists and Contribute on the Published Instruments and Instrument Drafts lists. Ordinary app users need Read on the historical Instruments list, Read on Published Instruments, and Contribute on Instrument Drafts. Setup preserves the historical authors and copies earlier shared definitions into the new catalog. Review list-level grants and inherited permissions when upgrading a site. The full setup guide includes the access matrix and a three-account verification procedure. [Instrument review and SharePoint permissions](../../docs/uncertainty-sharepoint-standalone.md#instrument-review-and-sharepoint-permissions)

Administrators can apply unique permissions to session files or user folders when stricter isolation of session contents is needed. [Microsoft guidance on permission scopes](https://learn.microsoft.com/en-us/sharepoint/manage-permission-scope)
