import { act, renderHook, waitFor } from "@testing-library/react";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useSessionManager, {
  prepareImportedSession,
} from "./useSessionManager";

vi.mock("axios", () => ({
  default: {
    delete: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  axios.delete.mockResolvedValue({});
  axios.post.mockResolvedValue({});
  axios.put.mockResolvedValue({});
  axios.get.mockImplementation((url) =>
    Promise.resolve({
      data: url.endsWith("/sessions/")
        ? [
            {
              id: 1,
              name: "Original",
              testPoints: [],
            },
          ]
        : [],
    }),
  );
});

describe("prepareImportedSession", () => {
  it("always creates a separate session without changing nested IDs", () => {
    const loadedSession = {
      id: 100,
      name: "Torque Session",
      measurementAreas: [{ id: "area-1", name: "Torque" }],
      uuts: [{ id: "uut-1", measurementAreaId: "area-1" }],
      testPoints: [
        {
          id: "point-1",
          measurementAreaId: "area-1",
          associatedUutIds: ["uut-1"],
        },
      ],
    };
    const existing = [
      { id: 100, name: "Torque Session" },
      { id: 500, name: "Torque Session (Imported)" },
    ];

    const imported = prepareImportedSession(loadedSession, existing, 500);

    expect(imported.id).toBe(501);
    expect(imported.name).toBe("Torque Session (Imported 2)");
    expect(imported.measurementAreas[0].id).toBe("area-1");
    expect(imported.uuts[0].id).toBe("uut-1");
    expect(imported.testPoints[0].id).toBe("point-1");
    expect(loadedSession).toMatchObject({
      id: 100,
      name: "Torque Session",
    });
  });
});

describe("session undo history", () => {
  it("restores the active session's previous snapshot", async () => {
    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.currentSessionData?.name).toBe("Original");
    });

    act(() => {
      result.current.updateSession({
        ...result.current.currentSessionData,
        name: "Edited",
      });
    });
    expect(result.current.currentSessionData.name).toBe("Edited");

    let didUndo = false;
    act(() => {
      didUndo = result.current.undoLastSessionChange();
    });

    expect(didUndo).toBe(true);
    expect(result.current.currentSessionData.name).toBe("Original");
  });

  it("follows workspace chronology across edits and newly added sessions", async () => {
    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.currentSessionData?.name).toBe("Original");
    });

    act(() => {
      result.current.updateSession({
        ...result.current.currentSessionData,
        name: "Edited before add",
      });
    });
    act(() => {
      result.current.addSession();
    });
    expect(result.current.sessions).toHaveLength(2);

    act(() => {
      expect(result.current.undoLastSessionChange()).toBe(true);
    });
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.currentSessionData.name).toBe("Edited before add");

    act(() => {
      expect(result.current.undoLastSessionChange()).toBe(true);
    });
    expect(result.current.currentSessionData.name).toBe("Original");
  });

  it("restores a deleted session and its previous selection", async () => {
    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.currentSessionData?.id).toBe(1);
    });

    act(() => {
      result.current.deleteSession(1);
    });
    expect(result.current.sessions).toHaveLength(0);

    act(() => {
      expect(result.current.undoLastSessionChange()).toBe(true);
    });
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.currentSessionData).toMatchObject({
      id: 1,
      name: "Original",
    });
  });

  it("keeps rapid discrete workspace actions as separate undo steps", async () => {
    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
    });
    act(() => {
      result.current.addSession();
      result.current.addSession();
    });
    expect(result.current.sessions).toHaveLength(3);

    act(() => {
      expect(result.current.undoLastSessionChange()).toBe(true);
    });
    expect(result.current.sessions).toHaveLength(2);
    act(() => {
      expect(result.current.undoLastSessionChange()).toBe(true);
    });
    expect(result.current.sessions).toHaveLength(1);
  });
});

