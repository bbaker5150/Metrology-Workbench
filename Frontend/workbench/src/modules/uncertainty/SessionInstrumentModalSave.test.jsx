import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

vi.mock("plotly.js-dist", () => ({ default: {} }));
const state = vi.hoisted(() => ({ sessions: [], payload: null, put: vi.fn() }));
vi.mock("axios", () => ({ default: {
  get: vi.fn(url => Promise.resolve({ data: String(url).includes("/sessions/") ? state.sessions : [] })),
  post: vi.fn(() => Promise.resolve({ data: {} })),
  put: state.put,
  patch: vi.fn(() => Promise.resolve({ data: {} })),
  delete: vi.fn(() => Promise.resolve({ data: {} })),
} }));
// The real modal's shared-to-Session payload is covered by its own tests. Exercise
// both receiving save handlers with that payload, including intentionally omitted
// legacy aliases and session-only metadata.
vi.mock("./features/instruments/components/UniversalInstrumentModal", () => ({
  default: ({ isOpen, onSave }) => isOpen
    ? <button onClick={() => onSave(state.payload)}>Save instrument fixture</button> : null,
}));

import UncertaintyApp from "./UncertaintyApp";
import EditSessionModal from "./features/session/components/EditSessionModal";
import { ThemeProvider } from "../../shared/ThemeContext";
import { NotificationProvider } from "../../shared/NotificationContext";
import { saveEditorDraft } from "./utils/editorRecovery";
import { refreshTmdeInstancesFromMasters } from "./utils/tmdeReconcile";

beforeAll(() => {
  window.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  window.PointerEvent ||= window.MouseEvent;
});
beforeEach(() => {
  localStorage.clear();
  state.put.mockReset().mockImplementation(() => Promise.resolve({ data: {} }));
});

const definition = (id = "shared", limit = "0.01") => ({
  id, libraryInstrumentId: id, scope: id === "shared" ? "validated" : "session", sourceId: "shared",
  manufacturer: "Fixture", model: "Meter", description: "Fixture meter",
  functions: [{ id: "voltage", name: "Voltage", unit: "V", ranges: [{ id: "range", min: 0, max: 10, unit: "V",
    tolerances: { reading: { toleranceLimit: limit, unit: "%" } } }] }],
});
const fixture = kind => {
  const row = { id: "row", name: "Fixture meter", description: "Fixture meter", quantity: 3, assetId: "serial-123",
    measurementArea: "Voltage", measurementAreaId: "area", measurementAreaNames: ["Voltage"],
    instrument: definition(), libraryInstrumentId: "shared", definitionId: "shared", instrumentId: "shared",
    sourceInstrumentId: "shared", sourceInstrument: { id: "shared" }, isInstrumentBased: true };
  const sibling = { ...row, id: "sibling", name: "Sibling" };
  const instance = id => ({ id, sourceInstrument: definition(), functionId: "voltage", rangeId: "range",
    measurementPoint: { value: "5", unit: "V" }, variableType: "x", quantity: 2 });
  const session = { id: 456, name: "Modal save integration", uncReq: {},
    measurementAreas: [{ id: "area", name: "Voltage", color: "#388e3c" }],
    uuts: kind === "uut" ? [row] : [], tmdes: kind === "tmde" ? [row, sibling] : [],
    testPoints: ["active", "unopened"].map(id => ({ id, measurementAreaId: "area", measurementType: "direct",
      testPointInfo: { measurementArea: "Voltage", parameter: { name: "Voltage", value: "5", unit: "V" } },
      associatedUutIds: kind === "uut" ? [row.id] : [], specifications: {}, components: [],
      tmdeTolerances: kind === "tmde" ? [instance(`${id}-legacy`), { ...instance(`${id}-sibling`), sourceId: "sibling" }] : [] })) };
  const payload = { id: row.id, type: kind, name: row.name, description: row.description,
    measurementArea: row.measurementArea, measurementAreaId: row.measurementAreaId,
    libraryInstrumentId: "detached", instrument: definition("detached", "0.2") };
  return { row, session, payload };
};

function verifySaved(saved, kind, changed = true) {
  const row = saved[kind === "uut" ? "uuts" : "tmdes"][0];
  const id = changed ? "detached" : "shared";
  expect(row).toMatchObject({ id: "row", quantity: 3, assetId: "serial-123", measurementAreaNames: ["Voltage"],
    libraryInstrumentId: id, definitionId: id, instrumentId: id, sourceInstrumentId: id,
    sourceInstrument: { id }, instrument: { id, scope: changed ? "session" : "validated" } });
  if (kind !== "tmde") return;
  expect(saved.tmdes[1].instrument.id).toBe("shared");
  for (const point of saved.testPoints) {
    const instances = refreshTmdeInstancesFromMasters(point.tmdeTolerances, saved.tmdes);
    expect(instances).toHaveLength(2);
    expect(instances[0]).toMatchObject({ id: `${point.id}-legacy`, sourceId: "row", quantity: 2,
      measurementPoint: { value: "5", unit: "V" }, variableType: "x",
      reading: { toleranceLimit: changed ? "0.2" : "0.01" }, instrument: { id } });
    expect(instances[1]).toMatchObject({ sourceId: "sibling", instrument: { id: "shared" }, reading: { toleranceLimit: "0.01" } });
    if (changed) expect(point.tmdeTolerances[0].sourceId).toBe("row");
  }
}

describe("session instrument modal save integration", () => {
  for (const kind of ["uut", "tmde"]) {
    it(`App adopts the detached ${kind} identity and preserves all session links`, async () => {
      const { row, session, payload } = fixture(kind);
      state.sessions = [session]; state.payload = payload;
      saveEditorDraft("open-instrument-builder", { mode: kind, data: row });
      render(<ThemeProvider><NotificationProvider><MemoryRouter><UncertaintyApp /></MemoryRouter></NotificationProvider></ThemeProvider>);
      await screen.findByRole("button", { name: "Voltage measurement area settings" });
      fireEvent.click(await screen.findByRole("button", { name: "Save instrument fixture" }));
      await waitFor(() => {
        const saved = state.put.mock.calls.map(([, body]) => body).find(body => body?.[kind === "uut" ? "uuts" : "tmdes"]?.[0]?.instrument?.id === "detached");
        expect(saved).toBeDefined(); verifySaved(saved, kind);
      });
    });

    for (const changed of [true, false]) {
      it(`Edit Session preserves ${kind} aliases and point links on ${changed ? "changed" : "unchanged"} saves`, () => {
        const { row, session, payload } = fixture(kind);
        state.payload = changed ? payload : { ...payload, libraryInstrumentId: "shared", instrument: row.instrument };
        const onSave = vi.fn();
        render(<EditSessionModal isOpen onClose={() => {}} onSave={onSave} sessionData={session} initialSection="instruments" />);
        fireEvent.click(screen.getAllByTitle("Edit")[0]);
        fireEvent.click(screen.getByRole("button", { name: "Save instrument fixture" }));
        fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));
        verifySaved(onSave.mock.calls[0][0], kind, changed);
        if (!changed && kind === "tmde") expect(onSave.mock.calls[0][0].testPoints[0]).toBe(session.testPoints[0]);
      });
    }
  }
});
