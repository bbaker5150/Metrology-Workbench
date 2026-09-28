import { useLayoutEffect, useRef, useState } from "react";

// A visit owns its baseline and pending frame. Jumping or closing cancels both;
// a successful visit stays completed until this tutorial is closed.
export default function useWalkthroughAction({ isOpen, step, context, cardRef, visibleTarget, onAdvance }) {
  const latest = useRef(null);
  latest.current = { context, onAdvance };
  const completed = useRef(new Set());
  const visit = useRef(null);
  const [result, setResult] = useState(null);

  useLayoutEffect(() => {
    if (!isOpen) { completed.current.clear(); visit.current = null; return; }
    const action = step?.action;
    if (!action) { visit.current = null; return; }
    const state = { id: step.id, baseline: action.snapshot?.(latest.current.context), evidence: false, ready: completed.current.has(step.id), initial: true };
    visit.current = state;
    let frame;
    const evaluate = () => {
      if (visit.current !== state) return;
      const wasReady = state.ready;
      const ui = { visible: selector => !!visibleTarget(selector), find: visibleTarget, evidence: state.evidence };
      state.ready = state.ready || !!action.complete(latest.current.context, state.baseline, ui);
      if (state.ready) completed.current.add(step.id);
      setResult(previous => previous?.id === step.id && previous.ready === state.ready ? previous : { id: step.id, ready: state.ready });
      if (!state.initial && !wasReady && state.ready && action.autoAdvance) latest.current.onAdvance();
      state.initial = false;
    };
    state.evaluate = evaluate;
    const queue = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(evaluate);
    };
    const allowed = target => target instanceof Element && (cardRef.current?.contains(target) || target.closest(action.allowed));
    const guard = event => {
      // Native select/button navigation still works, but tutorial keystrokes
      // must not reach the workspace's document-level editing shortcuts.
      if (event.type === "keydown" && event.target instanceof Node && cardRef.current?.contains(event.target)) {
        event.stopImmediatePropagation();
        return;
      }
      if (event.type === "keydown" && event.key === "Escape") return;
      if (!state.ready && !allowed(event.target)) {
        // Scrolling and browser shortcuts remain available. Focus is redirected
        // independently, so Tab cannot activate unrelated application controls.
        if (event.type === "keydown" && (event.ctrlKey || event.metaKey || event.key === "Tab")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (action.acceptEvent?.(event)) state.evidence = true;
      queue();
    };
    const focus = event => {
      if (!state.ready && !allowed(event.target)) cardRef.current?.querySelector('button')?.focus();
    };
    const events = ["pointerdown", "mousedown", "click", "dblclick", "contextmenu", "keydown", "input", "change"];
    events.forEach(name => window.addEventListener(name, guard, true));
    window.addEventListener("focusin", focus, true);
    const observer = new MutationObserver(records => {
      if (records.some(record => !record.target.closest?.('.guided-walkthrough-layer'))) queue();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    evaluate();
    return () => {
      visit.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      events.forEach(name => window.removeEventListener(name, guard, true));
      window.removeEventListener("focusin", focus, true);
    };
  }, [isOpen, step?.id]);

  useLayoutEffect(() => { visit.current?.evaluate(); }, [context]);
  return !step?.action || (result?.id === step.id && result.ready);
}
