// Chromium can rasterize the entire row-spanned table for a native <tr> drag.
// Keep the drag image bounded regardless of instrument count or open editors.
export function setInstrumentDragPreview(event, label, count = 1) {
  if (!event.dataTransfer?.setDragImage) return;
  const preview = document.createElement("canvas");
  preview.width = 280; preview.height = 40;
  const context = preview.getContext("2d");
  if (!context) return;
  context.fillStyle = "#1c293e"; context.fillRect(0, 0, 280, 40);
  context.font = "13px sans-serif"; context.fillStyle = "#fff";
  context.fillText(count > 1 ? `${count} instruments` : String(label || "Instrument").slice(0, 36), 12, 25);
  Object.assign(preview.style, { position: "fixed", left: "-10000px", top: "0", pointerEvents: "none" });
  document.body.append(preview);
  event.dataTransfer.setDragImage(preview, 16, 20);
  requestAnimationFrame(() => preview.remove());
}
