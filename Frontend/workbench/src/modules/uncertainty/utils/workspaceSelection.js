// Clipboard ownership follows the last surface the user selected. Instrument
// capture-phase shortcuts must never consume a point-list shortcut merely
// because an old instrument row remains highlighted in another component.
export const WORKSPACE_SELECTION_EVENT = "uncertalytics:workspace-selection";
export const claimWorkspaceSelection = owner => {
  window.dispatchEvent(new CustomEvent(WORKSPACE_SELECTION_EVENT, { detail: { owner } }));
};
