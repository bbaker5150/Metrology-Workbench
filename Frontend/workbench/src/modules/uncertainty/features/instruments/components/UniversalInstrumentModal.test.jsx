import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import UniversalInstrumentModal from "./UniversalInstrumentModal";

beforeAll(() => {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
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
    name: /Resolution \(V\)/i,
  }).closest("table");
  const row = within(rangesTable).getAllByRole("row")[1];
  const inputs = within(row).getAllByRole("spinbutton");
  fireEvent.change(inputs[2], { target: { value } });
};

const toggleResolutionBudget = () => {
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: /Include this range's resolution in the uncertainty budget/i,
    }),
  );
};

describe("UniversalInstrumentModal library synchronization", () => {
  test("new instruments default to undefined measurement area and adopt existing area color by name", () => {
    renderModal({
      mode: "uut",
      initialData: null,
      instruments: [],
      measurementAreas: [
        { id: "area-flow", name: "Flow", color: "#22c55e" },
      ],
    });

    const areaInput = screen.getByLabelText("Measurement Area");
    const colorInput = screen.getByLabelText("Measurement area color");

    expect(areaInput).toHaveValue("undefined");
    expect(colorInput).toHaveValue("#3498db");

    fireEvent.change(areaInput, { target: { value: "Flow" } });

    expect(areaInput).toHaveValue("Flow");
    expect(colorInput).toHaveValue("#22c55e");
  });

  test("adds a range with no pre-populated tolerance components", () => {
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

    fireEvent.click(screen.getByRole("button", { name: /Add Range/i }));
    fireEvent.click(screen.getByText("Custom Spec"));

    expect(
      screen.getByText("No tolerance components added."),
    ).toBeInTheDocument();
  });

  test("stores the resolution budget opt-in on the edited range", () => {
    const props = renderModal();

    toggleResolutionBudget();
    fireEvent.click(screen.getByRole("button", { name: /Save configuration/i }));
    fireEvent.click(screen.getByRole("button", { name: /Session Only/i }));

    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        instrument: expect.objectContaining({
          functions: [
            expect.objectContaining({
              ranges: [
                expect.objectContaining({
                  tolerances: expect.objectContaining({
                    includeResolutionInBudget: true,
                  }),
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
  });
});
