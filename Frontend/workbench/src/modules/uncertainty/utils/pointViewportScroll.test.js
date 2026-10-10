import { describe, it, expect, vi } from 'vitest';
import { scrollPointViewport } from './pointViewportScroll';

describe('measurement point horizontal wheel scrolling', () => {
  const setup = (overrides = {}) => {
    const viewport = { scrollWidth: 1400, clientWidth: 700, scrollHeight: 500, clientHeight: 500, scrollLeft: 0, ...overrides };
    const surface = { closest: () => viewport };
    const event = { target: { closest: selector => selector === '.measurement-points-zoom-surface' ? surface : null },
      deltaY: 120, deltaX: 0, deltaMode: 0, preventDefault: vi.fn() };
    return { viewport, event };
  };
  it('moves horizontally when every row fits and clamps at the last column', () => {
    const { viewport, event } = setup();
    scrollPointViewport(event);
    expect(viewport.scrollLeft).toBe(120);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    event.deltaY = 2000;
    scrollPointViewport(event);
    expect(viewport.scrollLeft).toBe(700);
  });
  it('keeps vertical scrolling unless Shift is held', () => {
    const { viewport, event } = setup({ scrollHeight: 900 });
    scrollPointViewport(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    event.shiftKey = true;
    event.deltaMode = 1;
    event.deltaY = 3;
    scrollPointViewport(event);
    expect(viewport.scrollLeft).toBe(48);
  });
  it.each([{ctrlKey:true}, {metaKey:true}, {deltaX:20}, {defaultPrevented:true}])('preserves native trackpad and zoom behavior: %j', flags => {
    const { viewport, event } = setup();
    scrollPointViewport({...event, ...flags});
    expect(viewport.scrollLeft).toBe(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
