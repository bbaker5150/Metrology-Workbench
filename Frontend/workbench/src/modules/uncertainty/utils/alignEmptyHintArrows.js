// Align in layout pixels so the arrow remains centered at every scoped zoom.
export function alignEmptyHintArrows(root) {
  root?.querySelectorAll(".measurement-point-empty-hint, .instrument-first-hint, .measurement-area-empty-hint").forEach(hint => {
    const isAreaHint = hint.classList.contains("measurement-area-empty-hint");
    const group = hint.closest(isAreaHint ? ".panel-card, .results-sidebar" : ".measurement-group-container, td");
    const button = group?.querySelector(isAreaHint ? '.sidebar-area-entry button'
      : '.function-point-add-button, .function-header-action-btn[data-tour$="-add-instrument"]');
    if (!button || !hint.offsetWidth) return;
    if (isAreaHint) {
      const container = hint.closest(".instrument-panel-table-container");
      if (container) {
        const scale = hint.getBoundingClientRect().width / hint.offsetWidth || 1;
        const containerScale = container.getBoundingClientRect().width / container.offsetWidth || 1;
        const width = `${container.clientWidth * containerScale / scale}px`;
        if (hint.style.width !== width) hint.style.width = width;
      }
    }
    const target = button.getBoundingClientRect();
    const bounds = hint.getBoundingClientRect();
    const scale = bounds.width / hint.offsetWidth || 1;
    const left = `${(target.left + target.width / 2 - bounds.left) / scale}px`;
    if (hint.style.getPropertyValue("--hint-arrow-left") !== left) hint.style.setProperty("--hint-arrow-left", left);
  });
}
