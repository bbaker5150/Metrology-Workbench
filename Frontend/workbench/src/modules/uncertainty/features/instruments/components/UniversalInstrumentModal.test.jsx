import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import axios from "axios";
import UniversalInstrumentModal from "./UniversalInstrumentModal";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
  },
}));

beforeAll(() => {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  axios.post.mockReset();
});

const libraryInstrument = {
  id: "library-1",
  manufacturer: "Acme",
  model: "DMM-1",
  description: "Library DMM",
  measurementArea: "Electrical",
  measurementAreaColor: "#3498db",
  functions: [
    {
      id: "function-1",
      name: "DC Voltage",
      unit: "V",
      ranges: [
        {
          id: "range-1",
          min: 0,
          max: 10,
          resolution: 0.001,
          tolerances: {},
        },
      ],
    },
  ],
};

const sessionTmde = {
  id: "session-tmde-1",
  name: "Bench DMM",
  description: "Bench DMM",
  libraryInstrumentId: libraryInstrument.id,
  instrument: {
    ...libraryInstrument,
    id: "session-instrument-1",
    libraryInstrumentId: libraryInstrument.id,
  },
};

const renderModal = (overrides = {}) => {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
    onSaveToLibrary: vi.fn(),
    mode: "tmde",
    initialData: sessionTmde,
    instruments: [libraryInstrument],
    ...overrides,
  };

  render(<UniversalInstrumentModal {...props} />);
  return props;
};

const changeResolution = (value) => {
  const rangesTable = screen.getByRole("columnheader", {
    name: /^Resolution$/i,
  }).closest("table");
  const row = within(rangesTable).getAllByRole("row")[1];
  fireEvent.click(
    within(row).getByRole("button", {
      name: /0\.001 V|Set resolution/i,
    }),
  );
  const input = within(row).getByDisplayValue("0.001");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input, { target: { value } });
};

