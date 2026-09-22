import { useCallback, useEffect, useState } from "react";
import { readObserverTab, saveObserverTab } from "../utils/observationState";

// Persist navigation per browser tab, backend and observed session. Save at
// selection time: a discarded background page may never receive pagehide.
export function useObserverTab(sessionId, isRemoteViewer, field, hostDefault) {
  const scope = isRemoteViewer && sessionId != null ? String(sessionId) : null;
  const initialValue = () => scope ? readObserverTab(scope, field) : hostDefault;
  const [selection, setSelection] = useState(() => ({ scope, value: initialValue() }));
  const value = selection.scope === scope ? selection.value : initialValue();

  useEffect(() => {
    if (selection.scope !== scope) setSelection({ scope, value });
  }, [scope, selection.scope, value]);

  const select = useCallback(next => {
    if (scope) saveObserverTab(scope, field, next);
    setSelection({ scope, value: next });
  }, [scope, field]);
  return [value, select];
}
