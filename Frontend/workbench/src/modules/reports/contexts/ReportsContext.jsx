// src/modules/reports/contexts/ReportsContext.jsx
//
// Module-private context for the Report of Calibration tool. Holds the
// report-in-progress (`data`), the section visibility/order (`sections`),
// and which left-panel tab is active — the same state ROC Gen's standalone
// App.jsx used to own locally, now hoisted here so ReportsMain and its
// children can all reach it via useReports().
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { DEFAULT_SECTIONS, EMPTY_DATA } from "../constants/constants";

const ReportsContext = createContext(null);

export const useReports = () => useContext(ReportsContext);

export function ReportsProvider({ children }) {
  const [data, setData] = useState(EMPTY_DATA);
  const [sections, setSections] = useState(DEFAULT_SECTIONS);
  const [activeTab, setActiveTab] = useState("source");
  const [recordsRevision, setRecordsRevision] = useState(0);

  const handleDataLoaded = useCallback((incoming) => {
    setData({ ...EMPTY_DATA, ...incoming });
  }, []);

  const value = useMemo(() => ({
    data, setData, sections, setSections, activeTab, setActiveTab, handleDataLoaded,
    recordsRevision, refreshRecords: () => setRecordsRevision((value) => value + 1),
  }), [data, sections, activeTab, handleDataLoaded, recordsRevision]);

  return (
    <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>
  );
}
