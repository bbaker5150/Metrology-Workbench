import { useLayoutEffect, useRef } from "react";
const EVENT = "uncertalytics:menu-open";
/** Portaled selectors do not share a DOM parent. Claim menu ownership on open
 * so keyboard/auto-open paths obey the same exclusivity as pointer clicks. */
export default function useExclusiveMenu(open, close) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useLayoutEffect(() => {
    if (!open) return undefined;
    window.dispatchEvent(new Event(EVENT));
    const dismiss = () => closeRef.current?.();
    window.addEventListener(EVENT, dismiss);
    return () => window.removeEventListener(EVENT, dismiss);
  }, [open]);
}
