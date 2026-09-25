import React from "react";

export default function MeasurementAreaEmptyHint() {
  return <div className="measurement-area-empty-hint" role="status">
    Click + to add a measurement area <span aria-hidden="true">↑</span>
  </div>;
}
