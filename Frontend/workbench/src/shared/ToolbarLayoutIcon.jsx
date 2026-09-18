import React from "react";

export default function ToolbarLayoutIcon({ reorder = false }) {
  // Scaling paths: Lucide scaling, ISC license (Lucide contributors).
  return <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={reorder ? 1.8 : 2.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {reorder ? <><rect x="3" y="3" width="18" height="18" rx="1.5" /><path d="M9 3v18M15 3v18" /></> : <><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M14 15H9v-5M16 3h5v5M21 3 9 15" /></>}
  </svg>;
}
