import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import installFormSubmitShim from './formSubmitShim';

// jsdom does not perform native form submission either, so what these assert is
// the shim's own contract: a submit-button click reaches the form's submit
// handler exactly once, and nothing else changes.

let uninstall;

const render = (html) => {
  document.body.innerHTML = html;
  return document.querySelector('form');
};

const click = (selector) => document.querySelector(selector).dispatchEvent(
  new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
);

// Where the shim deliberately stands aside, jsdom runs its own activation
// behaviour and then logs that navigation is not implemented. Cancelling the
// submit stops it short of that, keeping the suite output readable.
const quietNativeSubmit = (form) => form.addEventListener('submit', (e) => e.preventDefault());

beforeEach(() => {
  uninstall = installFormSubmitShim();
});

afterEach(() => {
  uninstall();
  document.body.innerHTML = '';
});

describe('installFormSubmitShim', () => {
  it('turns a submit-button click into a submit event', () => {
    const form = render('<form><button type="submit">Go</button></form>');
    const onSubmit = vi.fn();
    form.addEventListener('submit', onSubmit);

    click('button');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('treats a button with no type as a submit button', () => {
    const form = render('<form><button>Go</button></form>');
    const onSubmit = vi.fn();
    form.addEventListener('submit', onSubmit);

    click('button');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('fires from a click on something inside the button', () => {
    const form = render('<form><button type="submit"><span id="icon">Go</span></button></form>');
    const onSubmit = vi.fn();
    form.addEventListener('submit', onSubmit);

    click('#icon');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('dispatches a cancelable, bubbling submit event', () => {
    const form = render('<form><button type="submit">Go</button></form>');
    let received;
    form.addEventListener('submit', (e) => { received = e; });

    click('button');
    expect(received.bubbles).toBe(true);
    expect(received.cancelable).toBe(true);
  });

  it('cancels the click so a working host does not submit as well', () => {
    render('<form><button type="submit">Go</button></form>');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    document.querySelector('button').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves the button click event itself intact', () => {
    render('<form><button type="submit">Go</button></form>');
    const onClick = vi.fn();
    document.querySelector('button').addEventListener('click', onClick);

    click('button');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['type="button"', '<form><button type="button" id="t">Go</button></form>'],
    ['type="reset"', '<form><button type="reset" id="t">Go</button></form>'],
    ['a button outside any form', '<button id="t">Go</button>'],
    ['a disabled submit button', '<form><button type="submit" id="t" disabled>Go</button></form>'],
    ['a non-button element', '<form><div id="t">Go</div></form>'],
  ])('ignores %s', (_label, html) => {
    render(html);
    const onSubmit = vi.fn();
    document.addEventListener('submit', onSubmit);
    click('#t');
    document.removeEventListener('submit', onSubmit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('honours a click already cancelled upstream', () => {
    const form = render('<form><button type="submit">Go</button></form>');
    const onSubmit = vi.fn();
    form.addEventListener('submit', onSubmit);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    event.preventDefault();
    document.querySelector('button').dispatchEvent(event);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // For a real submit button jsdom runs its own activation behaviour and fires
  // a submit event too, so "did the shim act?" cannot be read off the handler.
  // Cancelling the click is the shim's observable signature; these assert on
  // that instead.
  it('ignores a middle or right click', () => {
    quietNativeSubmit(render('<form><button type="submit">Go</button></form>'));
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 });
    document.querySelector('button').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('follows the form attribute out of the form subtree', () => {
    document.body.innerHTML = '<form id="f"></form><button type="submit" form="f">Go</button>';
    const onSubmit = vi.fn();
    document.getElementById('f').addEventListener('submit', onSubmit);

    click('button');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('stops acting once removed', () => {
    quietNativeSubmit(render('<form><button type="submit">Go</button></form>'));
    uninstall();

    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    document.querySelector('button').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
