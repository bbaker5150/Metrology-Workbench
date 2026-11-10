// Leave text and rich-text editing to the focused editor. Checkboxes, color
// pickers and other non-text controls rely on workspace history instead.
export function historyShortcut(event, active = document.activeElement) {
  if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = String(event.key).toLowerCase();
  if (key !== "z" && (key !== "y" || event.shiftKey)) return null;
  const textInput = active?.tagName === "INPUT" &&
    ["text", "number", "search", "url", "tel", "email", "password"].includes(active.type);
  const emptyQualifier = active?.closest?.("[data-qualifier-cell]") && active.value === "";
  if (((textInput || active?.tagName === "TEXTAREA") && !emptyQualifier) || active?.isContentEditable) return null;
  return key === "y" || event.shiftKey ? "redo" : "undo";
}
