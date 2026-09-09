import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AcShuntImport from "./AcShuntImport";
import { fetchAcShuntSessions, pullAcShuntSession } from "../api";
vi.mock("../api", () => ({ fetchAcShuntSessions: vi.fn(), pullAcShuntSession: vi.fn() }));
const session = { id: 61, session_name: "Older calibration", test_instrument_model: "A40B", test_instrument_serial: "SN-61" };
beforeEach(() => {
  vi.clearAllMocks();
  fetchAcShuntSessions.mockResolvedValue({ available: true, sessions: [session], total: 61, page: 1, pages: 4, models: ["A40B"] });
});
test("searches the backend, filters models and navigates beyond the first page", async () => {
  render(<AcShuntImport onDataLoaded={vi.fn()} />);
  await screen.findByText("Older calibration");
  fireEvent.click(screen.getByText("Next"));
  await waitFor(() => expect(fetchAcShuntSessions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  fireEvent.change(screen.getByLabelText("Search sessions"), { target: { value: "SN-61" } });
  await waitFor(() => expect(fetchAcShuntSessions).toHaveBeenLastCalledWith(expect.objectContaining({ q: "SN-61", page: 1 })));
  fireEvent.change(screen.getByLabelText("UUT model"), { target: { value: "A40B" } });
  await waitFor(() => expect(fetchAcShuntSessions).toHaveBeenLastCalledWith(expect.objectContaining({ model: "A40B", q: "SN-61" })));
});
test("preserves search on return from preview and loads the selected report", async () => {
  const onDataLoaded = vi.fn();
  const report = { serial_number: "SN-61", tables: [] };
  pullAcShuntSession.mockResolvedValue(report);
  render(<AcShuntImport onDataLoaded={onDataLoaded} />);
  fireEvent.change(screen.getByLabelText("Search sessions"), { target: { value: "SN-61" } });
  fireEvent.click(await screen.findByText("Older calibration"));
  fireEvent.click(await screen.findByText("← Back to sessions"));
  expect(screen.getByLabelText("Search sessions")).toHaveValue("SN-61");
  fireEvent.click(screen.getByText("Older calibration"));
  fireEvent.click(await screen.findByText("Load into Report"));
  expect(onDataLoaded).toHaveBeenCalledWith(report);
});
