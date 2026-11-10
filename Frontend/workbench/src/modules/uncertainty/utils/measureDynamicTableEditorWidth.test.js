import { afterEach, expect, it } from 'vitest';
import { measureDynamicTableEditorWidth } from './measureDynamicTableEditorWidth';

afterEach(() => document.body.replaceChildren());
const size = (node, width) => {
  for (const key of ['offsetWidth', 'scrollWidth']) Object.defineProperty(node, key, { configurable: true, value: width });
};
const fixture = () => {
  const editor = document.createElement('div');
  editor.style.cssText = 'padding: 0 3px; border: 1px solid;';
  editor.innerHTML = '<div class="instrument-tolerance-toolbar" style="padding:0 2px;column-gap:6px"><button></button><button></button></div><div class="dynamic-budget-editor" style="padding:4px 5px"><div class="dynamic-table-scroll" style="padding-left:48px"><table class="dynamic-lookup-table"></table></div></div>';
  document.body.append(editor);
  const lookup = editor.querySelector('table');
  size(lookup, 205);
  editor.querySelectorAll('button').forEach(button => { size(button, 24); button.getClientRects = () => [{}]; });
  return { editor, lookup };
};

it('reserves the grid gutter and all nested editor padding without feeding allocated widths back into sizing', () => {
  const { editor, lookup } = fixture();
  size(editor, 2000);
  // 205 grid + 48 balancing gutter + 10 dynamic editor + 8 outer border/padding.
  expect(measureDynamicTableEditorWidth(editor)).toBe(271);
  size(editor, 271);
  expect(measureDynamicTableEditorWidth(editor)).toBe(271);
  size(lookup, 240);
  expect(measureDynamicTableEditorWidth(editor)).toBe(306);
});

it('uses the toolbar intrinsic width when it exceeds the nested grid', () => {
  const { editor } = fixture();
  size(editor.querySelector('button'), 300);
  expect(measureDynamicTableEditorWidth(editor)).toBe(342);
});
