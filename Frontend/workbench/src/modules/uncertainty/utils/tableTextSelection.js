const TEXT_TARGETS = 'input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"], .inline-desc-combined, .inline-tolerance-summary, .inline-range-main, .budget-source-description';
const ACTION_TARGETS = 'button:not(.inline-tolerance-summary):not(.inline-desc-combined):not(.budget-source-description), select, input[type="checkbox"], input[type="radio"], a[href]';
const isActionTarget = target => Boolean(target?.closest?.(ACTION_TARGETS));

// Compact range actions share a wrapper with selectable text. Classify the
// actual control first, otherwise a small movement over +/× swallows its click.
export const isTableTextTarget = target => !isActionTarget(target) && Boolean(target?.closest?.(TEXT_TARGETS));

// Neither editing text nor operating a control should start an instrument drag.
export const isTableDragBlockedTarget = target => isActionTarget(target) || isTableTextTarget(target);

// A browser may emit click on the common ancestor when a text-selection drag
// finishes in another cell. That click must not dismiss/remount the editor.
// Window capture runs before the document-level inline click-away handlers.
export function preserveTableTextSelection(root) {
  let gesture = null;
  const down = event => {
    gesture = event.button === 0 && root.contains(event.target) && !isActionTarget(event.target) &&
      (isTableTextTarget(event.target) || event.target.closest?.('.point-grid-item'))
      ? { x: event.clientX, y: event.clientY, moved: false, pointerId: event.pointerId } : null;
  };
  const move = event => {
    if (gesture && event.pointerId === gesture.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4) gesture.moved = true;
  };
  const click = event => {
    const selecting = gesture?.moved;
    gesture = null;
    if (!selecting || event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const clear = () => { gesture = null; };
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('click', click, true);
  window.addEventListener('pointercancel', clear, true);
  window.addEventListener('blur', clear);
  return () => {
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('click', click, true);
    window.removeEventListener('pointercancel', clear, true);
    window.removeEventListener('blur', clear);
  };
}
