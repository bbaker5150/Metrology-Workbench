import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
const ELEVATED_SURFACE_CLASS = "guided-walkthrough-elevated-surface";

const visibleTarget = (selector) => {
  if (!selector) return null;
  return (
    Array.from(document.querySelectorAll(selector)).find((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    }) || null
  );
};

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

const createsStackingContext = (style) => {
  const opacity = Number.parseFloat(style.opacity);
  return (
    (style.position !== "static" && style.zIndex !== "auto") ||
    Boolean(style.transform && style.transform !== "none") ||
    Boolean(style.filter && style.filter !== "none") ||
    Boolean(style.perspective && style.perspective !== "none") ||
    style.isolation === "isolate" ||
    (Number.isFinite(opacity) && opacity < 1)
  );
};

const elevateRevealedSurface = (surface, elevatedElements) => {
  let element = surface;
  while (element && element !== document.body) {
    const style = window.getComputedStyle(element);
    if (element === surface || createsStackingContext(style)) {
      element.classList.add(ELEVATED_SURFACE_CLASS);
      elevatedElements.add(element);
    }
    element = element.parentElement;
  }
};

export const getWalkthroughCardPosition = (
  targetRect,
  viewport = { width: window.innerWidth, height: window.innerHeight },
  cardHeight = 260,
) => {
  const width = Math.min(CARD_WIDTH, viewport.width - VIEWPORT_GAP * 2);
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
}) => {
  const step = steps[stepIndex];
  const cardRef = useRef(null);
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

  useLayoutEffect(() => {
    if (!isOpen || !step) return undefined;

    let frame = null;
    const elevatedElements = new Set();
    const clearElevatedSurfaces = () => {
      elevatedElements.forEach((element) =>
        element.classList.remove(ELEVATED_SURFACE_CLASS),
      );
      elevatedElements.clear();
    };
    const update = () => {
      const target = visibleTarget(step.target);
      const revealedSurface = visibleTarget(step.revealedTarget);
      clearElevatedSurfaces();
      if (revealedSurface) {
        elevateRevealedSurface(revealedSurface, elevatedElements);
      }
      setHasTarget(Boolean(target));
      setTargetRect(
        combineRects(
          target ? target.getBoundingClientRect() : null,
          revealedSurface ? revealedSurface.getBoundingClientRect() : null,
        ),
      );
    };
    const queueUpdate = () => {
      if (frame != null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };

    const target = visibleTarget(step.target);
    if (target) {
      const rect = target.getBoundingClientRect();
      if (rect.top < 8 || rect.bottom > window.innerHeight - 8) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    queueUpdate();

    const observer = new MutationObserver(queueUpdate);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", queueUpdate);
    window.addEventListener("scroll", queueUpdate, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", queueUpdate);
      window.removeEventListener("scroll", queueUpdate, true);
      if (frame != null) window.cancelAnimationFrame(frame);
      clearElevatedSurfaces();
    };
  }, [isOpen, step]);

  useEffect(() => {
    if (!isOpen || !step?.advanceOnTargetClick || !step.target)
      return undefined;
    const handleTargetClick = (event) => {
      if (!event.target?.closest?.(step.target)) return;
      window.setTimeout(
        () => onStepChange(Math.min(stepIndex + 1, steps.length - 1)),
        180,
      );
    };
    document.addEventListener("click", handleTargetClick, true);
    return () => document.removeEventListener("click", handleTargetClick, true);
  }, [isOpen, onStepChange, step, stepIndex, steps.length]);

  const cardPosition = useMemo(
    () => getWalkthroughCardPosition(targetRect, undefined, cardHeight),
    [targetRect, cardHeight],
  );

  if (!isOpen || !step) return null;

  const workflowSteps = steps.filter((item) => item.workflow === step.workflow);
  const workflowIndex = workflowSteps.indexOf(step);
  const workflows = [
    ...new Set(steps.map((item) => item.workflow || "Walkthrough")),
  ];
  const isLast = stepIndex === steps.length - 1;
  const endsWorkflow = steps[stepIndex + 1]?.workflow !== step.workflow;
  const canAdvance = step.canAdvance !== false;

  return (
    <div className="guided-walkthrough-layer" aria-live="polite">
      {hasTarget && targetRect && (
        <div
          className="guided-walkthrough-highlight"
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
            onClick={onClose}
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
                onStepChange(
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
              onChange={(event) => onStepChange(Number(event.target.value))}
            >
              {steps.map((item, index) =>
                item.workflow === step.workflow ? (
                  <option key={item.id} value={index}>
                    {index + 1}. {item.title}
                  </option>
                ) : null,
              )}
            </select>
          </label>
        </div>
        <h3>{step.title}</h3>
        <p>{step.description}</p>
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
            onClick={() => onStepChange(Math.max(0, stepIndex - 1))}
            disabled={stepIndex === 0}
          >
            <FontAwesomeIcon icon={faArrowLeft} /> Back
          </button>
          {isLast ? (
            <button
              type="button"
              className="guided-walkthrough-primary"
              onClick={onClose}
            >
              <FontAwesomeIcon icon={faCheck} /> Finish
            </button>
          ) : (
            <button
              type="button"
              className="guided-walkthrough-primary"
              onClick={() => onStepChange(stepIndex + 1)}
              disabled={!canAdvance}
            >
              {step.nextLabel || (endsWorkflow ? "Next workflow" : "Next")}{" "}
              <FontAwesomeIcon icon={faArrowRight} />
            </button>
          )}
        </div>
      </section>
    </div>
  );
};

export default GuidedWalkthrough;
