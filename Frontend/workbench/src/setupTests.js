import React from 'react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// The DOCX editor relies on layout, canvas, and ProseMirror measurements that
// jsdom does not implement. DOM tests receive a focused facade while component
// tests exercise our binary persistence and session-isolation behavior.
vi.mock('@heyirisai/docx-editor-react', () => ({
  createEmptyDocument: () => ({ kind: 'empty-docx' }),
  createDocumentWithText: (text) => ({ kind: 'text-docx', text }),
  DocxEditor: React.forwardRef(function MockDocxEditor(props, ref) {
    const contentRef = React.useRef(null);
    React.useImperativeHandle(ref, () => ({
      save: vi.fn(async () => new TextEncoder().encode(
        contentRef.current?.textContent || 'mock-docx',
      ).buffer),
      focus: vi.fn(),
    }), []);
    React.useEffect(() => {
      props.onEditorViewReady?.({});
    }, [props]);
    return (
      React.createElement('div', { className: 'mock-docx-editor', 'data-testid': 'docx-editor' },
        props.renderTitleBarRight?.(),
        React.createElement('div', {
          ref: contentRef,
          className: 'mock-docx-content',
          contentEditable: true,
          suppressContentEditableWarning: true,
          onInput: () => props.onChange?.({}),
        }, props.document?.text || ''),
      )
    );
  }),
}));

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
