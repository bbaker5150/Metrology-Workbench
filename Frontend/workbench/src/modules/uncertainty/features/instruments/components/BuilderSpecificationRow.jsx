import React, { useState } from "react";
import {
  RangeCell, InlineToleranceCell, InlineDistributionCell, ResolutionCellInput,
} from "../../analysis/components/UncertaintyPanel";

// The builder edits the same range model with the same focus/Tab/dismissal
// behavior as both instrument tables. Only persistence belongs to the modal.
export default function BuilderSpecificationRow({ range, fn, onPatch, onToleranceCommit, onDistributionChange, distribution, onDelete }) {
  const [openTolerance, setOpenTolerance] = useState(false);
  const unit = range.unit || range.functionUnit || fn.unit || fn.units?.[0] || "";
  return (
    <tr className="builder-range-row">
      <td><RangeCell
        activeRange={{ ...range, unit }} editable allowSingleToggle
        onEditBound={(key, value) => onPatch({ [key]: value })}
        onEditUnit={(value) => onPatch({ unit: value })}
        onPatchRange={onPatch}
        onOpenTolerance={() => setOpenTolerance(true)}
      /></td>
      <td><InlineToleranceCell
        tolerance={range.tolerances || {}} activeRange={{ ...range, unit }} editable
        onCommit={onToleranceCommit}
        openRequested={openTolerance} onOpenRequestHandled={() => setOpenTolerance(false)}
      /></td>
      <td><InlineDistributionCell divisor={distribution} onChange={onDistributionChange} /></td>
      <td><ResolutionCellInput
        value={range.resolution ?? range.measuringResolution ?? ""}
        unit={range.resolutionUnit || range.measuringResolutionUnit || unit}
        fallbackUnit={unit}
        distribution={range.resolutionDistribution || range.measuringResolutionDistribution || "3.464"}
        onCommit={(value) => onPatch({ resolution: value, measuringResolution: value })}
        onCommitUnit={(value) => onPatch({ resolutionUnit: value, measuringResolutionUnit: value })}
        onCommitDistribution={(value) => onPatch({ resolutionDistribution: value, measuringResolutionDistribution: value })}
      /></td>
      <td><button className="builder-x-action builder-range-delete" onClick={onDelete} title="Delete range" aria-label="Delete range">x</button></td>
    </tr>
  );
}
