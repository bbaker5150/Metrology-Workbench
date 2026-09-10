import { createContext, useContext } from "react";

// Embedded SharePoint deployments perform record deletes directly. The
// workbench keeps its existing confirmation UI. Permissions and storage
// failures remain enforced by the data provider in either deployment.
export const ConfirmRecordDeletesContext = createContext(true);
export const useConfirmRecordDeletes = () => useContext(ConfirmRecordDeletesContext);
