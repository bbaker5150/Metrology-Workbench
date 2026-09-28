import useWalkthroughAction from "./useWalkthroughAction";
import React, {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faArrowRight,
  faCheck,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";

const CARD_WIDTH = 360;
const VIEWPORT_GAP = 12;
const TARGET_GAP = 14;

const visibleTargets = (selector) => {
  if (!selector) return [];
  return (
    Array.from(document.querySelectorAll(selector)).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    })
  );
};

const visibleTarget = selector => visibleTargets(selector)[0] || null;

const combineRects = (...rects) => {
  const visibleRects = rects.filter(Boolean);
  if (visibleRects.length === 0) return null;
  const top = Math.min(...visibleRects.map((rect) => rect.top));
  const right = Math.max(...visibleRects.map((rect) => rect.right));
  const bottom = Math.max(...visibleRects.map((rect) => rect.bottom));
  const left = Math.min(...visibleRects.map((rect) => rect.left));
  return {
    top,
    right,
    bottom,
    left,
    width: right - left,
    height: bottom - top,
  };
};

export const getWalkthroughCardPosition = (
  targetRect,
  viewport = { width: window.innerWidth, height: window.innerHeight },
  cardHeight = 260,
) => {
  let width = Math.min(CARD_WIDTH, viewport.width - VIEWPORT_GAP * 2);
  // Fit beside an editable region before overlapping it in a narrow window.
  if (targetRect) {
    const sideSpace = Math.max(targetRect.left, viewport.width - targetRect.right) - TARGET_GAP - VIEWPORT_GAP;
    if (sideSpace >= 280) width = Math.min(width, sideSpace);
  }
  if (!targetRect) {
    return {
      width,
      left: Math.max(VIEWPORT_GAP, (viewport.width - width) / 2),
      top: Math.max(VIEWPORT_GAP, (viewport.height - cardHeight) / 2),
    };
  }

  const estimatedHeight = Math.min(
    cardHeight,
    viewport.height - VIEWPORT_GAP * 2,
  );
  const roomRight = viewport.width - targetRect.right;
  const roomLeft = targetRect.left;
  let left;
  let top;

  if (roomRight >= width + TARGET_GAP) {
    left = targetRect.right + TARGET_GAP;
    top = targetRect.top;
  } else if (roomLeft >= width + TARGET_GAP) {
    left = targetRect.left - width - TARGET_GAP;
    top = targetRect.top;
  } else {
    left = Math.min(
      Math.max(VIEWPORT_GAP, targetRect.left),
      viewport.width - width - VIEWPORT_GAP,
    );
    top = targetRect.bottom + TARGET_GAP;
    if (top + estimatedHeight > viewport.height - VIEWPORT_GAP) {
      top = targetRect.top - estimatedHeight - TARGET_GAP;
    }
  }

  return {
    width,
    left: Math.min(
      Math.max(VIEWPORT_GAP, left),
      viewport.width - width - VIEWPORT_GAP,
    ),
    top: Math.min(
      Math.max(VIEWPORT_GAP, top),
      viewport.height - estimatedHeight - VIEWPORT_GAP,
    ),
  };
};

