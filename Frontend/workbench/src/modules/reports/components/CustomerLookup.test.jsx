import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import ManualInputForm from "./ManualInputForm";
import CustomerLookup from "./CustomerLookup";
import { fetchCustomers, importCustomers } from "../api";
vi.mock("../api", () => ({ fetchCustomers: vi.fn(), importCustomers: vi.fn(), fetchAreas: vi.fn().mockResolvedValue([]) }));
const customer = { id: 1, lab_name: "Test lab", activity: "CODE", sub_custodian: "001", address: "123 Main St", syscom: "NAVAIR" };
beforeEach(() => {
  vi.clearAllMocks();
  fetchCustomers.mockResolvedValue({ customers: [customer], total: 25, page: 1, pages: 2 });
});
test("searches and pages the customer directory", async () => {
  render(<CustomerLookup onSelect={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Look up customer"), { target: { value: "001" } });
  await screen.findByText("Test lab");
  expect(fetchCustomers).toHaveBeenLastCalledWith({ q: "001", page: 1 });
  fireEvent.click(screen.getByText("Next"));
  await waitFor(() => expect(fetchCustomers).toHaveBeenLastCalledWith({ q: "001", page: 2 }));
});
test("selection fills both editable fields and leaves other report fields intact", async () => {
  function Form() {
    const [data, setData] = useState({ customer_name: "Old", customer_address: "Old address", roc_number: "ROC-123", statements: [], tables: [] });
    return <ManualInputForm data={data} onChange={setData} />;
  }
  render(<Form />);
  fireEvent.click(screen.getByText("Browse customers"));
  fireEvent.click(await screen.findByText("Test lab"));
  expect(screen.getByLabelText("Activity / Ship")).toHaveValue("Test lab");
  expect(screen.getByLabelText("Address")).toHaveValue("123 Main St");
  expect(screen.getByLabelText("RoC #")).toHaveValue("ROC-123");
  fireEvent.change(screen.getByLabelText("Address"), { target: { value: "Edited address" } });
  fireEvent.blur(screen.getByLabelText("Address"));
  expect(screen.getByLabelText("Address")).toHaveValue("Edited address");
});
test("drop imports an updated workbook and reloads the directory", async () => {
  importCustomers.mockResolvedValue({ imported: 2, missing_addresses: 1, duplicates_skipped: 0 });
  render(<CustomerLookup onSelect={vi.fn()} />);
  const file = new File(["test"], "Latest.xlsx");
  fireEvent.drop(screen.getByText("Drop Excel here or choose a file"), { dataTransfer: { files: [file] } });
  await screen.findByText(/Directory updated: 2 customers/);
  expect(importCustomers).toHaveBeenCalledWith(file);
  await waitFor(() => expect(fetchCustomers).toHaveBeenCalled());
});
test("invalid uploads display the backend validation error", async () => {
  importCustomers.mockRejectedValue({ response: { data: { error: "Required headers are missing." } } });
  render(<CustomerLookup onSelect={vi.fn()} />);
  fireEvent.drop(screen.getByText("Drop Excel here or choose a file"), { dataTransfer: { files: [new File(["test"], "Invalid.xlsx")] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Required headers are missing.");
});

test("selecting a customer with no address clears the previous customer's address", async () => {
  fetchCustomers.mockResolvedValue({ customers: [{ ...customer, address: "" }], total: 1, page: 1, pages: 1 });
  function Form() {
    const [data, setData] = useState({ customer_name: "Old", customer_address: "Previous address", statements: [], tables: [] });
    return <ManualInputForm data={data} onChange={setData} />;
  }
  render(<Form />);
  fireEvent.click(screen.getByText("Browse customers"));
  fireEvent.click(await screen.findByText("Test lab"));
  expect(screen.getByLabelText("Address")).toHaveValue("");
  expect(screen.getByText(/Customer selected without an address/)).toBeInTheDocument();
});
