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
  test("uses the add button as the only new-instrument entry point", () => {
    renderModal({
      mode: "library",
      initialData: null,
      instruments: [],
    });

    expect(screen.queryByTitle("Back to Editor")).not.toBeInTheDocument();
    expect(screen.getByTitle("Create Manual Instrument")).toBeInTheDocument();
  });

  test("shows missing required fields when save is attempted", () => {
    const props = renderModal({
      mode: "uut",
      initialData: null,
      instruments: [],
    });

    const save = screen.getByRole("button", { name: "Save configuration" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    const notice = screen.getByRole("alertdialog", {
      name: "Complete required fields",
    });
    expect(notice).toHaveTextContent("Mfr., Model, Name");
    expect(props.onSave).not.toHaveBeenCalled();
  });

  test("does not decorate Type B authoring with flask icons", () => {
    renderModal();

    expect(document.querySelector('[data-icon="flask"]')).not.toBeInTheDocument();
  });

  test("owns Delete and routes it to the selected library instrument", async () => {
    const onDelete = vi.fn(async () => {});
    renderModal({
      mode: "library",
      initialData: null,
      instruments: [libraryInstrument],
      onDelete,
    });

    fireEvent.click(screen.getByText("DMM-1").closest("tr"));

    // Simulate a background analysis shortcut. The open modal must consume the
    // event and open its own existing confirmation instead of letting that
    // background selection react.
    const backgroundDelete = vi.fn();
    window.addEventListener("keydown", backgroundDelete);
    fireEvent.keyDown(window, { key: "Delete" });
    window.removeEventListener("keydown", backgroundDelete);

    expect(backgroundDelete).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", { name: "Delete Instrument" }),
    ).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("library-1"));
  });

  test("merges same-name function declarations while retaining each range unit", () => {
    const multiUnitInstrument = {
      ...sessionTmde,
      libraryInstrumentId: undefined,
      instrument: {
        ...sessionTmde.instrument,
        libraryInstrumentId: undefined,
        functions: [
          {
            id: "weight-kg",
            name: "Weight",
            unit: "kg",
            ranges: [{ id: "kg-range", min: 0, max: 10, unit: "kg", tolerances: {} }],
          },
          {
            id: "weight-lb",
            name: "Weight",
            unit: "lb",
            ranges: [{ id: "lb-range", min: 0, max: 20, unit: "lb", tolerances: {} }],
          },
        ],
      },
    };

    renderModal({ initialData: multiUnitInstrument, instruments: [] });

    expect(screen.getAllByLabelText("Function name")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /0 to 10 kg/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /0 to 20 lb/i })).toBeInTheDocument();
  });

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

  test("password-gates saving a validated instrument edited in library mode", async () => {
    const sharedInstrument = {
      ...libraryInstrument,
      id: "shared-lib-1",
      model: "DMM-SHARED",
      scope: "validated",
    };
    const syncedInstrument = { ...sharedInstrument, sourceId: "shared-lib-1" };
    axios.post.mockResolvedValueOnce({ data: syncedInstrument });
    const onInstrumentSynced = vi.fn();

    const props = renderModal({
      mode: "library",
      initialData: null,
      instruments: [sharedInstrument],
      onInstrumentSynced,
    });

    // Open the shared instrument for editing (as when adding a Type B to it).
    fireEvent.doubleClick(screen.getByText("DMM-SHARED").closest("tr"));

    // Saving a validated instrument must prompt for the password, never fire an
    // unguarded POST (the 403 the user hit).
    fireEvent.click(screen.getByRole("button", { name: /Save configuration/i }));
    expect(axios.post).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Shared library password"), {
      target: { value: "calibrate" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Update Shared Library/i }),
    );

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/instruments/"),
        expect.objectContaining({
          id: "shared-lib-1",
          scope: "validated",
          password: "calibrate",
        }),
      );
    });
    // Library mode reconciles through onInstrumentSynced; it must not also
    // re-POST the record via the unguarded session onSave path.
    expect(onInstrumentSynced).toHaveBeenCalledWith(syncedInstrument);
    expect(props.onSave).not.toHaveBeenCalled();
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

  test("composes the Description/Name from the Mfr. / Model / Name sub-fields", () => {
    renderModal({ mode: "uut", initialData: null, instruments: [] });
    // Identity mirrors the inline tables: three sub-fields in order Mfr., Model,
    // Name that snap into the composed description shown below them.
    const [mfrInput, modelInput, nameInput] =
      document.querySelectorAll(".identity-grid input[type='text']");

    expect(
      Array.from(document.querySelectorAll(".identity-grid label")).map(
        (label) => label.textContent,
      ),
    ).toEqual(["Mfr.", "Model", "Name"]);

    fireEvent.change(mfrInput, { target: { value: "Fluke" } });
    fireEvent.change(modelInput, { target: { value: "8588A" } });
    // With no trailing token, the description is just Mfr. + Model.
    expect(
      document.querySelector(".identity-composed-value"),
    ).toHaveTextContent("Fluke 8588A");

    // The trailing Name token follows Mfr. and Model.
    fireEvent.change(nameInput, { target: { value: "Bench" } });
    expect(
      document.querySelector(".identity-composed-value"),
    ).toHaveTextContent("Fluke 8588A Bench");
  });

  test("new instruments save directly as local session instruments", () => {
    const props = renderModal({
      mode: "uut",
      initialData: null,
      instruments: [],
    });
    const [mfrInput, modelInput, nameInput] =
      document.querySelectorAll(".identity-grid input[type='text']");

    fireEvent.change(mfrInput, { target: { value: "Acme" } });
    fireEvent.change(nameInput, { target: { value: "Bench" } });
    fireEvent.change(modelInput, { target: { value: "LOCAL-1" } });
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

  test("edits an all-values tolerance without requiring range bounds", () => {
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

    const emptyTolerance = screen.getByRole("button", { name: "Set tolerance" });
    expect(emptyTolerance).toHaveTextContent(/^\s*$/);
    fireEvent.click(emptyTolerance);

    expect(screen.queryByText("Tolerance / Error Limits")).not.toBeInTheDocument();
    expect(screen.getByText(/IV %/)).toBeInTheDocument();
    expect(screen.getByText("% FS")).toBeInTheDocument();
    expect(screen.getByText("dB")).toBeInTheDocument();
    expect(screen.getByText("Single Sided High")).toBeInTheDocument();
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

  test("lets an IV tolerance be expressed in ppm", () => {
    const manualInstrument = {
      ...sessionTmde,
      libraryInstrumentId: undefined,
      instrument: {
        ...sessionTmde.instrument,
        libraryInstrumentId: undefined,
        functions: [
          {
            ...sessionTmde.instrument.functions[0],
            ranges: [
              {
                id: "range-iv-ppm",
                min: 0,
                max: 10,
                unit: "V",
                tolerances: {
                  reading: {
                    high: "50",
                    low: "-50",
                    unit: "V",
                    symmetric: true,
                    distribution: "1.732",
                  },
                },
              },
            ],
          },
        ],
      },
    };
    const props = renderModal({
      initialData: manualInstrument,
      instruments: [],
    });

    // Open the tolerance editor for the existing IV term.
    fireEvent.click(
      screen.getByRole("button", { name: /50 V IV/i }),
    );

    // IV can use %, ppm, or ppb; Floor remains a non-editable physical unit.
    const ivUnit = screen.getByTitle(/IV unit/i);
    expect(ivUnit).toHaveTextContent("IV V");
    fireEvent.click(ivUnit);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "ppm" }));
    expect(screen.getByTitle(/IV unit/i)).toHaveTextContent("IV ppm");

    fireEvent.click(screen.getByRole("button", { name: /Save configuration/i }));

    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        instrument: expect.objectContaining({
          functions: [
            expect.objectContaining({
              ranges: [
                expect.objectContaining({
                  tolerances: expect.objectContaining({
                    reading: expect.objectContaining({ unit: "ppm", high: "50" }),
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

  test("owns Ctrl+Z and undoes builder actions without touching the session behind it", async () => {
    renderModal();
    const rangesTable = screen.getByRole("columnheader", {
      name: /^Range$/i,
    }).closest("table");

    await waitFor(() => {
      expect(within(rangesTable).getAllByRole("row")).toHaveLength(2);
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Add range to DC Voltage/i }),
    );
    expect(within(rangesTable).getAllByRole("row")).toHaveLength(3);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => {
      expect(within(rangesTable).getAllByRole("row")).toHaveLength(2);
    });
  });

  test("stores the workbook-style single-sided tolerance case", () => {
    const manualInstrument = {
      ...sessionTmde,
      libraryInstrumentId: undefined,
      instrument: {
        ...sessionTmde.instrument,
        libraryInstrumentId: undefined,
      },
    };
    const props = renderModal({ initialData: manualInstrument, instruments: [] });
    fireEvent.click(screen.getByRole("button", { name: "Set tolerance" }));

    fireEvent.click(screen.getByRole("button", { name: "Single-sided direction" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Low" }));
    fireEvent.click(screen.getByLabelText("Measurement unknown"));
    const limit = screen.getByLabelText("Measurement unknown Lower limit");
    fireEvent.change(limit, { target: { value: "2.5" } });
    fireEvent.blur(limit, { target: { value: "2.5" } });

    fireEvent.click(screen.getByRole("button", { name: /Save configuration/i }));

    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        instrument: expect.objectContaining({
          functions: [
            expect.objectContaining({
              ranges: [
                expect.objectContaining({
                  tolerances: {
                    singleSided: expect.objectContaining({
                      direction: "low",
                      measurement: "unknown",
                      limit: "2.5",
                    }),
                  },
                }),
              ],
            }),
          ],
        }),
      }),
    );
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
    const distributionSelect = within(row).getByRole("button", {
      name: /Resolution distribution/i,
    });
    expect(distributionSelect).toHaveTextContent("Rectangular (resolution)");
    fireEvent.click(distributionSelect);
    expect(screen.getByRole("option", { name: /Triangular\s+2\.449/ })).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: /Triangular \(resolution\)\s+4\.899/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Normal \(95%\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Normal \(95\.45%\)/ }));

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

  test("updates the linked library instrument through the password gate", async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        ...libraryInstrument,
        scope: "validated",
        sourceId: libraryInstrument.id,
      },
    });
    const onInstrumentSynced = vi.fn();
    const props = renderModal({ onInstrumentSynced });

    changeResolution("0.01");
    fireEvent.click(screen.getByRole("button", { name: /Save configuration/i }));
    // Choosing "Update Library & Session" opens the shared-library password gate
    // rather than writing straight to the validated library (which 403s).
    fireEvent.click(
      screen.getByRole("button", { name: /Update Library & Session/i }),
    );

    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onSaveToLibrary).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Shared library password"), {
      target: { value: "calibrate" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Update Library & Session/i }),
    );

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/instruments/"),
        expect.objectContaining({
          id: libraryInstrument.id,
          scope: "validated",
          sourceId: libraryInstrument.id,
          password: "calibrate",
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

    await waitFor(() => {
      expect(props.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          libraryInstrumentId: libraryInstrument.id,
          instrument: expect.objectContaining({
            libraryInstrumentId: libraryInstrument.id,
          }),
        }),
      );
    });
    expect(props.onSaveToLibrary).not.toHaveBeenCalled();
  });

  test("keeps the password prompt open when the shared library rejects it", async () => {
    axios.post.mockRejectedValueOnce({
      response: { status: 403, data: { detail: "Invalid shared-library password." } },
    });
    const props = renderModal();

    changeResolution("0.01");
    fireEvent.click(screen.getByRole("button", { name: /Save configuration/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /Update Library & Session/i }),
    );

    fireEvent.change(screen.getByLabelText("Shared library password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Update Library & Session/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Invalid shared-library password\./i),
      ).toBeInTheDocument();
    });
    // Neither the session nor the library was written on a rejected password.
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Shared library password")).toBeInTheDocument();
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
