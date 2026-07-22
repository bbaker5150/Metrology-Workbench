import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Jodit measures toolbars and editing geometry that jsdom does not implement.
// The production build uses the real MIT-licensed editor; DOM tests receive a
// small imperative surface with the same value/selection APIs used by Notes.
vi.mock('jodit', () => {
  const make = (source) => {
    const container = document.createElement('div');
    container.className = 'jodit-container';
    const toolbar = document.createElement('div');
    toolbar.className = 'jodit-toolbar__box';
    const workplace = document.createElement('div');
    workplace.className = 'jodit-workplace';
    const editor = document.createElement('div');
    editor.className = 'jodit-wysiwyg';
    editor.contentEditable = 'true';
    workplace.appendChild(editor);
    container.append(toolbar, workplace);
    source.hidden = true;
    source.insertAdjacentElement('afterend', container);

    const instance = {
      container,
      workplace,
      editor,
      events: { on: vi.fn(), off: vi.fn() },
      s: {
        insertHTML: (html) => editor.insertAdjacentHTML('beforeend', html),
      },
      synchronizeValues: vi.fn(),
      destruct: () => container.remove(),
    };
    Object.defineProperty(instance, 'value', {
      get: () => editor.innerHTML,
      set: (value) => { editor.innerHTML = value || ''; },
    });
    return instance;
  };
  return {
    Jodit: {
      make,
      constants: { INSERT_AS_TEXT: 'insert_as_text' },
    },
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
