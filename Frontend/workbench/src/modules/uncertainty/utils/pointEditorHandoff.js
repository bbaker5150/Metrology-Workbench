// Commit the focused field inside the destination's opening event. Closing on
// pointer-down capture and opening on click paints a collapsed table in between.
export const commitFocusedPointField = (target) => {
  const focused = target.ownerDocument.activeElement;
  if (focused?.closest?.('.point-grid-item')) focused.blur?.();
};

export const isPointEditorPress = (event) =>
  event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey;
