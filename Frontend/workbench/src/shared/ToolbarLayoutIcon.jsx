import React from "react";

export default function ToolbarLayoutIcon({ reorder = false }) {
  return <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {reorder ? <><rect x="3" y="3" width="18" height="18" rx="1.5" /><path d="M9 3v18M15 3v18" /></> : <><rect x="3" y="3" width="18" height="15" rx="1.5" /><path d="M9 21h6M12 18v3M7 8h10m-3-3 3 3-3 3M17 13H7m3-3-3 3 3 3" /></>}
  </svg>;
}
