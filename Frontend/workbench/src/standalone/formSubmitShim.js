// ---------------------------------------------------------------------------
// Make submit buttons work in a host that blocks native form submission.
// ---------------------------------------------------------------------------
// Firepit, the sanitiser in front of the Forge-hosted app, blocks native form
// submission. Our own panels do not need it — they are not forms — but the
// bundle also carries third-party UI that is, notably the docx editor's
// hyperlink dialog in the session notes workspace. Forking a dependency to
// change two attributes is not worth it, and its failure mode is the bad kind:
// the button clicks, nothing happens, no error.
//
// The gap is narrow. React does not listen on the button, it listens for a
// `submit` event at the root — so the only missing link is the browser turning
// a click into that event. Dispatching it directly is not a form submission at
// all: no navigation, no request, nothing for the host to block. The click's
// default action is cancelled first, so where native submission *does* work the
// handler still runs exactly once.

/**
 * @param {Document} doc
 * @returns {() => void} removes the listener
 */
export default function installFormSubmitShim(doc = document) {
  const onClick = (event) => {
    if (event.defaultPrevented || event.button !== 0) return;

    const target = event.target;
    const control = target instanceof Element ? target.closest('button, input') : null;
    if (!control || control.disabled) return;

    // An unqualified <button> inside a form is a submit button; this is exactly
    // the implicit case Firepit warns about.
    const type = (control.getAttribute('type') || (control.tagName === 'BUTTON' ? 'submit' : '')).toLowerCase();
    if (type !== 'submit') return;

    const form = control.form || control.closest('form');
    if (!form) return;

    event.preventDefault();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };

  // Capture, so the click is cancelled before anything downstream acts on it.
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}
