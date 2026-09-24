// Align in layout pixels so the arrow remains centered at every scoped zoom.
export function alignEmptyHintArrows(root) {
  root?.querySelectorAll(".measurement-point-empty-hint, .instrument-first-hint").forEach(hint => {
    const group = hint.closest(".measurement-group-container, td");
    const button = group?.querySelector('.function-point-add-button, .function-header-action-btn[data-tour$="-add-instrument"]');
    if (!button || !hint.offsetWidth) return;
    const target = button.getBoundingClientRect();
    const bounds = hint.getBoundingClientRect();
    const scale = bounds.width / hint.offsetWidth || 1;
    const left = `${(target.left + target.width / 2 - bounds.left) / scale}px`;
    if (hint.style.getPropertyValue("--hint-arrow-left") !== left) hint.style.setProperty("--hint-arrow-left", left);
  });
}
