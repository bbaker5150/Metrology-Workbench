import React, { useState, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrashAlt, faLink, faLinkSlash } from "@fortawesome/free-solid-svg-icons";
import { getToleranceSummary, errorDistributions } from "../../../../utils/uncertaintyMath";
import TolerancePopover from "./TolerancePopover";
import InlineMenuSelect from "../../../../components/common/InlineMenuSelect";

// reading/range/floor share ONE "spec band" distribution (mirrors ToleranceForm).
// dB / manual / resolution keep their own and are edited only in the popover.
const BAND_KEYS = ["reading", "readings_iv", "range", "floor"];

const getBandDistribution = (tol = {}) => {
  const key = BAND_KEYS.find((k) => tol[k]);
  if (key) return tol[key].distribution || "1.732";
  return tol.bandDistribution || "1.732";
};

/**
 * One inline-editable UUT/TMDE row. Controlled: `item` is the instrument,
 * `onChange(updaterFn)` receives the previous item and returns the next one
 * (so it composes with ToleranceForm's functional setTolerance).
 *
 * Persistence (debounced local-library upsert, sync prompts) lives in the
 * parent — this component is presentation + edit affordances only.
 */
const InstrumentRow = ({
  item,
  role = "uut", // 'uut' | 'tmde'
  areaColor,
  referencePoint,
  libraryResults = [],
  onSearch,
  onPickLibrary,
  onChange,
  onDelete,
  onSyncClick,
}) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [tolAnchor, setTolAnchor] = useState(null);
  const tolCellRef = useRef(null);

  const patch = (p) => onChange((prev) => ({ ...prev, ...p }));

  const setTolerance = (updater) =>
    onChange((prev) => ({
      ...prev,
      tolerance:
        typeof updater === "function" ? updater(prev.tolerance || {}) : updater,
    }));

  const handleDescChange = (field, value) => {
    patch({ [field]: value });
    if (field === "manufacturer" || field === "model" || field === "name") {
      onSearch?.(`${field === "manufacturer" ? value : item.manufacturer || ""} ${
        field === "model" ? value : item.model || ""
      }`.trim());
      setSearchOpen(true);
      setActiveIdx(-1);
    }
  };

  const setBandDistribution = (value) =>
    onChange((prev) => {
      const tol = { ...(prev.tolerance || {}) };
      let touched = false;
      BAND_KEYS.forEach((k) => {
        if (tol[k]) {
          tol[k] = { ...tol[k], distribution: value };
          touched = true;
        }
      });
      if (!touched) tol.bandDistribution = value;
      return { ...prev, tolerance: tol };
    });

  const pickLibrary = (inst) => {
    setSearchOpen(false);
    onPickLibrary?.(inst);
  };

  const syncIcon = () => {
    const state = item.syncState || "none";
    if (state === "none") return null;
    return (
      <button
        className={`inline-sync-btn ${state === "green" ? "inline-sync-green" : "inline-sync-red"}`}
        title={state === "green" ? "Synced with shared library" : "Sync local changes to shared library"}
        onClick={() => onSyncClick?.(item)}
      >
        <FontAwesomeIcon icon={state === "green" ? faLink : faLinkSlash} />
      </button>
    );
  };

  const tolSummary = getToleranceSummary(item.tolerance);

  return (
    <tr className="inline-instr-row" style={{ "--row-area-color": areaColor || "transparent" }}>
      {/* Description: make / model / name */}
      <td>
        <div className="inline-desc-cell">
          <input
            className="inline-desc-make"
            placeholder="Mfr."
            value={item.manufacturer || ""}
            onChange={(e) => handleDescChange("manufacturer", e.target.value)}
            onFocus={() => item.manufacturer && setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
          />
          <input
            className="inline-desc-model"
            placeholder="Model"
            value={item.model || ""}
            onChange={(e) => handleDescChange("model", e.target.value)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
          />
          <input
            className="inline-desc-name"
            placeholder="Name"
            value={item.name || ""}
            onChange={(e) => handleDescChange("name", e.target.value)}
          />

          {searchOpen && (libraryResults.length > 0 || onSearch) && (
            <div className="inline-search-dropdown">
              {libraryResults.length === 0 ? (
                <div className="inline-search-empty">No library matches — finish typing to create new</div>
              ) : (
                libraryResults.map((r, i) => (
                  <div
                    key={r.id || i}
                    className={`inline-search-item ${i === activeIdx ? "active" : ""}`}
                    onMouseDown={() => pickLibrary(r)}
                  >
                    <span className="si-main">
                      {[r.manufacturer, r.model].filter(Boolean).join(" ")}
                    </span>
                    <span className="si-sub">
                      {r.scope === "validated" ? "shared" : "local"}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </td>

      {/* Asset ID */}
      <td>
        <input
          className="inline-cell-input"
          placeholder="Asset ID"
          value={item.assetId || ""}
          onChange={(e) => patch({ assetId: e.target.value })}
        />
      </td>

      {/* Tolerance — opens popover */}
      <td>
        <span
          ref={tolCellRef}
          className="inline-tol-cell"
          onClick={() => setTolAnchor(tolCellRef.current.getBoundingClientRect())}
          title="Edit tolerance"
        >
          {item.tolerance && Object.keys(item.tolerance).length ? (
            <span>{tolSummary}</span>
          ) : (
            <span className="inline-tol-empty" aria-hidden="true">&nbsp;</span>
          )}
        </span>
      </td>

      {/* Distribution (spec band) */}
      <td>
        <InlineMenuSelect
          value={getBandDistribution(item.tolerance)}
          options={errorDistributions}
          ariaLabel="Spec band distribution"
          title="Distribution used for this tolerance band"
          onChange={setBandDistribution}
          width="118px"
          menuWidth={240}
          className="inline-distribution-select"
        />
      </td>

      {/* Quantity */}
      <td>
        <input
          type="number"
          min="1"
          className="inline-cell-input inline-qty-input"
          value={item.quantity || 1}
          onChange={(e) => patch({ quantity: parseInt(e.target.value, 10) || 1 })}
        />
      </td>

      {/* Sync */}
      <td style={{ textAlign: "center" }}>{syncIcon()}</td>

      {/* Actions */}
      <td>
        <div className="inline-row-actions">
          <button className="inline-icon-btn danger" title="Delete" onClick={onDelete}>
            <FontAwesomeIcon icon={faTrashAlt} />
          </button>
        </div>
      </td>

      {tolAnchor && (
        <TolerancePopover
          anchorRect={tolAnchor}
          tolerance={item.tolerance}
          setTolerance={setTolerance}
          referencePoint={referencePoint}
          isUUT={role === "uut"}
          onClose={() => setTolAnchor(null)}
        />
      )}
    </tr>
  );
};

export default InstrumentRow;
