// src/modules/reports/constants/constants.js
//
// Module-private constants for the Report of Calibration tool. Define the
// module's API root once here and import it internally rather than scattering
// the URL string. Phase 2 introduces the per-module /api/reports namespace;
// until then this simply suffixes the shared API base.
import { API_BASE_URL } from "../../../shared/config";

export const REPORTS_API = `${API_BASE_URL}/reports`;

export const DEFAULT_SECTIONS = [
  { id: "letterhead", label: "NPSL Letterhead", visible: true },
  { id: "title", label: "Title & Nomenclature", visible: true },
  { id: "instrument", label: "Instrument Identity", visible: true },
  { id: "customer", label: "Submitted By / Customer", visible: true },
  { id: "statements", label: "Technical Statement & Procedure", visible: true },
  { id: "inline_results", label: "Inline Results (coefficients)", visible: true },
  { id: "statements_rest", label: "Statements (uncertainty, traceability)", visible: true },
  { id: "environment", label: "Environment & Dates", visible: true },
  { id: "signatures", label: "Signature Block", visible: true },
  { id: "footer", label: "RoC # Footer", visible: true },
  { id: "tables", label: "Measurement Data (page 2)", visible: true },
];

export const EMPTY_DATA = {
  area_code: "",
  roc_number: "",
  nomenclature: "",
  manufacturer: "",
  model_number: "",
  serial_number: "",
  submitted_label: "Submitted by:",
  customer_name: "",
  customer_address: "",
  procedure_used: "",
  statements: [],
  inline_results: [],
  ambient_temperature: "",
  relative_humidity: "",
  calibration_date: "",
  due_date: "",
  issue_date: "",
  metrologist_name: "",
  metrologist_title: "",
  approver_name: "",
  approver_title: "",
  tables: [],
};
