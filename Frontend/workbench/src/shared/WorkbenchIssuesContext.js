import { createContext, useContext } from "react";

export const WorkbenchIssuesContext = createContext(null);
export const useWorkbenchIssues = () => useContext(WorkbenchIssuesContext);
