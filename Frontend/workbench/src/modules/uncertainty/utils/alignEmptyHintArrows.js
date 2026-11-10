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
        const width = `${(container.clientWidth * containerScale - Math.max(0, hint.getBoundingClientRect().left - container.getBoundingClientRect().left)) / scale}px`;
        if (hint.style.width !== width) hint.style.width = width;
      }
    }
    const target = button.getBoundingClientRect();
    const bounds = hint.getBoundingClientRect();
    const scale = bounds.width / hint.offsetWidth || 1;
    const center = (target.left + target.width / 2 - bounds.left) / scale;
    if (hint.classList.contains("instrument-first-hint")) {
      // Keep the message and its arrow in one flex row, even if the table is
      // wider than the scrollport. Its right edge is half an arrow past center.
      const width = `${center + hint.lastElementChild.offsetWidth / 2}px`;
      if (hint.style.width !== width) hint.style.width = width;
      return;
    }
    const left = `${center}px`;
    if (hint.style.getPropertyValue("--hint-arrow-left") !== left) hint.style.setProperty("--hint-arrow-left", left);
    // The add button can sit inside the hint's right edge. Reserve space up to
    // the measured arrow, not a fixed inset that lets the text run beneath it.
    const arrowWidth = hint.lastElementChild?.offsetWidth || 24;
    const contentRight = `${Math.max(0, hint.offsetWidth - center) + arrowWidth / 2 + 8}px`;
    if (hint.style.getPropertyValue("--hint-content-right") !== contentRight) hint.style.setProperty("--hint-content-right", contentRight);
  });
}
