import '@testing-library/jest-dom/vitest';
import React from 'react';
import { vi } from 'vitest';

// Syncfusion's browser editor measures toolbar and character-count geometry
// that jsdom deliberately does not implement. Use a faithful, lightweight
// content surface for DOM tests while production builds exercise the real
// editor. The imperative API mirrors the methods used by the notes workspace.
vi.mock('@syncfusion/ej2-react-richtexteditor', () => {
  const RichTextEditorComponent = React.forwardRef(
    ({ value = '', created, change, blur }, forwardedRef) => {
      const panelRef = React.useRef(null);
      const loadedValueRef = React.useRef(null);
      React.useImperativeHandle(forwardedRef, () => ({
        element: panelRef.current?.parentElement,
        value,
        contentModule: { getEditPanel: () => panelRef.current },
        executeCommand: (command, html) => {
          if (command === 'insertHTML') {
            panelRef.current?.insertAdjacentHTML('beforeend', html);
          }
        },
      }));
      React.useLayoutEffect(() => {
        if (panelRef.current && loadedValueRef.current !== value) {
          panelRef.current.innerHTML = value;
          loadedValueRef.current = value;
        }
      }, [value]);
      React.useEffect(() => created?.(), [created]);
      return React.createElement(
        'div',
        { className: 'e-richtexteditor' },
        React.createElement('div', {
          ref: panelRef,
          className: 'e-content session-notes-editor',
          contentEditable: true,
          suppressContentEditableWarning: true,
          onInput: (event) => change?.({ value: event.currentTarget.innerHTML }),
          onBlur: blur,
        }),
      );
    },
  );
  const Service = class {};
  return {
    RichTextEditorComponent,
    Inject: () => null,
    AutoFormat: Service,
    CodeBlock: Service,
    Count: Service,
    EmojiPicker: Service,
    FormatPainter: Service,
    HtmlEditor: Service,
    Image: Service,
    Link: Service,
    PasteCleanup: Service,
    QuickToolbar: Service,
    Resize: Service,
    SlashMenu: Service,
    Table: Service,
    Toolbar: Service,
  };
});

// jsdom does not implement ResizeObserver, while the production UI relies on
// it through react-use-measure / react-three-fiber. A no-op observer is enough
// for render-level tests because layout itself is outside jsdom's scope.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Plotly probes for a 2D canvas while its modules are imported. jsdom's
// built-in stub logs a large "Not implemented" stack before returning null,
// even though these DOM-level tests never draw to that canvas. Return the same
// unsupported result quietly so real test failures remain visible.
if (globalThis.HTMLCanvasElement) {
  globalThis.HTMLCanvasElement.prototype.getContext = () => null;
}