const GuidedWalkthrough = ({
  isOpen,
  steps,
  stepIndex,
  onStepChange,
  onClose,
  actionContext = {},
}) => {
  const step = steps[stepIndex];
  const cardRef = useRef(null);
  const layerRef = useRef(null);
  const leaveStep = () => {
    if (step?.dismissOnLeave) document.querySelector(step.dismissOnLeave)?.click();
  };
  const changeStep = index => { leaveStep(); onStepChange(index); };
  const close = () => { leaveStep(); onClose(); };
  useLayoutEffect(() => {
    if (!isOpen || !layerRef.current) return;
    const layer = layerRef.current;
    layer.showPopover?.();
    // Menus now use the browser top layer. Keep tutorial navigation above a
    // newly opened menu without raising or changing application containers.
    const keepAboveMenu = event => {
      if (event.target === layer || event.newState !== "open") return;
      layer.hidePopover?.();
      layer.showPopover?.();
    };
    document.addEventListener("toggle", keepAboveMenu, true);
    return () => {
      document.removeEventListener("toggle", keepAboveMenu, true);
      layer.hidePopover?.();
    };
  }, [isOpen]);
  const [cardHeight, setCardHeight] = useState(360);
  useLayoutEffect(() => {
    if (!isOpen || !cardRef.current) return;
    const update = () =>
      setCardHeight(cardRef.current?.getBoundingClientRect().height || 360);
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(cardRef.current);
    return () => observer?.disconnect();
  }, [isOpen, step]);
  const [targetRect, setTargetRect] = useState(null);
  const [hasTarget, setHasTarget] = useState(false);
  const [placementRect, setPlacementRect] = useState(null);

  useLayoutEffect(() => {
    if (!isOpen || !step) return undefined;

    let frame = null;
    let scrolledTarget = null;
    let observed = [];
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => queueUpdate());
    const update = () => {
      // DOM rectangles already include app/section zoom. Cancel only the
      // tutorial portal's inherited CSS zoom to keep these coordinates exact.
      let ancestorZoom = 1;
      for (let node = layerRef.current?.parentElement; node; node = node.parentElement) {
        const zoom = getComputedStyle(node).zoom || "1";
        ancestorZoom *= (parseFloat(zoom) || 1) / (zoom.endsWith("%") ? 100 : 1);
      }
      if (layerRef.current) layerRef.current.style.zoom = String(1 / ancestorZoom);
      const target = visibleTarget(step.target);
      const revealed = visibleTargets(step.revealedTarget);
      const revealedSurface = revealed[0];
      const nodes = [target, ...revealed].filter(Boolean);
      if (nodes.length !== observed.length || nodes.some((node, index) => node !== observed[index])) {
        resizeObserver?.disconnect();
        nodes.forEach(node => resizeObserver?.observe(node));
        observed = nodes;
      }
      if (target && target !== scrolledTarget) {
        scrolledTarget = target;
        const rect = target.getBoundingClientRect();
        if (rect.top < 8 || rect.bottom > window.innerHeight - 8) target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setHasTarget(Boolean(target || revealedSurface));
      setPlacementRect((revealedSurface || target)?.getBoundingClientRect() || null);
      setTargetRect(
        combineRects(
          target ? target.getBoundingClientRect() : null,
          ...revealed.map(node => node.getBoundingClientRect()),
        ),
      );
    };
    const queueUpdate = () => {
      if (frame != null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };

    update();

    const observer = new MutationObserver(records => {
      if (records.some(record => !layerRef.current?.contains(record.target))) queueUpdate();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden", "open"] });
    window.addEventListener("resize", queueUpdate);
    window.addEventListener("scroll", queueUpdate, true);

    return () => {
      observer.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", queueUpdate);
      window.removeEventListener("scroll", queueUpdate, true);
      if (frame != null) window.cancelAnimationFrame(frame);
    };
  }, [isOpen, step]);

  const { complete: actionComplete, advancing } = useWalkthroughAction({
    isOpen, step, context: actionContext, cardRef, visibleTarget,
    onAdvance: () => stepIndex === steps.length - 1 ? close() : changeStep(stepIndex + 1),
  });

  const cardPosition = useMemo(
    () => getWalkthroughCardPosition(placementRect, undefined, cardHeight),
    [placementRect, cardHeight],
  );

  if (!isOpen || !step) return null;

  const workflowSteps = steps.filter((item) => item.workflow === step.workflow);
  const workflowIndex = workflowSteps.indexOf(step);
  const workflows = [
    ...new Set(steps.map((item) => item.workflow || "Walkthrough")),
  ];
  const isLast = stepIndex === steps.length - 1;
  const endsWorkflow = steps[stepIndex + 1]?.workflow !== step.workflow;
  const canAdvance = step.canAdvance !== false && (actionComplete || !!visibleTarget(step.continueTarget));

  return createPortal(
    <div ref={layerRef} popover="manual" className="guided-walkthrough-layer" aria-live="polite">
      {hasTarget && targetRect && (
        <div
          className={`guided-walkthrough-highlight${advancing ? " is-action-complete" : ""}`}
          aria-hidden="true"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
          }}
        />
      )}
      {!hasTarget && (
        <div className="guided-walkthrough-dim" aria-hidden="true" />
      )}
      <section
        ref={cardRef}
        className="guided-walkthrough-card"
        role="dialog"
        aria-modal="false"
        aria-label="Uncertalytics walkthrough"
        style={cardPosition}
      >
        <div className="guided-walkthrough-card-header">
          <span>
            {step.workflow || "Walkthrough"} · {workflowIndex + 1} of{" "}
            {workflowSteps.length}
          </span>
          <button
            type="button"
            onClick={close}
            title="Close walkthrough"
            aria-label="Close walkthrough"
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>
        <div className="guided-walkthrough-navigation">
          <label>
            Workflow
            <select
              aria-label="Walkthrough workflow"
              value={step.workflow || "Walkthrough"}
              onChange={(event) =>
                changeStep(
                  steps.findIndex(
                    (item) =>
                      (item.workflow || "Walkthrough") === event.target.value,
                  ),
                )
              }
            >
              {workflows.map((workflow) => (
                <option key={workflow}>{workflow}</option>
              ))}
            </select>
          </label>
          <label>
            Jump to step
            <select
              aria-label="Walkthrough step"
              value={stepIndex}
              onChange={(event) => changeStep(Number(event.target.value))}
            >
              {steps.map((item, index) =>
                item.workflow === step.workflow ? (
                  <option key={item.id} value={index}>
                    {workflowSteps.indexOf(item) + 1}. {item.title}
                  </option>
                ) : null,
              )}
            </select>
          </label>
        </div>
        <h3>{step.title}</h3>
        <p>{step.description}</p>
        {step.action && !actionComplete && (
          <div className="guided-walkthrough-hint" role="status" data-action-complete={actionComplete}>
            {`To continue: ${step.action.label}`}
          </div>
        )}
        {!hasTarget && step.target && (
          <div className="guided-walkthrough-waiting">
            {step.prerequisite ||
              "Complete the preceding setup and this control will be highlighted when it appears. You can also jump to another workflow."}
          </div>
        )}
        {step.hint && (
          <div className="guided-walkthrough-hint">{step.hint}</div>
        )}
        <div className="guided-walkthrough-progress" aria-hidden="true">
          {workflowSteps.map((item, index) => (
            <span
              key={item.id}
              className={index <= workflowIndex ? "is-complete" : ""}
            />
          ))}
        </div>
        <div className="guided-walkthrough-actions">
          <button
            type="button"
            className="guided-walkthrough-secondary"
            onClick={() => changeStep(Math.max(0, stepIndex - 1))}
            disabled={stepIndex === 0}
          >
            <FontAwesomeIcon icon={faArrowLeft} /> Back
          </button>
          <button type="button" className="guided-walkthrough-secondary guided-walkthrough-skip" onClick={() => isLast ? close() : changeStep(stepIndex + 1)}>Skip</button>
          {isLast ? (
            <button
              type="button"
              className="guided-walkthrough-primary"
              onClick={close}
              disabled={!canAdvance}
            >
              <FontAwesomeIcon icon={faCheck} /> Finish
            </button>
          ) : (
            <button
              type="button"
              className="guided-walkthrough-primary"
              onClick={() => canAdvance && changeStep(stepIndex + 1)}
              disabled={!canAdvance}
            >
              {step.nextLabel || (endsWorkflow ? "Next workflow" : "Next")}{" "}
              <FontAwesomeIcon icon={faArrowRight} />
            </button>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
};

export default GuidedWalkthrough;
