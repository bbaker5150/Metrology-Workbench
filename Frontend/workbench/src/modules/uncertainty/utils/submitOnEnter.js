// ---------------------------------------------------------------------------
// Enter-to-submit without a <form>.
// ---------------------------------------------------------------------------
// The tool's editing panels used to be real forms, submitted natively. They are
// plain containers now, because the SharePoint build runs inside a host that
// blocks native form submission outright — a panel that needed the browser's
// form machinery would silently do nothing there.
//
// Dropping the <form> also drops the one thing it was still earning: pressing
// Enter in a text field to commit. This puts that back explicitly, and matches
// what the browser did — Enter commits from a single-line input, and only from
// a single-line input, so a textarea still takes newlines and a button still
// answers to Enter as a button press.

/**
 * Build a keydown handler that runs `submit` when Enter is pressed in a
 * single-line text field.
 *
 * @param {(event: KeyboardEvent) => void} submit Called with the keydown event,
 *   which carries `preventDefault`, so the same handler serves a click.
 */
export default function submitOnEnter(submit) {
  return (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    // Mid-composition Enter is the IME choosing a candidate, not a commit.
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return;

    const target = event.target;
    if (!target || target.tagName !== 'INPUT') return;
    // A checkbox, radio, or button ignored Enter inside a form too.
    const type = (target.type || 'text').toLowerCase();
    if (['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(type)) return;

    event.preventDefault();
    submit(event);
  };
}
