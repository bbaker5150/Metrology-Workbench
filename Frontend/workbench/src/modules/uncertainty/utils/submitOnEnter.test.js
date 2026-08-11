import { describe, it, expect, vi } from 'vitest';
import submitOnEnter from './submitOnEnter';

// The handler stands in for what a <form> used to do, so the cases that matter
// are the ones where a form would *not* have submitted: a textarea taking a
// newline, a modifier held down, an IME choosing a candidate.
const press = (overrides = {}) => ({
  key: 'Enter',
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  target: { tagName: 'INPUT', type: 'text' },
  nativeEvent: { isComposing: false },
  preventDefault: vi.fn(),
  ...overrides,
});

describe('submitOnEnter', () => {
  it('submits on Enter from a text input', () => {
    const submit = vi.fn();
    const event = press();
    submitOnEnter(submit)(event);
    expect(submit).toHaveBeenCalledWith(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('passes the event through so the handler can preventDefault', () => {
    const submit = vi.fn((e) => e.preventDefault());
    const event = press();
    expect(() => submitOnEnter(submit)(event)).not.toThrow();
  });

  it.each(['a', 'Tab', 'Escape', ' '])('ignores %s', (key) => {
    const submit = vi.fn();
    submitOnEnter(submit)(press({ key }));
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(['shiftKey', 'altKey', 'ctrlKey', 'metaKey'])('ignores Enter with %s held', (modifier) => {
    const submit = vi.fn();
    submitOnEnter(submit)(press({ [modifier]: true }));
    expect(submit).not.toHaveBeenCalled();
  });

  it('leaves a textarea alone so Enter still inserts a newline', () => {
    const submit = vi.fn();
    const event = press({ target: { tagName: 'TEXTAREA' } });
    submitOnEnter(submit)(event);
    expect(submit).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves a select alone', () => {
    const submit = vi.fn();
    submitOnEnter(submit)(press({ target: { tagName: 'SELECT' } }));
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(['checkbox', 'radio', 'button', 'submit', 'reset', 'file'])(
    'does not submit from a %s input, matching what a form did',
    (type) => {
      const submit = vi.fn();
      submitOnEnter(submit)(press({ target: { tagName: 'INPUT', type } }));
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it.each(['text', 'search', 'date', 'number', 'email'])('submits from a %s input', (type) => {
    const submit = vi.fn();
    submitOnEnter(submit)(press({ target: { tagName: 'INPUT', type } }));
    expect(submit).toHaveBeenCalled();
  });

  it('treats an input with no type as text', () => {
    const submit = vi.fn();
    submitOnEnter(submit)(press({ target: { tagName: 'INPUT' } }));
    expect(submit).toHaveBeenCalled();
  });

  it('ignores Enter while an IME is composing', () => {
    const submit = vi.fn();
    submitOnEnter(submit)(press({ nativeEvent: { isComposing: true } }));
    expect(submit).not.toHaveBeenCalled();
  });

  it('ignores the keyCode 229 form of a composing Enter', () => {
    const submit = vi.fn();
    submitOnEnter(submit)(press({ keyCode: 229, nativeEvent: undefined }));
    expect(submit).not.toHaveBeenCalled();
  });

  it('survives an event with no target', () => {
    const submit = vi.fn();
    expect(() => submitOnEnter(submit)(press({ target: null }))).not.toThrow();
    expect(submit).not.toHaveBeenCalled();
  });
});
