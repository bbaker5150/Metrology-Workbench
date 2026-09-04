import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";

const shouldReduceMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function AnimatedModalShell({
  isOpen,
  onClose,
  panelClassName,
  panelProps = {},
  children,
}) {
  const [isRendered, setIsRendered] = useState(isOpen);
  const overlayRef = useRef(null);
  const panelRef = useRef(null);
  const backdropPressStartedRef = useRef(false);

  useEffect(() => {
    if (isOpen) setIsRendered(true);
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isRendered) return undefined;
    const overlay = overlayRef.current;
    const panel = panelRef.current;
    if (!overlay || !panel) return undefined;

    const reduceMotion = shouldReduceMotion();
    gsap.killTweensOf([overlay, panel]);

    if (isOpen) {
      if (reduceMotion) {
        gsap.set(overlay, { autoAlpha: 1 });
        gsap.set(panel, { autoAlpha: 1, y: 0, scale: 1 });
        return undefined;
      }
      // Prime hidden/offset state before paint to avoid a one-frame flash.
      gsap.set(overlay, { autoAlpha: 0 });
      gsap.set(panel, { autoAlpha: 0, y: 14, scale: 0.985 });
      const tl = gsap.timeline();
      tl.to(overlay, { autoAlpha: 1, duration: 0.18, ease: "power1.out" }).to(
        panel,
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.24, ease: "power3.out" },
        "<+0.02"
      );
      return () => tl.kill();
    }

    if (reduceMotion) {
      setIsRendered(false);
      return undefined;
    }
    const tl = gsap.timeline({ onComplete: () => setIsRendered(false) });
    tl.to(panel, {
      autoAlpha: 0,
      y: 8,
      scale: 0.99,
      duration: 0.16,
      ease: "power2.in",
    }).to(
      overlay,
      { autoAlpha: 0, duration: 0.14, ease: "power1.in" },
      "<+0.02"
    );
    return () => tl.kill();
  }, [isOpen, isRendered]);

  if (!isRendered) return null;

  const handleBackdropPointerDown = (event) => {
    backdropPressStartedRef.current = event.target === event.currentTarget;
  };

  const handleBackdropClick = (event) => {
    const startedOnBackdrop = backdropPressStartedRef.current;
    backdropPressStartedRef.current = false;
    if (startedOnBackdrop && event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      ref={overlayRef}
      className="modal-overlay modal-overlay--animated"
      onPointerDown={handleBackdropPointerDown}
      onPointerCancel={() => {
        backdropPressStartedRef.current = false;
      }}
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        className={`${panelClassName} modal-surface-animated`}
        onClick={(e) => e.stopPropagation()}
        {...panelProps}
      >
        {children}
      </div>
    </div>
  );
}

export default AnimatedModalShell;
