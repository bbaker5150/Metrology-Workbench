import React, { useMemo } from "react";
import InlineMenuSelect from "./InlineMenuSelect";
import { formatRangeLabel } from "../../utils/rangeFormatting";
import { formatQualifierPath } from "../../utils/qualifierRanges";
import { getToleranceErrorSummary } from "../../utils/uncertaintyMath";
import { choosePointRange, getPointUutRanges, matchingPointRanges, samePointRange } from "../../utils/pointUutRange";

export default function PointRangeSelect({ uut, point, summary, onChange }) {
  const ranges = useMemo(() => matchingPointRanges(getPointUutRanges(uut), point.testPointInfo), [uut, point.testPointInfo]);
  if (ranges.length < 2) return summary || null;
  const selected = ranges.findIndex(range => samePointRange(range, point.uutTolerance));
  const options = ranges.map((range, index) => ({
    value: String(index),
    label: [range.functionName, formatRangeLabel(range, { preferBounds: true }), formatQualifierPath(range, uut.instrument?.qualifierColumnNames),
      getToleranceErrorSummary(range, point.testPointInfo.parameter)].filter(Boolean).join(" · "),
  }));
  return <InlineMenuSelect ariaLabel="Choose UUT range" title="Choose which UUT range applies to this point"
    menuTitle="Matching UUT ranges" width="auto" fitOptions showOptionMeta={false} value={selected < 0 ? "" : String(selected)}
    options={options} getDisplayLabel={option => option ? summary || option.label : "Choose range"}
    onChange={index => onChange(choosePointRange(ranges[Number(index)], point.uutTolerance))} />;
}
