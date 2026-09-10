import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import Calibration from "./Calibration";
vi.mock("axios", () => ({ default: { get: vi.fn(async () => ({ data: {} })) } }));
vi.mock("../../contexts/InstrumentContext", () => ({ useInstruments: () => ({
  selectedSessionId: 1, stdReaderModel: "5790A", tiReaderModel: "8508A",
  liveReadings: [], tiLiveReadings: [], initialLiveReadings: [], discoveredInstruments: [],
  collectionProgress: {}, activeCollectionDetails: {}, stabilizationStatus: "", slidingWindowStatus: {},
  timerState: {}, setFailedTPKeys: vi.fn(),
}) }));
vi.mock("../../../../shared/ThemeContext", () => ({ useTheme: () => ({ theme: "light" }) }));
it("keeps shared actions inside General and uses matching reader save icons", () => {
  const point = { key: "p", current: 1, frequency: 1000, forward: { id: 1, settings: {}, results: {} }, reverse: { id: 2, settings: {}, results: {} } };
  render(<Calibration orderedTestPoints={[point]} sharedFocusedTestPoint={point} sharedSelectedTPs={new Set()} activeDirection="Forward" showNotification={vi.fn()} onDataUpdate={vi.fn()} setSharedFocusedTestPoint={vi.fn()} />);
  const general = screen.getByText("General", { exact: true }).closest(".settings-form-group");
  const save = screen.getByRole("button", { name: "Save settings for this point" });
  const apply = screen.getByRole("button", { name: "Apply to all test points" });
  expect(general).toContainElement(save);
  expect(general).toContainElement(apply);
  expect(general).toContainElement(screen.getByRole("button", { name: "Reset to default settings" }));
  for (const reader of ["5790", "8508A"]) {
    expect(screen.getByRole("button", { name: `Save ${reader} settings for this test point` }).querySelector("svg").innerHTML).toBe(save.querySelector("svg").innerHTML);
    expect(screen.getByRole("button", { name: `Apply ${reader} settings to all measurement points` }).querySelector("svg").innerHTML).toBe(apply.querySelector("svg").innerHTML);
  }
});

