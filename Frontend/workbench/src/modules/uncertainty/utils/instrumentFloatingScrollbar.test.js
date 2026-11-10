import { afterEach, expect, it, vi } from 'vitest';
import { createInstrumentFloatingScrollbar } from './instrumentFloatingScrollbar';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const dimensions = (node, values) => Object.entries(values).forEach(([key, value]) =>
  Object.defineProperty(node, key, { configurable: true, get: typeof value === 'function' ? value : () => value }));

it('keeps horizontal scrolling available at the visible nested viewport edge and hands back to the native track', () => {
  vi.stubGlobal('innerHeight', 800); vi.stubGlobal('innerWidth', 1200);
  const panel = document.createElement('div'), host = document.createElement('div'), container = document.createElement('div');
  panel.style.overflowY = 'auto'; host.className = 'instrument-table-viewport';
  panel.append(host); host.append(container); document.body.append(panel);
  let top = 100, panelBottom = 600, scrollWidth = 900;
  dimensions(panel, { offsetWidth: 700, clientWidth: 700, clientHeight: () => panelBottom, clientLeft: 0, clientTop: 0 });
  panel.getBoundingClientRect = () => ({ left: 0, top: 0, right: 700, bottom: panelBottom, width: 700, height: panelBottom });
  dimensions(container, { offsetWidth: 400, clientWidth: 400, clientHeight: 1000, clientLeft: 0, clientTop: 0, scrollWidth: () => scrollWidth });
  dimensions(host, { offsetWidth: 400, clientLeft: 0, clientTop: 0 });
  container.getBoundingClientRect = host.getBoundingClientRect = () => ({ left: 50, right: 450, top, bottom: top + 1012, width: 400, height: 1012 });
  container.getClientRects = () => [container.getBoundingClientRect()];
  const scrollbar = createInstrumentFloatingScrollbar(container);
  const bar = host.querySelector('[aria-label="Horizontal scroll for instrument table"]');
  scrollbar.sync();
  expect(bar.hidden).toBe(false);
  expect(bar.style.top).toBe('486px');
  expect(bar.style.width).toBe('400px');
  expect(bar.firstChild.style.width).toBe('900px');
  container.scrollLeft = 125; scrollbar.sync();
  expect(bar.scrollLeft).toBe(125);
  bar.scrollLeft = 260; bar.dispatchEvent(new Event('scroll'));
  expect(container.scrollLeft).toBe(260);
  panelBottom = 350; scrollbar.sync();
  expect(bar.style.top).toBe('236px');
  top = -800; scrollbar.sync();
  expect(bar.hidden).toBe(true); // Native bottom is now in view.
  top = 500; scrollbar.sync();
  expect(bar.hidden).toBe(true); // Table is below the visible panel.
  top = 100; scrollWidth = 400; scrollbar.sync();
  expect(bar.hidden).toBe(true); // No horizontal overflow.
  scrollbar.destroy();
  expect(host.querySelector('.instrument-floating-scrollbar')).toBeNull();
});
