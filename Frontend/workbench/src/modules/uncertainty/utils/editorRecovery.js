import { recoveryNamespace } from "./recoveryNamespace";
const key = id => `uncertainty:editor:v1:${recoveryNamespace()}:${id}`;
export function readEditorDraft(id) {
  try { return JSON.parse(localStorage.getItem(key(id)) || "null"); } catch { return null; }
}
export function saveEditorDraft(id, value) {
  try { localStorage.setItem(key(id), JSON.stringify(value)); } catch (error) { console.warn("Unable to retain editor draft", error); }
}
export function clearEditorDraft(id) {
  try { localStorage.removeItem(key(id)); } catch { /* Storage may be disabled. */ }
}
