import ToolbarLayoutIcon from "./ToolbarLayoutIcon";
import React, { useEffect, useRef, useState } from "react";
import { faCheck, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

export const UI_SCALE_LOCK_KEY = "workbench:ui-scale-lock";
export const UI_FIT_WINDOW_EVENT = "workbench:fit-window";
export const isUiScaleLocked = () => {
  try { return localStorage.getItem(UI_SCALE_LOCK_KEY) !== "false"; }
  catch { return true; }
};

export default function UiSettings() {
  const [locked, setLocked] = useState(isUiScaleLocked);
  const menuRef = useRef(null);
  const changeMode = nextLocked => {
    setLocked(nextLocked);
    try { localStorage.setItem(UI_SCALE_LOCK_KEY, String(nextLocked)); } catch { /* Keep the menu usable without storage. */ }
  };
  useEffect(() => {
    const dismiss = event => {
      const menu = menuRef.current;
      if (menu && !menu.contains(event.target)) menu.open = false;
    };
    const onKey = event => {
      if (event.key !== "Escape" || !menuRef.current?.open) return;
      event.stopPropagation();
      menuRef.current.open = false;
      menuRef.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return <details className="ui-settings" ref={menuRef}>
    <summary className="app-chrome-meta-icon" title="UI scaling" aria-label="UI Settings">
      <ToolbarLayoutIcon />
    </summary>
    <div className="ui-settings-menu" role="group" aria-label="UI scaling">
      <div className="ui-scaling-heading"><strong>UI scaling</strong><span>Ctrl + scroll</span></div>
      <div className="ui-scaling-modes" role="radiogroup" aria-label="Scale scope">
        {[{ value: true, label: "Whole app" }, { value: false, label: "Individual sections" }].map(mode => (
          <button key={String(mode.value)} type="button" role="radio" aria-checked={locked === mode.value}
            className={`ui-scaling-mode${locked === mode.value ? " is-selected" : ""}`}
            onClick={() => changeMode(mode.value)}>
            <span>{mode.label}</span>
            {locked === mode.value && <FontAwesomeIcon icon={faCheck} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div className="ui-scaling-reset-row">
        <button type="button" className="ui-scaling-reset" title="Fit the app to the available window while respecting your display scaling"
          onClick={() => window.dispatchEvent(new Event(UI_FIT_WINDOW_EVENT))}>
          <ToolbarLayoutIcon /><span>Fit to window</span>
        </button>
        <button type="button" className="ui-scaling-reset" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "0", ctrlKey: true, bubbles: true }))}>
          <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" /><span>Reset to 100%</span>
        </button>
      </div>
    </div>
  </details>;
}