describe("saveTestPoint derived equation state", () => {
  it("preserves variableNominals when updating an existing point without that field", async () => {
    axios.get.mockImplementation((url) =>
      Promise.resolve({
        data: url.endsWith("/sessions/")
          ? [
              {
                id: 1,
                name: "Original",
                testPoints: [
                  {
                    id: "point-1",
                    section: "4.1",
                    measurementType: "derived",
                    equationString: "t = a + b",
                    equationName: "Temperature Ratio",
                    variableMappings: { a: "A", b: "B" },
                    variableNominals: {
                      a: { value: "10", unit: "degF" },
                      b: { value: "20", unit: "degF" },
                    },
                    testPointInfo: {
                      parameter: { name: "Temperature", value: "30", unit: "degF" },
                    },
                    tmdeTolerances: [],
                  },
                ],
              },
            ]
          : [],
      }),
    );

    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.currentSessionData?.testPoints).toHaveLength(1);
    });

    act(() => {
      result.current.saveTestPoint({
        id: "point-1",
        section: "4.1 updated",
        measurementType: "derived",
        equationString: "t = a + b",
        variableMappings: { a: "A", b: "B" },
        testPointInfo: {
          parameter: { name: "Temperature", value: "30", unit: "degF" },
        },
      });
    });

    expect(
      result.current.currentSessionData.testPoints[0].variableNominals,
    ).toEqual({
      a: { value: "10", unit: "degF" },
      b: { value: "20", unit: "degF" },
    });
    expect(result.current.currentSessionData.testPoints[0].equationName).toBe(
      "Temperature Ratio",
    );
  });
});

describe("instrument sync reconciliation", () => {
  it("replaces a linked local instrument with the synced shared instrument", async () => {
    const shared = {
      id: "shared-1",
      manufacturer: "Acme",
      model: "DMM",
      description: "Shared DMM",
      scope: "validated",
      functions: [],
    };
    const local = {
      ...shared,
      id: "local-1",
      description: "Local edited DMM",
      scope: "local",
      owner: "bench-1",
      sourceId: shared.id,
      validatedSnapshot: {
        manufacturer: "Acme",
        model: "DMM",
        description: "Shared DMM",
        functions: [],
      },
    };
    const synced = {
      ...local,
      id: shared.id,
      scope: "validated",
      sourceId: shared.id,
    };

    axios.get.mockImplementation((url) =>
      Promise.resolve({
        data: url.includes("/instruments/")
          ? [shared, local]
          : url.endsWith("/sessions/")
            ? [{ id: 1, name: "Original", testPoints: [] }]
            : [],
      }),
    );

    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.instruments).toHaveLength(2);
    });

    act(() => {
      result.current.reconcileSyncedInstrument(synced);
    });

    expect(result.current.instruments).toEqual([synced]);
  });
});

describe("local instrument persistence", () => {
  it("updates a local instrument when its specifications change", async () => {
    const savedLocal = {
      id: "local-dmm-1",
      owner: "bench-1",
      scope: "local",
      manufacturer: "Acme",
      model: "DMM-1",
      description: "Bench meter",
      functions: [{ name: "Voltage", ranges: [] }],
    };
    axios.get.mockImplementation((url) =>
      Promise.resolve({
        data: url.endsWith("/instruments/")
          ? [savedLocal]
          : url.endsWith("/sessions/")
            ? [{ id: 1, name: "Original", testPoints: [] }]
            : [],
      }),
    );

    const { result } = renderHook(() => useSessionManager());
    await waitFor(() => {
      expect(result.current.instruments).toEqual([savedLocal]);
    });

    const editedDefinition = {
      ...savedLocal,
      id: "new-session-row-id",
      functions: [
        {
          name: "Voltage",
          ranges: [{ min: "0", max: "10", unit: "V", tolerance: { iv: 1 } }],
        },
      ],
    };
    axios.post.mockResolvedValue({});

    await act(async () => {
      await result.current.saveInstrument(editedDefinition);
    });

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/instruments/"),
      expect.objectContaining({ id: savedLocal.id }),
    );
    expect(result.current.instruments).toHaveLength(1);
    expect(result.current.instruments[0]).toMatchObject({
      id: savedLocal.id,
      functions: editedDefinition.functions,
    });
  });
});
