// One in-app clipboard owner across points, budgets, instruments and ranges.
// Claim synchronously before React updates: a subsequent paste must never fall
// through to an older payload held by another workspace surface.
export const WORKSPACE_CLIPBOARD_EVENT = "uncertalytics:workspace-clipboard";
let owner = null;
export function claimWorkspaceClipboard(kind) {
  owner = kind;
  window.dispatchEvent(new CustomEvent(WORKSPACE_CLIPBOARD_EVENT, { detail: { kind } }));
}
export const ownsWorkspaceClipboard = kind => owner === kind;