describe("UniversalInstrumentModal library synchronization", () => {
  test("syncs the selected local instrument from the library modal", async () => {
    const sharedInstrument = {
      ...libraryInstrument,
      id: "shared-sync",
      model: "DMM-SYNC",
      scope: "validated",
    };
    const localInstrument = {
      ...libraryInstrument,
      id: "local-sync",
      model: "DMM-SYNC",
      description: "Edited local DMM",
      scope: "local",
      owner: "bench-1",
      sourceId: sharedInstrument.id,
      validatedSnapshot: {
        manufacturer: libraryInstrument.manufacturer,
        model: "DMM-SYNC",
        description: "Library DMM",
        functions: libraryInstrument.functions,
      },
    };
    const syncedInstrument = {
      ...localInstrument,
      id: sharedInstrument.id,
      scope: "validated",
      sourceId: sharedInstrument.id,
    };
    const onInstrumentSynced = vi.fn();
    axios.post.mockResolvedValueOnce({ data: syncedInstrument });

    renderModal({
      mode: "library",
      initialData: null,
      instruments: [sharedInstrument, localInstrument],
      onInstrumentSynced,
    });

    fireEvent.click(screen.getByText("Edited local DMM").closest("tr"));
    fireEvent.click(screen.getByRole("button", { name: /Sync/i }));

    fireEvent.change(screen.getByLabelText("Shared library password"), {
      target: { value: "calibrate" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Re-sync$/i }));

    await waitFor(() => {
      expect(onInstrumentSynced).toHaveBeenCalledWith(syncedInstrument);
    });
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/instruments/"),
      expect.objectContaining({
        id: sharedInstrument.id,
        scope: "validated",
        sourceId: sharedInstrument.id,
        password: "calibrate",
      }),
    );
  });

  test("shows shared and local source labels in the library list and editor", () => {
    const sharedInstrument = {
      ...libraryInstrument,
      id: "shared-1",
      model: "DMM-SHARED",
      scope: "validated",
    };
    const localInstrument = {
      ...libraryInstrument,
      id: "local-1",
      model: "DMM-LOCAL",
      scope: "local",
      sourceId: sharedInstrument.id,
    };

    renderModal({
      mode: "library",
      initialData: null,
      instruments: [sharedInstrument, localInstrument],
    });

    expect(
      screen.getByRole("columnheader", { name: /Source/i }),
    ).toBeInTheDocument();

    const sharedRow = screen.getByText("DMM-SHARED").closest("tr");
    const localRow = screen.getByText("DMM-LOCAL").closest("tr");

    expect(
      within(sharedRow).getByLabelText("Instrument source: Shared"),
    ).toHaveTextContent("Shared");
    expect(
      within(localRow).getByLabelText("Instrument source: Local"),
    ).toHaveTextContent("Local");

    fireEvent.doubleClick(localRow);

    expect(screen.getByText("Identification")).toBeInTheDocument();
    expect(screen.getByLabelText("Instrument source: Local")).toHaveTextContent(
      "Local",
    );
  });

  test("new instruments save directly as local session instruments", () => {
    const props = renderModal({
      mode: "uut",
      initialData: null,
      instruments: [],
    });
    const [manufacturerInput, modelInput, nameInput] =
      document.querySelectorAll(".identity-grid input[type='text']");

    fireEvent.change(manufacturerInput, { target: { value: "Acme" } });
    fireEvent.change(modelInput, { target: { value: "LOCAL-1" } });
    fireEvent.change(nameInput, { target: { value: "Local UUT" } });
    fireEvent.click(screen.getByRole("button", { name: /Save configuration/i }));

    expect(
      screen.queryByRole("alertdialog", { name: /Save Instrument/i }),
    ).not.toBeInTheDocument();
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.onSaveToLibrary).not.toHaveBeenCalled();

    const saved = props.onSave.mock.calls[0][0];
    expect(saved.libraryInstrumentId).toBeUndefined();
    expect(saved.instrument).toEqual(
      expect.objectContaining({
        scope: "local",
        localOverride: true,
      }),
    );
    expect(saved.instrument.libraryInstrumentId).toBeUndefined();
  });

  test("adds a range with the inline tolerance term editor", () => {
    const manualInstrument = {
      ...sessionTmde,
      libraryInstrumentId: undefined,
      instrument: {
        ...sessionTmde.instrument,
        libraryInstrumentId: undefined,
        functions: [
          {
            ...sessionTmde.instrument.functions[0],
            ranges: [],
          },
        ],
      },
    };
    renderModal({
      initialData: manualInstrument,
      instruments: [],
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Add range to DC Voltage/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Set tolerance/i }));

    expect(screen.queryByText("Tolerance / Error Limits")).not.toBeInTheDocument();
    expect(screen.getByText("% IV")).toBeInTheDocument();
    expect(screen.getByText("% FS")).toBeInTheDocument();
    expect(screen.getByTitle("Absolute floor value")).toBeInTheDocument();
    expect(screen.getByText("dB")).toBeInTheDocument();
  });

  test("stores an inline tolerance term on the edited range", () => {
    const manualInstrument = {
      ...sessionTmde,
      libraryInstrumentId: undefined,
      instrument: {
        ...sessionTmde.instrument,
        libraryInstrumentId: undefined,
        functions: [
          {
            ...sessionTmde.instrument.functions[0],
            ranges: [],
          },
        ],
      },
    };
    const props = renderModal({
      initialData: manualInstrument,
      instruments: [],
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Add range to DC Voltage/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Set tolerance/i }));

    const rangesTable = screen.getByRole("columnheader", {
      name: /^Tolerance$/i,
    }).closest("table");
    const row = within(rangesTable).getAllByRole("row")[1];
    const [readingInput] = within(row).getAllByRole("textbox");
    fireEvent.change(readingInput, { target: { value: "0.0035" } });
    fireEvent.blur(readingInput, { target: { value: "0.0035" } });

    fireEvent.click(screen.getByRole("button", { name: /Save configuration/i }));

    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        instrument: expect.objectContaining({
          functions: [
            expect.objectContaining({
              ranges: [
                expect.objectContaining({
                  tolerances: expect.objectContaining({
                    reading: expect.objectContaining({
                      value: "0.0035",
                      high: "0.0035",
                      low: "-0.0035",
                    }),
                  }),
                }),
              ],
            }),
          ],
        }),
      }),
    );
  });

  test("shows Type B as a matching section with a header add action", () => {
    renderModal();

    expect(screen.getByText("Type B Uncertainties")).toBeInTheDocument();
    expect(screen.queryByText("Associated Type B")).not.toBeInTheDocument();
    expect(screen.queryByText(/Type B uncertainties carried with this instrument/i)).not.toBeInTheDocument();
    expect(screen.getByText("No Type B Uncertainties yet.")).toBeInTheDocument();
    const typeBToolbar = screen.getByText("Type B Uncertainties").closest(".spec-sheet-toolbar");
    expect(typeBToolbar).toHaveClass("typeb-spec-toolbar");
    expect(typeBToolbar.closest(".instrument-typeb-section")).toBeNull();
    expect(typeBToolbar.closest(".typeb-spec-section")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add Type B/i }));

    expect(screen.getByLabelText("Type B component name")).toBeInTheDocument();
  });

  test("keeps empty-state add actions in the section toolbar only", () => {
    renderModal({
      mode: "uut",
      initialData: null,
      instruments: [],
    });

    expect(screen.getByText("No functions yet.")).toBeInTheDocument();
    expect(screen.getByText("No Type B Uncertainties yet.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Add Function$/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Add Type B$/i })).toHaveLength(1);
  });

  test("does not expose the obsolete range resolution opt-in", () => {
    renderModal();

    expect(
      screen.queryByRole("checkbox", {
        name: /Include this range's resolution in the uncertainty budget/i,
      }),
    ).not.toBeInTheDocument();
  });

  test("stores the resolution distribution on the edited range", () => {
    const props = renderModal();

    const rangesTable = screen.getByRole("columnheader", {
      name: /^Resolution$/i,
    }).closest("table");
    const row = within(rangesTable).getAllByRole("row")[1];
    fireEvent.click(within(row).getByRole("button", { name: /0\.001 V/i }));
    const distributionSelect = within(row).getByLabelText(
      /Resolution distribution/i,
    );
    fireEvent.change(distributionSelect, { target: { value: "2.000" } });

    fireEvent.click(screen.getByRole("button", { name: /Save configuration/i }));
    fireEvent.click(screen.getByRole("button", { name: /Session Only/i }));

    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        instrument: expect.objectContaining({
          functions: [
            expect.objectContaining({
              ranges: [
                expect.objectContaining({
                  resolutionDistribution: "2.000",
                  measuringResolutionDistribution: "2.000",
                }),
              ],
            }),
          ],
        }),
      }),
    );
  });

  test("offers library-and-session or session-only when linked specs change", () => {
    const props = renderModal();

    changeResolution("0.01");
    fireEvent.click(screen.getByRole("button", { name: /Save configuration/i }));

    expect(
      screen.getByRole("alertdialog", { name: /Update Library Instrument/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Update Library & Session/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Session Only/i }),
    ).toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  test("updates the linked library instrument without changing its id", () => {
    const props = renderModal();

    changeResolution("0.01");
    fireEvent.click(screen.getByRole("button", { name: /Save configuration/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /Update Library & Session/i }),
    );

    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryInstrumentId: libraryInstrument.id,
        instrument: expect.objectContaining({
          libraryInstrumentId: libraryInstrument.id,
        }),
      }),
    );
    expect(props.onSaveToLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        id: libraryInstrument.id,
        functions: [
          expect.objectContaining({
            ranges: [
              expect.objectContaining({
                resolution: "0.01",
              }),
            ],
          }),
        ],
      }),
    );
  });

  test("session-only keeps the library unchanged", () => {
    const props = renderModal();

    changeResolution("0.02");
    fireEvent.click(screen.getByRole("button", { name: /Save configuration/i }));
    fireEvent.click(screen.getByRole("button", { name: /Session Only/i }));

    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.onSaveToLibrary).not.toHaveBeenCalled();
    expect(props.onSave.mock.calls[0][0].instrument).toEqual(
      expect.objectContaining({
        scope: "local",
        sourceId: libraryInstrument.id,
        localOverride: true,
      }),
    );
  });
});
