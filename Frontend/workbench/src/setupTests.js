import '@testing-library/jest-dom/vitest';

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
