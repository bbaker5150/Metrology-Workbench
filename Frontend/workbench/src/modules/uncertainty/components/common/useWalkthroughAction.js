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
    const previouslyCompleted = completed.current.has(step.id);
    const state = { id: step.id, baseline: action.snapshot?.(latest.current.context), evidence: false, ready: completed.current.has(step.id), initial: true, seen: new Set() };
    visit.current = state;
    let frame;
    let advanceTimer;
    const completeNow = () => !!action.complete(latest.current.context, state.baseline, {
      visible: selector => !!visibleTarget(selector), find: visibleTarget, evidence: state.evidence, seen: state.seen,
    });
    const scheduleAdvance = () => {
      clearTimeout(advanceTimer);
      advanceTimer = setTimeout(() => {
        if (visit.current !== state) return;
        // Let the user finish an edit before changing its surrounding UI.
        if (action.waitForCommit && document.activeElement?.matches('input, textarea, [contenteditable="true"]') && !cardRef.current?.contains(document.activeElement)) {
          scheduleAdvance();
          return;
        }
        if (!completeNow()) {
          state.ready = false;
          completed.current.delete(step.id);
          setResult({ id: step.id, ready: false, advancing: false });
          return;
        }
        latest.current.onAdvance();
      }, 900);
    };
    const evaluate = () => {
      if (visit.current !== state) return;
      const wasReady = state.ready;
      state.ready = previouslyCompleted || completeNow();
      if (!state.ready) { clearTimeout(advanceTimer); completed.current.delete(step.id); }
      if (state.ready) completed.current.add(step.id);
      if (!state.ready) state.advancing = false;
      if (!state.initial && !wasReady && state.ready) {
        state.advancing = true;
        scheduleAdvance();
      }
      const advancing = Boolean(state.advancing);
      setResult(previous => previous?.id === step.id && previous.ready === state.ready && previous.advancing === advancing ? previous : { id: step.id, ready: state.ready, advancing });
      state.initial = false;
    };
    state.evaluate = evaluate;
    const queue = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(evaluate);
    };
    const allowed = target => target instanceof Element && (cardRef.current?.contains(target) || target.closest(`${action.allowed}, .ui-settings`));
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
      if (state.ready && advanceTimer && ["input", "change", "keydown"].includes(event.type)) {
        scheduleAdvance();
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
      clearTimeout(advanceTimer);
      observer.disconnect();
      events.forEach(name => window.removeEventListener(name, guard, true));
      window.removeEventListener("focusin", focus, true);
    };
  }, [isOpen, step?.id]);

  useLayoutEffect(() => { visit.current?.evaluate(); }, [context]);
  return {
    complete: !step?.action || (result?.id === step.id && result.ready),
    advancing: Boolean(step?.action && result?.id === step.id && result.advancing),
  };
}
