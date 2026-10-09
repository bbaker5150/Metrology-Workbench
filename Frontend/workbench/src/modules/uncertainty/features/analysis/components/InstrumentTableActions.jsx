import React, { createContext, useContext, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const ActionLayerContext = createContext(null);

export function InstrumentTableViewport({ children, enabled }) {
  const [layer, setLayer] = useState(null);
  return <ActionLayerContext.Provider value={layer}>
    <div className={`instrument-table-viewport${enabled ? ' has-instrument-actions' : ''}`}>
      {children}
      {enabled && <div ref={setLayer} className="instrument-action-layer">
        <div className="instrument-action-surfaces" aria-hidden="true" />
      </div>}
    </div>
  </ActionLayerContext.Provider>;
}

// The action belongs to an instrument/area, never to a table cell. React keeps
// its existing delete handler while the shared table layout positions it.
export function InstrumentDeleteAction({ instrumentId, measurementArea, children }) {
  const layer = useContext(ActionLayerContext);
  useLayoutEffect(() => {
    layer?.dispatchEvent(new Event('instrument-actions-change', { bubbles:true }));
  }, [layer, instrumentId, measurementArea]);
  return layer ? createPortal(
    <span className="instrument-row-action" data-instrument-id={instrumentId} data-measurement-area={measurementArea}>
      {children}
    </span>, layer) : null;
}
