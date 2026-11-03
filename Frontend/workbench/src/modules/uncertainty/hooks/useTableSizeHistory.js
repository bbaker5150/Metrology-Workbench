import { createContext, useCallback, useContext } from "react";

export const TableSizeHistoryContext = createContext(null);
export const TABLE_SIZE_RESET_EVENT = "uncert-reset-ui-sizes";
const noop = () => {};

// Record one before/after pair per gesture. Reading the persisted preference
// also lets undo reach a table after its point or tab has unmounted.
export default function useTableSizeHistory(storageKey) {
  const record = useContext(TableSizeHistoryContext);
  return useCallback(() => {
    if (!record) return noop;
    let before;
    try { before = localStorage.getItem(storageKey); } catch { return noop; }
    return () => {
      let after;
      try { after = localStorage.getItem(storageKey); } catch { return; }
      if (before === after) return;
      const restore = value => {
        if (value === null) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, value);
        window.dispatchEvent(new CustomEvent(TABLE_SIZE_RESET_EVENT, {
          detail: { key: storageKey, sizes: { [storageKey]: value } },
        }));
      };
      record(before, after, restore, Symbol(storageKey));
    };
  }, [record, storageKey]);
}
