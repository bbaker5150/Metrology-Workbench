import axios from "../../shared/apiClient";
import { REPORTS_API } from "./constants/constants";

export const fetchAreas = () => axios.get(`${REPORTS_API}/areas/`).then((r) => r.data);
export const fetchROCs = () => axios.get(`${REPORTS_API}/rocs/`).then((r) => r.data);
export const fetchROC = (id) => axios.get(`${REPORTS_API}/rocs/${id}/`).then((r) => r.data);
export const createROC = (payload) => axios.post(`${REPORTS_API}/rocs/`, payload).then((r) => r.data);
export const updateROC = (id, payload) => axios.put(`${REPORTS_API}/rocs/${id}/`, payload).then((r) => r.data);
export const deleteROC = (id) => axios.delete(`${REPORTS_API}/rocs/${id}/`);
export const fetchAcShuntSessions = () =>
  axios.get(`${REPORTS_API}/ac-shunt/sessions/`).then((r) => r.data);
export const pullAcShuntSession = (id) =>
  axios.get(`${REPORTS_API}/ac-shunt/sessions/${id}/pull/`).then((r) => r.data);

function downloadBlob(data, fallbackName, headers) {
  const disposition = headers?.["content-disposition"] || "";
  const filename = disposition.match(/filename="?([^";]+)"?/)?.[1] || fallbackName;
  const url = URL.createObjectURL(new Blob([data]));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function generateROC(payload) {
  const response = await axios.post(`${REPORTS_API}/roc/generate/`, payload, {
    responseType: "blob",
  });
  downloadBlob(response.data, `ROC_${payload.roc_number || "draft"}.xlsx`, response.headers);
}

export async function downloadRecordROC(id, rocNumber) {
  const response = await axios.get(`${REPORTS_API}/rocs/${id}/excel/`, {
    responseType: "blob",
  });
  downloadBlob(response.data, `ROC_${rocNumber}.xlsx`, response.headers);
}

export async function parseROCFile(file) {
  const form = new FormData();
  form.append("file", file);
  const response = await axios.post(`${REPORTS_API}/roc/parse/`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function downloadTemplate(areaCode) {
  const response = await axios.get(`${REPORTS_API}/roc/template/`, {
    params: { area: areaCode },
    responseType: "blob",
  });
  downloadBlob(response.data, `ROC_template_${areaCode}.xlsx`, response.headers);
}
