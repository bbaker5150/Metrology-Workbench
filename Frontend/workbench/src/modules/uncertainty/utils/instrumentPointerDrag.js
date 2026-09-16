import { isTableDragBlockedTarget } from './tableTextSelection';

/** Instrument transfers stay in this document. In particular, no native
 * DataTransfer is created and no instrument JSON is handed to the OS drag
 * service when the pointer leaves a table/window. Existing React drop handlers
 * receive in-memory events so membership, multi-selection and save semantics
 * remain centralized. A network policy cause cannot be inferred from a local
 * trace; this removes the native transfer boundary implicated by the report.
 */
export function attachInstrumentPointerDrag(table) {
  const doc = table.ownerDocument, win = doc.defaultView;
  let gesture = null, suppressClick = false, clickTimer = null;
  const emit = (target, type, point, dataTransfer) => {
    const event = new win.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { clientX: point.clientX, clientY: point.clientY,
      dataTransfer, workbenchPointerDrag: true });
    target.dispatchEvent(event);
    return event;
  };
  const nativeStart = event => {
    if (!event.workbenchPointerDrag) { event.preventDefault(); event.stopPropagation(); }
  };
  const clear = () => {
    const current = gesture;
    gesture = null;
    if (!current) return;
    if (current.row.hasPointerCapture?.(current.pointerId)) current.row.releasePointerCapture(current.pointerId);
    win.cancelAnimationFrame(current.frame);
    current.preview?.remove();
    if (current.started) {
      doc.body.style.cursor = current.cursor;
      doc.body.style.userSelect = current.userSelect;
      emit(current.row, 'dragend', current.last, current.transfer);
      // A successful move can unmount the original row before dragend bubbles.
      win.dispatchEvent(new win.Event('dragend'));
      suppressClick = true;
      win.clearTimeout(clickTimer);
      clickTimer = win.setTimeout(() => { suppressClick = false; }, 0);
    }
  };
  const down = event => {
    if (event.button !== 0 || event.pointerType === 'touch' || isTableDragBlockedTarget(event.target)) return;
    const row = event.target.closest('tr.instrument-function-row');
    if (!row || row.closest('table') !== table) return;
    clear();
    const values = new Map();
    gesture = { row, target: event.target, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, last: event, frame: null, started: false,
      transfer: { effectAllowed: 'move', dropEffect: 'none',
        setData: (type, value) => values.set(type, value),
        getData: type => values.get(type) || '' } };
  };
  const paint = () => {
    const current = gesture;
    if (!current?.started) return;
    current.frame = null;
    const point = current.last;
    current.preview.style.transform = `translate(${point.clientX + 14}px, ${point.clientY + 14}px)`;
    const target = doc.elementFromPoint?.(point.clientX, point.clientY);
    if (target !== current.over) {
      if (current.over) emit(current.over, 'dragleave', point, current.transfer);
      current.over = target;
    }
    // Leaving all instrument tables is a safe non-drop state. Never hand off
    // to browser navigation, the desktop, or another application's drop target.
    if (target?.closest('.instrument-equipment-table')) {
      emit(target, 'dragover', point, current.transfer);
      const scroller = target.closest('.instrument-panel-table-container');
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        const delta = point.clientY < bounds.top + 28 ? -12 : point.clientY > bounds.bottom - 28 ? 12 : 0;
        if (delta && scroller.scrollHeight > scroller.clientHeight) {
          const previousTop = scroller.scrollTop;
          scroller.scrollTop += delta;
          if (scroller.scrollTop !== previousTop) current.frame = win.requestAnimationFrame(paint);
        }
      }
    }
  };
  const move = event => {
    const current = gesture;
    if (!current || event.pointerId !== current.pointerId) return;
    current.last = event;
    if (!current.started) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
      emit(current.target, 'dragstart', event, current.transfer);
      if (!current.transfer.getData('application/x-workbench-instruments')) { clear(); return; }
      current.started = true;
      // Capture release even outside the table; OS cancellation/blur still
      // aborts without committing. No release can leave listeners latched.
      current.row.setPointerCapture?.(current.pointerId);
      current.cursor = doc.body.style.cursor; current.userSelect = doc.body.style.userSelect;
      doc.body.style.cursor = 'grabbing'; doc.body.style.userSelect = 'none';
      doc.getSelection()?.removeAllRanges();
      current.preview = doc.createElement('div');
      current.preview.className = 'instrument-pointer-drag-preview';
      const payload = JSON.parse(current.transfer.getData('application/x-workbench-instruments'));
      current.preview.textContent = payload.items.length > 1 ? `${payload.items.length} instruments` : 'Move instrument';
      doc.body.append(current.preview);
    }
    event.preventDefault();
    if (current.frame === null) current.frame = win.requestAnimationFrame(paint);
  };
  const up = event => {
    const current = gesture;
    if (!current || event.pointerId !== current.pointerId) return;
    try {
      const target = current.started ? doc.elementFromPoint?.(event.clientX, event.clientY) : null;
      if (current.started && target?.closest('.instrument-equipment-table')) emit(target, 'drop', event, current.transfer);
    } finally { clear(); }
  };
  const cancel = () => clear();
  const key = event => { if (event.key === 'Escape') clear(); };
  const click = event => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  table.addEventListener('pointerdown', down);
  table.addEventListener('dragstart', nativeStart, true);
  table.addEventListener('lostpointercapture', cancel);
  win.addEventListener('pointerdown', cancel, true);
  win.addEventListener('pointermove', move, { passive: false });
  win.addEventListener('pointerup', up);
  win.addEventListener('pointercancel', cancel);
  win.addEventListener('blur', cancel);
  win.addEventListener('keydown', key);
  win.addEventListener('click', click, true);
  return () => {
    clear(); win.clearTimeout(clickTimer);
    table.removeEventListener('pointerdown', down);
    table.removeEventListener('dragstart', nativeStart, true);
    table.removeEventListener('lostpointercapture', cancel);
    win.removeEventListener('pointerdown', cancel, true);
    win.removeEventListener('pointermove', move);
    win.removeEventListener('pointerup', up);
    win.removeEventListener('pointercancel', cancel);
    win.removeEventListener('blur', cancel);
    win.removeEventListener('keydown', key);
    win.removeEventListener('click', click, true);
  };
}
